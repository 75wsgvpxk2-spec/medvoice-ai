import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/src/app.ts';
import { clinicians, patients, flags, alerts, encounters } from '../server/src/db/repositories.ts';
import { hashPassword } from '../server/src/lib/auth.ts';
import { freshPopulation, CLINICIAN_ID } from './helpers.ts';

/**
 * The clinical assistant, over HTTP.
 *
 * The assistant reads a record back and explains it. Everything below is about
 * the second half of that sentence: it explains, and it does nothing else.
 *
 * These are not tests of what it says — no model runs here, and what a model
 * says is not a thing a test can pin down. They are tests of the boundary
 * around it: that it refuses to answer about a patient nobody named, that it
 * refuses a patient outside the clinic, that a request needs a signed-in
 * clinician, and — the one that matters most — that asking it a question
 * cannot change a single row of the record it just read.
 */

let server: Server;
let base: string;
let cookie: string;

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const header = response.headers.get('set-cookie');
  if (!response.ok || !header) throw new Error(`sign-in failed: ${response.status}`);
  return header.split(';')[0]!;
}

function ask(body: unknown, auth = cookie) {
  return fetch(`${base}/api/assistant`, {
    method: 'POST',
    headers: { Cookie: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  freshPopulation();
  const { hash, salt } = hashPassword('clinic-demo');
  clinicians.setPassword(CLINICIAN_ID, hash, salt, false);

  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
  cookie = await signIn('a.thomas@clinic.example', 'clinic-demo');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('The assistant answers, and only answers', () => {
  it('reads a patient back without changing anything on the record', async () => {
    const patient = patients.forClinic()[0]!;

    const before = {
      status: patients.byId(patient.id)!.status,
      lastAssessedAt: patients.byId(patient.id)!.lastAssessedAt,
      flags: flags.activeForPatient(patient.id).length,
      alerts: alerts.openForPatient(patient.id).length,
      encounters: encounters.forPatient(patient.id).length,
    };

    const response = await ask({
      mode: 'planning',
      patientId: patient.id,
      question: 'What should I consider at the next visit?',
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { answer: string; basis: string[]; uncertain: boolean };
    expect(body.answer.length).toBeGreaterThan(0);
    expect(Array.isArray(body.basis)).toBe(true);

    const after = {
      status: patients.byId(patient.id)!.status,
      lastAssessedAt: patients.byId(patient.id)!.lastAssessedAt,
      flags: flags.activeForPatient(patient.id).length,
      alerts: alerts.openForPatient(patient.id).length,
      encounters: encounters.forPatient(patient.id).length,
    };

    // The whole design in one assertion. Asking a question is not an action.
    expect(after, 'asking the assistant altered the record').toEqual(before);
  });

  it('says so plainly when no model is configured rather than implying one answered', async () => {
    const patient = patients.forClinic()[0]!;
    const response = await ask({
      mode: 'patient',
      patientId: patient.id,
      question: 'What changed since the last visit?',
    });

    const body = (await response.json()) as { deterministic: boolean; uncertain: boolean };
    // These tests run with no provider, so the local engine answers. It must
    // be labelled: an unlabelled local summary read as model analysis is the
    // hidden degradation the safety rules exist to prevent.
    expect(body.deterministic).toBe(true);
    expect(body.uncertain).toBe(true);
  });

  it('refuses to answer about a patient in patient mode when none was named', async () => {
    const response = await ask({ mode: 'patient', question: 'What changed since the last visit?' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/patient/i);
  });

  it('refuses a patient who is not in this clinic', async () => {
    const response = await ask({
      mode: 'patient',
      patientId: 'pat_does_not_exist',
      question: 'Anything worth knowing?',
    });
    expect(response.status).toBe(404);
  });

  it('refuses an empty question and an unknown mode', async () => {
    expect((await ask({ mode: 'research', question: '   ' })).status).toBe(400);
    expect((await ask({ mode: 'diagnose', question: 'What is wrong with them?' })).status).toBe(400);
  });

  it('answers research without a patient, from the clinic\'s own reference', async () => {
    const response = await ask({
      mode: 'research',
      question: 'Which threshold is used for stage 2 hypertension?',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { basis: string[]; patientId: string | null };
    expect(body.patientId).toBeNull();
    expect(body.basis.length).toBeGreaterThan(0);
  });

  it('is closed to anyone who is not signed in', async () => {
    const response = await ask({ mode: 'research', question: 'Anything at all' }, 'mv_session=nope');
    expect(response.status).toBe(401);
  });
});
