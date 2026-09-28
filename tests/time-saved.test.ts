import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/src/app.ts';
import { clinicians } from '../server/src/db/repositories.ts';
import { hashPassword } from '../server/src/lib/auth.ts';
import { activity } from '../server/src/lib/time-saved.ts';
import { submitEncounter, approveEncounter, amendEncounter } from '../server/src/orchestration/triggers.ts';
import { DEFAULT_TIME_SAVED, type TimeSavedView } from '../shared/types.ts';
import { freshPopulation, patientNamed, sampleNote, CLINICIAN_ID, AS_OF, PROFILE } from './helpers.ts';

/**
 * The time-saved scoreboard counts finished work from the record. The bar is
 * that it counts what a clinic would agree it did — an approved note, once —
 * and nothing it did not: history outside the window, a correction to a note
 * already counted.
 */

let server: Server;
let base: string;
let admin: string;
let colleague: string;

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

/** An hour either side of now — the window "today" collapses to in a test. */
function aroundNow(): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now - 3_600_000).toISOString(),
    to: new Date(now + 3_600_000).toISOString(),
  };
}

beforeAll(async () => {
  freshPopulation();
  const { hash, salt } = hashPassword('clinic-demo');
  clinicians.setPassword(CLINICIAN_ID, hash, salt, false);

  const email = 'nurse-time@clinic.example';
  const password = 'a-real-password-9182';
  const pw = hashPassword(password);
  clinicians.insert({
    id: 'clin_time_nurse',
    name: 'Nurse Joseph',
    credentials: 'RN',
    email,
    passwordHash: pw.hash,
    passwordSalt: pw.salt,
    role: 'clinician',
  });

  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  admin = await signIn(clinicians.byId(CLINICIAN_ID)!.email, 'clinic-demo');
  colleague = await signIn(email, password);
});

afterAll(() => {
  server.close();
});

describe('what counts', () => {
  it('counts nothing from seeded history outside the window', () => {
    const { from, to } = aroundNow();
    expect(activity(from, to)).toEqual([]);
  });

  it('counts an approved note once, for the clinician who approved it', async () => {
    const patient = patientNamed(PROFILE.stableDocumented);
    const submission = await submitEncounter(patient.id, sampleNote('clean'), CLINICIAN_ID);
    const { from, to } = aroundNow();

    // A draft is not finished work.
    expect(activity(from, to).filter((i) => i.kind === 'encounter_note')).toHaveLength(0);

    await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });
    const notes = activity(from, to).filter((i) => i.kind === 'encounter_note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      clinicianId: CLINICIAN_ID,
      clinicianName: clinicians.byId(CLINICIAN_ID)!.name,
    });

    // Correcting a note is not writing a second one.
    await amendEncounter(submission.encounter.id, CLINICIAN_ID, { plan: 'Review in four weeks.' });
    expect(activity(from, to).filter((i) => i.kind === 'encounter_note')).toHaveLength(1);
  }, 300_000);

  it('counts a generated patient summary for whoever generated it', async () => {
    const patient = patientNamed(PROFILE.stableDocumented);
    const response = await as(colleague)(`/patients/${patient.id}/report?format=markdown`);
    expect(response.ok).toBe(true);

    const { from, to } = aroundNow();
    const summaries = activity(from, to).filter((i) => i.kind === 'summary_report');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.clinicianId).toBe('clin_time_nurse');
  });
});

describe('GET /time-saved', () => {
  it('returns the window’s work with the estimates to value it', async () => {
    const { from, to } = aroundNow();
    const response = await as(colleague)(`/time-saved?from=${from}&to=${to}`);
    expect(response.status).toBe(200);
    const view = (await response.json()) as TimeSavedView;
    expect(view.items.map((i) => i.kind).sort()).toEqual(['encounter_note', 'summary_report']);
    expect(view.estimates).toEqual(DEFAULT_TIME_SAVED);
  });

  it('refuses a window that is backwards, missing or too wide', async () => {
    const now = new Date();
    const later = new Date(now.getTime() + 60_000).toISOString();
    const wide = new Date(now.getTime() + 63 * 86_400_000).toISOString();
    const get = as(colleague);
    expect((await get(`/time-saved?from=${later}&to=${now.toISOString()}`)).status).toBe(400);
    expect((await get('/time-saved')).status).toBe(400);
    expect((await get(`/time-saved?from=${now.toISOString()}&to=${wide}`)).status).toBe(400);
  });

  it('is not readable signed out', async () => {
    const { from, to } = aroundNow();
    expect((await fetch(`${base}/api/time-saved?from=${from}&to=${to}`)).status).toBe(401);
  });
});

describe('PUT /time-saved/estimates', () => {
  const put = (cookie: string, body: unknown) =>
    as(cookie)('/time-saved/estimates', { method: 'PUT', body: JSON.stringify(body) });

  it('is for admins only', async () => {
    expect((await put(colleague, { dailyGoalMinutes: 90 })).status).toBe(403);
  });

  it('rejects a value out of range rather than clamping it', async () => {
    const response = await put(admin, { minutes: { encounter_note: 7000 } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/Encounter note/);
    expect((await put(admin, { dailyGoalMinutes: 0 })).status).toBe(400);
  });

  it('saves the clinic’s own pace, and every reader sees it', async () => {
    const response = await put(admin, { minutes: { encounter_note: 12 }, dailyGoalMinutes: 90 });
    expect(response.status).toBe(200);

    const { from, to } = aroundNow();
    const view = (await (await as(colleague)(`/time-saved?from=${from}&to=${to}`)).json()) as TimeSavedView;
    expect(view.estimates.minutes.encounter_note).toBe(12);
    expect(view.estimates.minutes.hse_report).toBe(DEFAULT_TIME_SAVED.minutes.hse_report);
    expect(view.estimates.dailyGoalMinutes).toBe(90);
  });

  it('is readable on its own by any clinician, for the Settings screen', async () => {
    const response = await as(colleague)('/time-saved/estimates');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { estimates: { dailyGoalMinutes: number } };
    expect(body.estimates.dailyGoalMinutes).toBe(90);
  });

  it('leaves a line in the audit trail', async () => {
    const response = await as(admin)('/audit?action=time_saved.estimates_updated');
    const body = (await response.json()) as { events: Array<{ summary: string }> };
    expect(body.events[0]?.summary).toMatch(/daily goal 90 minutes/);
  });
});
