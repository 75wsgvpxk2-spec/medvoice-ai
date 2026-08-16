import { describe, it, expect, beforeAll } from 'vitest';
import { submitEncounter, approveEncounter, runPopulation } from '../server/src/orchestration/triggers.ts';
import { resolveAlert } from '../server/src/agents/resolution.ts';
import { patients, alerts, runs, flags, clinicians, audit } from '../server/src/db/repositories.ts';
import { summariseSpend } from '../server/src/model/spend.ts';
import { db } from '../server/src/db/index.ts';
import {
  hashPassword,
  verifyPassword,
  makeSessionToken,
  readSessionToken,
  isExpired,
} from '../server/src/lib/auth.ts';
import { freshPopulation, patientNamed, sampleNote, CLINICIAN_ID, AS_OF, PROFILE } from './helpers.ts';

/** Section 14.10 — performance, caching, spend, and auth. */

describe('PF-1 [CRITICAL]  Approval to queue update', () => {
  it('completes well inside the 10 second target', async () => {
    freshPopulation();
    await runPopulation(CLINICIAN_ID, { asOf: AS_OF });

    const patient = patientNamed(PROFILE.comorbidity);
    const submission = await submitEncounter(patient.id, sampleNote('golden_path'), CLINICIAN_ID);

    const startedAt = Date.now();
    const approval = await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });
    const elapsed = Date.now() - startedAt;

    expect(approval.failures).toEqual([]);
    expect(elapsed, `approval to updated queue took ${elapsed}ms`).toBeLessThan(10_000);
  }, 300_000);
});

describe('PF-2  Full population assessment completes and reports its duration', () => {
  it('reports a duration for the whole run', async () => {
    freshPopulation();
    const result = await runPopulation(CLINICIAN_ID, { asOf: AS_OF });
    expect(result.assessed).toBe(15);
    // PF-2 asks only that the run completes and reports its duration. The
    // 10 second target in PF-1 is for approval to queue update, not for a
    // whole-population assessment, which Section 11 expects to be the
    // expensive call and run deliberately rather than on every save.
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.failures).toEqual([]);
    console.log(`      population run: ${(result.durationMs / 1000).toFixed(1)}s for ${result.assessed} patients`);
  }, 300_000);
});

describe('PF-4  The loop runs clean three times consecutively', () => {
  it('shows no degradation across three full loops', async () => {
    freshPopulation();

    const durations: number[] = [];
    const targets = [PROFILE.comorbidity, PROFILE.sickleCell, PROFILE.worseningTrend] as const;
    const notes = ['golden_path', 'informal', 'ambiguous_unit'] as const;

    for (let i = 0; i < 3; i += 1) {
      await runPopulation(CLINICIAN_ID, { asOf: AS_OF });

      const patient = patientNamed(targets[i]!);
      const submission = await submitEncounter(patient.id, sampleNote(notes[i]!), CLINICIAN_ID);

      const startedAt = Date.now();
      const approval = await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });
      durations.push(Date.now() - startedAt);

      // Each loop is clean in its own right.
      expect(approval.failures, `loop ${i + 1} had agent failures`).toEqual([]);
      expect(approval.parallelism.overlapped, `loop ${i + 1} did not run agents in parallel`).toBe(true);

      // And a resolution is available and executable each time round.
      const alert = alerts.openForPatient(patient.id).find((a) => a.resolution.createsOrder);
      if (alert) {
        const outcome = await resolveAlert(alert.id, CLINICIAN_ID, { asOf: AS_OF });
        expect(outcome.alertClosed).toBe(true);
      }
    }

    expect(durations).toHaveLength(3);
    for (const [index, duration] of durations.entries()) {
      expect(duration, `loop ${index + 1} took ${duration}ms`).toBeLessThan(10_000);
    }

    // No agent run anywhere in the three loops failed.
    const failures = runs.recent(500).filter((r) => r.outcome === 'failure');
    expect(failures.map((f) => `${f.agent}: ${f.errorMessage}`)).toEqual([]);
  }, 300_000);
});

describe('PF-5  Token spend is measured and reported', () => {
  it('records every model call with its provider and cost', () => {
    const spend = summariseSpend();
    expect(spend.totalCalls).toBeGreaterThan(0);
    // Every call is attributed to exactly one provider. `cachedCalls` counts
    // how many of those were served from the agent cache, so it is a subset
    // rather than a third category.
    expect(spend.totalCalls).toBe(spend.liveCalls + spend.deterministicCalls);
    expect(spend.cachedCalls).toBeLessThanOrEqual(spend.totalCalls);
    expect(spend.byAgent.length).toBeGreaterThan(0);
    // Section 11: at least 20 percent of the pool stays reserved.
    expect(spend.reserveUsd).toBeCloseTo(spend.budgetUsd * 0.2, 5);
    expect(spend.reserveIntact).toBe(true);
  });
});

describe('PF-6  A second identical population run reuses cached agent output', () => {
  it('does not scale spend linearly with repetition', async () => {
    freshPopulation();

    await runPopulation(CLINICIAN_ID, { asOf: AS_OF });
    const afterFirst = summariseSpend();

    await runPopulation(CLINICIAN_ID, { asOf: AS_OF });
    const afterSecond = summariseSpend();

    const firstRunCalls = afterFirst.totalCalls;
    const secondRunCalls = afterSecond.totalCalls - afterFirst.totalCalls;

    // The second run over unchanged data is served from the agent cache.
    expect(afterSecond.cachedCalls).toBeGreaterThan(afterFirst.cachedCalls);
    expect(secondRunCalls).toBeLessThanOrEqual(firstRunCalls);

    const cacheRows = db().prepare('SELECT COUNT(*) AS n FROM agent_cache').get() as { n: number };
    expect(cacheRows.n).toBeGreaterThan(0);
  }, 300_000);
});

describe('PF-3  A dropped connection does not lose the entered note', () => {
  it('keeps the raw note on the draft encounter when the loop is interrupted', async () => {
    freshPopulation();
    const patient = patientNamed(PROFILE.comorbidity);
    const note = sampleNote('golden_path');

    // Submission persists the draft before approval, so a failure between the
    // two leaves the note recoverable rather than lost.
    const submission = await submitEncounter(patient.id, note, CLINICIAN_ID);
    const { encounters } = await import('../server/src/db/repositories.ts');

    const stored = encounters.byId(submission.encounter.id)!;
    expect(stored.rawNote).toBe(note);
    expect(stored.status).toBe('awaiting_approval');
  }, 300_000);
});

describe('Auth and per-clinician scoping', () => {
  beforeAll(() => {
    freshPopulation();
  });

  it('hashes passwords and never stores them in the clear', () => {
    const { hash, salt } = hashPassword('clinic-demo');
    expect(hash).not.toContain('clinic-demo');
    expect(verifyPassword('clinic-demo', hash, salt)).toBe(true);
    expect(verifyPassword('wrong-password', hash, salt)).toBe(false);
  });

  it('rejects a tampered session token', () => {
    const token = makeSessionToken(CLINICIAN_ID, 1);
    expect(readSessionToken(token)?.clinicianId).toBe(CLINICIAN_ID);
    expect(readSessionToken(`${CLINICIAN_ID}.deadbeef`)).toBeNull();
    expect(readSessionToken('nonsense')).toBeNull();
    expect(readSessionToken(undefined)).toBeNull();

    // Re-signing a token with a different clinician id must not validate: the
    // signature covers the whole payload, not just the trailing segment.
    const forged = token.replace(CLINICIAN_ID, 'clin_someone_else');
    expect(readSessionToken(forged)).toBeNull();
  });

  it('survives a restart but not its own expiry', () => {
    // Stateless by design: nothing is held in memory, so a token minted by one
    // process validates in the next. That is what stops a server reload from
    // signing the clinic out.
    const token = makeSessionToken(CLINICIAN_ID, 1);
    const claims = readSessionToken(token);
    expect(claims).not.toBeNull();
    expect(isExpired(claims!, 12)).toBe(false);

    // An hour-old token against a lifetime measured in hours is still fine;
    // the same token against a zero lifetime is not.
    expect(isExpired({ ...claims!, issuedAt: Date.now() - 2 * 3_600_000 }, 12)).toBe(false);
    expect(isExpired({ ...claims!, issuedAt: Date.now() - 13 * 3_600_000 }, 12)).toBe(true);
  });

  it('revokes every issued token when the clinician signs out', () => {
    const before = clinicians.tokenVersion(CLINICIAN_ID)!;
    const token = readSessionToken(makeSessionToken(CLINICIAN_ID, before))!;
    expect(token.tokenVersion).toBe(before);

    clinicians.revokeSessions(CLINICIAN_ID);
    const after = clinicians.tokenVersion(CLINICIAN_ID)!;

    // The old token still verifies its signature — it was genuinely issued —
    // but no longer matches the clinician's version, which is what the
    // middleware compares. Signing out therefore ends sessions it cannot see.
    expect(after).toBe(before + 1);
    expect(token.tokenVersion).not.toBe(after);
  });

  it('scopes every population read to one clinician', () => {
    const population = patients.forClinician(CLINICIAN_ID);
    expect(population.length).toBe(15);
    expect(population.every((p) => p.clinicianId === CLINICIAN_ID)).toBe(true);

    // DI-4 cannot be demonstrated in a single-clinician build (see
    // docs/DEVIATIONS.md item 2), but the scoping query itself is exercised:
    // a different clinician id returns nothing.
    expect(patients.forClinician('clin_someone_else')).toEqual([]);
  });
});

describe('CS-2 [CRITICAL]  Nothing in the copy implies a diagnosis', () => {
  it('keeps flag reasoning and actions advisory', async () => {
    freshPopulation();
    await runPopulation(CLINICIAN_ID, { asOf: AS_OF });

    const diagnosticPhrasing =
      /\b(diagnosed with|the diagnosis is|this patient has confirmed|confirms? (a )?diagnosis|we have diagnosed)\b/i;

    for (const p of patients.forClinician(CLINICIAN_ID)) {
      for (const f of flags.activeForPatient(p.id)) {
        expect(f.reasoning, `${p.name}: ${f.reasoning}`).not.toMatch(diagnosticPhrasing);
        expect(f.recommendedAction, `${p.name}: ${f.recommendedAction}`).not.toMatch(diagnosticPhrasing);
      }
      for (const a of alerts.openForPatient(p.id)) {
        expect(a.description, `${p.name}: ${a.description}`).not.toMatch(diagnosticPhrasing);
      }
    }
  }, 300_000);
});

describe('Multi-user access — §164.312(a)(2)(i) unique user identification', () => {
  beforeAll(() => {
    freshPopulation();
  });

  it('gives every member of staff the same population', () => {
    // The access boundary is the installation, not the clinician: staff at one
    // clinic share a caseload. See docs/DEVIATIONS.md item 2.
    const clinicWide = patients.forClinic();
    expect(clinicWide.length).toBe(15);

    // A second clinician, who owns none of the patients by attribution, still
    // sees all of them.
    clinicians.insert({
      id: 'clin_nurse',
      name: 'Nurse Joy Blenman',
      credentials: 'RN',
      email: 'joy@example.com',
      passwordHash: 'x',
      passwordSalt: 'y',
    });
    expect(patients.forClinician('clin_nurse')).toEqual([]);
    expect(patients.forClinic().length).toBe(clinicWide.length);
  });

  it('deactivates rather than deletes, so audit history keeps a name', () => {
    const before = clinicians.byId('clin_nurse')!;
    expect(before.active).toBe(true);
    expect(before.role).toBe('clinician');

    clinicians.setActive('clin_nurse', false);
    const after = clinicians.byId('clin_nurse')!;

    // Still resolvable — an audit row from last month must still say who.
    expect(after).not.toBeNull();
    expect(after.name).toBe('Nurse Joy Blenman');
    expect(after.active).toBe(false);
    // Deactivating bumps the token version, which is what ends live sessions.
    expect(clinicians.tokenVersion('clin_nurse')).toBeGreaterThan(before ? 1 : 0);
  });

  it('never leaves an installation with no administrator', () => {
    // The seeded clinician is the admin; the nurse is not.
    expect(clinicians.activeAdminCount()).toBe(1);
  });
});

describe('Audit integrity — §164.312(c)(1)', () => {
  beforeAll(() => {
    freshPopulation();
  });

  it('chains each entry to the one before it', () => {
    audit.record({
      actor: CLINICIAN_ID,
      actorName: 'Andrea Thomas',
      action: 'test.first',
      entityType: 'test',
      summary: 'First entry.',
    });
    audit.record({
      actor: CLINICIAN_ID,
      actorName: 'Andrea Thomas',
      action: 'test.second',
      entityType: 'test',
      summary: 'Second entry.',
    });

    const result = audit.verify();
    expect(result.ok).toBe(true);
    expect(result.checked).toBeGreaterThanOrEqual(2);
    expect(result.brokenAt).toBeNull();
  });

  it('detects an entry edited in place', () => {
    // Exactly what somebody with file access to the database would do.
    db().prepare("UPDATE audit_event SET summary = 'Nothing happened' WHERE action = 'test.first'").run();

    const result = audit.verify();
    expect(result.ok).toBe(false);
    expect(result.brokenSummary).toBe('Nothing happened');
  });

  it('detects a deleted entry', () => {
    freshPopulation();
    for (const n of ['a', 'b', 'c']) {
      audit.record({
        actor: CLINICIAN_ID,
        actorName: 'Andrea Thomas',
        action: `test.${n}`,
        entityType: 'test',
        summary: `Entry ${n}.`,
      });
    }
    expect(audit.verify().ok).toBe(true);

    // Removing the middle row leaves the next one pointing at a hash that is
    // no longer its predecessor.
    db().prepare("DELETE FROM audit_event WHERE action = 'test.b'").run();
    expect(audit.verify().ok).toBe(false);
  });
});
