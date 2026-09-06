import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/src/app.ts';
import { clinicians, patients, audit } from '../server/src/db/repositories.ts';
import { hashPassword } from '../server/src/lib/auth.ts';
import { freshPopulation } from './helpers.ts';

/**
 * The Clinical Assistant, over HTTP — with `MODEL_TEST_DOUBLE=1` set by
 * `npm test`, every call is served by each mode's deterministic fallback, not
 * a live model. What's under test here is the route's own logic: mode
 * validation, patient resolution, and — most importantly — that Research mode
 * never discloses a patient and never writes an audit row, while Patient mode
 * and a patient-attached Planning-mode turn always do.
 */

let server: Server;
let base: string;

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = response.headers.get('set-cookie');
  if (!response.ok || !cookie) throw new Error(`sign-in failed for ${email}: ${response.status}`);
  return cookie.split(';')[0]!;
}

function addClinician(): { email: string; password: string } {
  const email = `assistant-${Math.random().toString(36).slice(2, 8)}@clinic.example`;
  const password = 'a-real-password-9182';
  const { hash, salt } = hashPassword(password);
  clinicians.insert({
    id: `clin_${Math.random().toString(36).slice(2, 10)}`,
    name: 'Dr. Assistant Tester',
    credentials: 'MD',
    email,
    passwordHash: hash,
    passwordSalt: salt,
    role: 'clinician',
  });
  return { email, password };
}

let call: (path: string, init?: RequestInit) => Promise<Response>;

beforeAll(async () => {
  freshPopulation();
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;

  const clinician = addClinician();
  const cookie = await signIn(clinician.email, clinician.password);
  call = (path, init = {}) =>
    fetch(`${base}/api${path}`, {
      ...init,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /assistant/chat', () => {
  it('rejects an unknown mode', async () => {
    const response = await call('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ mode: 'diagnosis', message: 'hello', history: [] }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects an empty message', async () => {
    const response = await call('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ mode: 'research', message: '  ', history: [] }),
    });
    expect(response.status).toBe(400);
  });

  it('answers Research mode with no patient in scope, and writes no audit row', async () => {
    const patient = patients.forClinic()[0]!;
    const before = audit.recent(200, { action: 'assistant.query' }).length;

    const response = await call('/assistant/chat', {
      method: 'POST',
      // patientId is supplied but must be ignored: Research mode never looks it up.
      body: JSON.stringify({ mode: 'research', patientId: patient.id, message: 'What treats hypertension?', history: [] }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reply: string; usedPatientContext: boolean };
    expect(body.usedPatientContext).toBe(false);
    expect(typeof body.reply).toBe('string');
    expect(body.reply.length).toBeGreaterThan(0);

    const after = audit.recent(200, { action: 'assistant.query' }).length;
    expect(after).toBe(before);
  });

  it('requires a patient for Patient mode', async () => {
    const response = await call('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ mode: 'patient', message: 'What is she on?', history: [] }),
    });
    expect(response.status).toBe(400);
  });

  it('404s Patient mode for a patient outside the clinic', async () => {
    const response = await call('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ mode: 'patient', patientId: 'pat_nothing_here', message: 'What is she on?', history: [] }),
    });
    expect(response.status).toBe(404);
  });

  it('answers Patient mode grounded in the record, and writes an audit row scoped to that patient', async () => {
    const patient = patients.forClinic()[0]!;

    const response = await call('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ mode: 'patient', patientId: patient.id, message: 'What is her current status?', history: [] }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reply: string; usedPatientContext: boolean; patientId: string };
    expect(body.usedPatientContext).toBe(true);
    expect(body.patientId).toBe(patient.id);

    const rows = audit.recent(50, { action: 'assistant.query', patientId: patient.id });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.summary).toMatch(/Patient mode/);
    expect(rows[0]!.detail).toMatchObject({ mode: 'patient', question: 'What is her current status?' });
  });

  it('answers Planning mode without a patient, and writes no audit row', async () => {
    const before = audit.recent(200, { action: 'assistant.query' }).length;

    const response = await call('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ mode: 'planning', message: 'Help me plan a follow-up schedule.', history: [] }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { usedPatientContext: boolean };
    expect(body.usedPatientContext).toBe(false);

    const after = audit.recent(200, { action: 'assistant.query' }).length;
    expect(after).toBe(before);
  });

  it('answers Planning mode with a patient, and writes an audit row', async () => {
    const patient = patients.forClinic()[1]!;

    const response = await call('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'planning',
        patientId: patient.id,
        message: 'Help me plan her follow-up.',
        history: [],
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { usedPatientContext: boolean; patientId: string };
    expect(body.usedPatientContext).toBe(true);

    const rows = audit.recent(50, { action: 'assistant.query', patientId: patient.id });
    expect(rows.some((r) => r.summary.includes('Planning mode'))).toBe(true);
  });

  it('refuses a caller with no session', async () => {
    const response = await fetch(`${base}/api/assistant/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'research', message: 'hello', history: [] }),
    });
    expect(response.status).toBe(401);
  });
});
