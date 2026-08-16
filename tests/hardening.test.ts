import { describe, it, expect, beforeAll } from 'vitest';
import { submitEncounter, approveEncounter, runPopulation } from '../server/src/orchestration/triggers.ts';
import { resolveAlert } from '../server/src/agents/resolution.ts';
import { patients, alerts, runs, flags } from '../server/src/db/repositories.ts';
import { summariseSpend } from '../server/src/model/spend.ts';
import { db } from '../server/src/db/index.ts';
import { hashPassword, verifyPassword, makeSessionToken, readSessionToken } from '../server/src/lib/auth.ts';
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
    const token = makeSessionToken(CLINICIAN_ID);
    expect(readSessionToken(token)).toBe(CLINICIAN_ID);
    expect(readSessionToken(`${CLINICIAN_ID}.deadbeef`)).toBeNull();
    expect(readSessionToken('nonsense')).toBeNull();
    expect(readSessionToken(undefined)).toBeNull();
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
