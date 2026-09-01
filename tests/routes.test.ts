import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/src/app.ts';
import { clinicians, patients, flags } from '../server/src/db/repositories.ts';
import { hashPassword } from '../server/src/lib/auth.ts';
import { freshPopulation, CLINICIAN_ID } from './helpers.ts';

/**
 * The routes, over HTTP.
 *
 * Every other test in this suite runs in-process, which means no route guard,
 * no auth middleware and no admin gate is exercised anywhere. That is not a
 * gap in coverage so much as a blind spot with a shape: four routes authorised
 * on `clinician_id` instead of the installation for months, hiding patients
 * from the colleagues who share the caseload, and no test could have noticed
 * because no test ever made a request.
 *
 * These do.
 */

let server: Server;
let base: string;

/** Sign in and keep the cookie, the way a browser would. */
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

function as(cookie: string) {
  return (path: string, init: RequestInit = {}) =>
    fetch(`${base}/api${path}`, {
      ...init,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
}

/** A second clinician who has registered nobody. */
function addColleague(role: 'clinician' | 'admin'): { email: string; password: string } {
  const email = `colleague-${Math.random().toString(36).slice(2, 8)}@clinic.example`;
  const password = 'a-real-password-9182';
  const { hash, salt } = hashPassword(password);
  clinicians.insert({
    id: `clin_${Math.random().toString(36).slice(2, 10)}`,
    name: 'Nurse Joseph',
    credentials: 'RN',
    email,
    passwordHash: hash,
    passwordSalt: salt,
    role,
  });
  return { email, password };
}

beforeAll(async () => {
  freshPopulation();
  // The seeded clinician owns every patient; that is the situation the bug
  // depended on. Colleagues added below have registered nobody.
  const { hash, salt } = hashPassword('clinic-demo');
  clinicians.setPassword(CLINICIAN_ID, hash, salt, false);

  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('The caseload is shared across the clinic', () => {
  it('lets a colleague open a patient somebody else registered', async () => {
    const colleague = addColleague('clinician');
    const call = as(await signIn(colleague.email, colleague.password));

    const patient = patients.forClinic()[0]!;
    expect(patient.clinicianId).not.toBe('');

    const response = await call(`/patients/${patient.id}`);
    // This returned 404 "not in your population" before the fix, for a patient
    // sitting in the same clinic's queue.
    expect(response.status, 'a colleague was refused a patient in their own clinic').toBe(200);

    const body = (await response.json()) as { patient: { id: string } };
    expect(body.patient.id).toBe(patient.id);
  });

  it('shows that colleague the whole flag board, not an empty one', async () => {
    const colleague = addColleague('clinician');
    const call = as(await signIn(colleague.email, colleague.password));

    const onFile = flags.activeForClinic().length;
    const response = await call('/flags?pageSize=100');
    expect(response.status).toBe(200);

    const board = (await response.json()) as { total: number };
    // The queue and the board have to agree. They did not: the board filtered
    // on who registered the patient, so it could be empty while the queue was
    // full of critical rows.
    expect(board.total).toBe(onFile);
  });

  it('lets that colleague open an encounter on the patient in front of them', async () => {
    const colleague = addColleague('clinician');
    const call = as(await signIn(colleague.email, colleague.password));
    const patient = patients.forClinic()[1]!;

    const response = await call(`/patients/${patient.id}/encounters`, {
      method: 'POST',
      body: JSON.stringify({ note: '' }),
    });
    // The empty note is rejected on its own merits — 400, not the 404 that
    // means "this patient is not yours".
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/note is empty/i);
  });

  it('still 404s a patient that genuinely does not exist', async () => {
    const colleague = addColleague('clinician');
    const call = as(await signIn(colleague.email, colleague.password));
    const response = await call('/patients/pat_nothing_here');
    expect(response.status).toBe(404);
  });
});

describe('Roles are enforced at the route, not only in the interface', () => {
  it('refuses a clinician the money screens and allows them clinical documents', async () => {
    const colleague = addColleague('clinician');
    const call = as(await signIn(colleague.email, colleague.password));

    for (const path of ['/products', '/invoices', '/expenses', '/reports']) {
      expect((await call(path)).status, `${path} should be administrator-only`).toBe(403);
    }
    // Writing and signing a medical report is clinical work, so it is not.
    expect((await call('/hse-reports')).status).toBe(200);
  });

  it('allows an administrator both', async () => {
    const admin = addColleague('admin');
    const call = as(await signIn(admin.email, admin.password));

    expect((await call('/products')).status).toBe(200);
    expect((await call('/hse-reports')).status).toBe(200);
  });

  it('refuses everything to a caller with no session', async () => {
    for (const path of ['/patients', '/flags', '/products', '/hse-reports']) {
      const response = await fetch(`${base}/api${path}`);
      expect(response.status, `${path} should require a session`).toBe(401);
    }
  });
});
