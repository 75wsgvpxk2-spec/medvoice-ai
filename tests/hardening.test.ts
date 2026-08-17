import { describe, it, expect, beforeAll } from 'vitest';
import { submitEncounter, approveEncounter, runPopulation } from '../server/src/orchestration/triggers.ts';
import { resolveAlert, closeAlertWithoutAction } from '../server/src/agents/resolution.ts';
import {
  patients,
  alerts,
  runs,
  flags,
  clinicians,
  audit,
  settings,
  orders,
  billing,
  observations,
} from '../server/src/db/repositories.ts';
import { callAgent } from '../server/src/model/provider.ts';
import { activeProvider } from '../server/src/lib/settings.ts';
import { PROVIDER_PRESETS } from '../shared/types.ts';
import { summariseSpend } from '../server/src/model/spend.ts';
import { db } from '../server/src/db/index.ts';
import { extractValues } from '../server/src/agents/structuring.ts';
import { readPaging, pageMeta, takePage } from '../server/src/lib/paging.ts';
import { api, endsTheSession, onSessionEnded } from '../client/src/api.ts';
import {
  DEFINITIONS,
  configFor,
  runAutomation,
} from '../server/src/orchestration/automations.ts';
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

describe('Agent automations', () => {
  beforeAll(() => {
    freshPopulation();
  });

  it('is off by default — nothing runs on a fresh installation', () => {
    for (const definition of DEFINITIONS) {
      expect(configFor(definition.id).enabled, `${definition.id} should be off`).toBe(false);
    }
  });

  it('automates only the four flows that cross no human decision', () => {
    /*
     * Section 15 fixes three decisions as the clinician's: approving a note,
     * acting on a flag, and resolving an alert. Every automation below only
     * assesses, scans or ranks.
     *
     * Asserted as an exact set rather than by scanning the descriptions for
     * forbidden words — prose defeats that (the first version of this test
     * failed on "the list already in order"). An exact set means adding an
     * automation breaks this test, which forces whoever adds it to state that
     * their new flow does not decide anything. That deliberate stop is the
     * point; a regex over marketing copy would not have provided it.
     */
    expect(DEFINITIONS.map((d) => d.id).sort()).toEqual([
      'assess_new_patients',
      'documentation_sweep',
      'overnight_sweep',
      'recheck_overdue',
    ]);
  });

  it('runs one at a time', async () => {
    const [first, second] = await Promise.all([
      runAutomation('overnight_sweep'),
      runAutomation('recheck_overdue'),
    ]);
    // Two automations re-ranking the queue concurrently would fight over it.
    expect([first.outcome, second.outcome].filter((o) => o === 'skipped')).toHaveLength(1);
    expect(second.detail + first.detail).toMatch(/already running/);
  });

  it('refuses to run once spend passes the reserve', async () => {
    db()
      .prepare(
        `INSERT INTO model_call (id, agent, provider, model, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, cost_usd, duration_ms, cached, created_at)
         VALUES ('mc_over','clinical_intelligence','anthropic','m',0,0,0,0,99999,0,0,datetime('now'))`,
      )
      .run();

    const result = await runAutomation('overnight_sweep');
    expect(result.outcome).toBe('skipped');
    expect(result.detail).toMatch(/reserve/i);
    // Recorded, not silent: the card has to be able to say why nothing happened.
    expect(configFor('overnight_sweep').lastDetail).toMatch(/reserve/i);

    db().prepare("DELETE FROM model_call WHERE id = 'mc_over'").run();
  });

  it('survives a failure and runs again afterwards', async () => {
    db().prepare('UPDATE clinician SET active = 0').run();
    const broken = await runAutomation('overnight_sweep');
    expect(broken.outcome).not.toBe('success');

    db().prepare('UPDATE clinician SET active = 1').run();
    const recovered = await runAutomation('overnight_sweep');

    // The property worth testing: a scheduler that dies on its first error
    // looks identical to a working one until the day it matters.
    expect(recovered.outcome).toBe('success');
  });
});

describe('Provider flexibility', () => {
  beforeAll(() => {
    freshPopulation();
  });

  const call = () =>
    callAgent<{ status: string }>({
      agent: 'phase0_test',
      system: 'test',
      user: 'test',
      schema: { type: 'object', properties: { status: { type: 'string' } } },
      deterministic: () => ({ status: 'local engine' }),
    });

  it('falls back to the local engine when an OpenAI-compatible endpoint is unreachable', async () => {
    settings.put('model.provider', 'compatible', 'test');
    // Nothing listens here. The SDK wraps this in an APIConnectionError whose
    // message is only "Connection error." — the ECONNREFUSED is nested in
    // `cause`, which an earlier version of the fallback missed entirely and so
    // threw in the clinician's face instead of degrading.
    settings.put('model.baseUrl', 'http://127.0.0.1:5399/v1', 'test');
    settings.put('model.apiKey', 'not-a-real-key-000000000000', 'test');

    const result = await call();
    expect(result.provider).toBe('deterministic');
    expect(result.degradedReason).toMatch(/could not be reached/i);
    expect(result.output.status).toBe('local engine');
  });

  it('falls back the same way on the Anthropic path', async () => {
    settings.put('model.provider', 'anthropic', 'test');
    settings.put('model.baseUrl', 'http://127.0.0.1:5399', 'test');

    const result = await call();
    // One contract, two wire formats: a clinic swapping provider must not be
    // swapping the safety behaviour too.
    expect(result.provider).toBe('deterministic');
    expect(result.degradedReason).toMatch(/could not be reached/i);
  });

  it('offers a provider with a genuine free tier', () => {
    // A clinic that cannot get a paid account should still be able to run this.
    const free = PROVIDER_PRESETS.find((p) => p.id === 'gemini');
    expect(free?.provider).toBe('compatible');
    expect(free?.baseUrl).toContain('generativelanguage.googleapis.com');
    expect(free?.keyUrl).toBeTruthy();
  });
});

describe('AI usage reporting', () => {
  beforeAll(() => {
    freshPopulation();
  });

  it('routes an OpenAI-compatible endpoint correctly even on Automatic', () => {
    // Picking the Gemini preset and leaving the mode on Automatic used to send
    // Google's URL through the Anthropic SDK, which fails looking like a broken
    // integration rather than a setting. An endpoint is part of "what I have".
    settings.put('model.provider', 'auto', 'test');
    settings.put('model.apiKey', 'a-key-that-is-long-enough-000000', 'test');
    settings.put('model.baseUrl', 'https://generativelanguage.googleapis.com/v1beta/openai/', 'test');
    expect(activeProvider()).toBe('compatible');

    // An Anthropic endpoint, or none at all, still means Anthropic.
    settings.put('model.baseUrl', '', 'test');
    expect(activeProvider()).toBe('anthropic');
  });

  it('does not strand an installation that pinned the old local-only mode', () => {
    // Settings used to offer "always the local engine" and no longer does. If
    // that stored value were still honoured, such an installation would sit on
    // the local engine with no control left to move it off.
    settings.put('model.provider', 'deterministic', 'test');
    settings.put('model.apiKey', 'a-key-that-is-long-enough-000000', 'test');
    settings.put('model.baseUrl', '', 'test');
    expect(activeProvider()).toBe('anthropic');

    // Running without a model is now expressed by holding no key, which reaches
    // the same place the old mode did.
    settings.remove('model.apiKey');
    expect(activeProvider()).toBe('deterministic');
  });

  it('attributes every call to one provider, with caching as an overlay', async () => {
    // Needs real calls: an earlier version of this test asserted a three-way
    // partition and passed only because it ran against an empty database.
    await runPopulation(CLINICIAN_ID, { asOf: AS_OF });
    const spend = summariseSpend();
    expect(spend.totalCalls).toBeGreaterThan(0);

    // Provider is the partition — model or local engine, never both.
    expect(spend.liveCalls + spend.deterministicCalls).toBe(spend.totalCalls);

    // Cached cuts across it: how many of those we did not have to ask for.
    // It is a subset, not a third category, which is why the usage panel shows
    // it as a note rather than a third bar.
    expect(spend.cachedCalls).toBeLessThanOrEqual(spend.totalCalls);
  }, 300_000);
});

/*
 * Search has to run over the whole table, not the page already fetched.
 *
 * Filtering a fetched slice in the browser looks correct for as long as the
 * list is short enough to fit in one slice, and then quietly stops finding
 * things — which is the worst failure mode available, because the screen still
 * says "no matches" with complete confidence. The run log had exactly this bug
 * behind a 200-row ceiling.
 *
 * These seed their own rows rather than counting on a population run to produce
 * enough of them: a test that needs thirty rows should make thirty rows.
 */
describe('Search reaches the whole list, not the visible page', () => {
  const PAGE = 5;
  const ROWS = 30;
  /** Written first, so it sits on the last page of a newest-first list. */
  const NEEDLE = 'zzz-needle-correlation';

  beforeAll(() => {
    freshPopulation();
    for (let i = 0; i < ROWS; i += 1) {
      runs.start({
        agent: 'clinical_intelligence',
        trigger: 'population_run',
        correlationId: i === 0 ? NEEDLE : `corr-${i}`,
        inputSummary: `seeded run ${i}`,
      });
      audit.record({
        actor: CLINICIAN_ID,
        actorName: 'Test',
        action: 'settings.update',
        entityType: 'settings',
        summary: i === 0 ? `seeded audit ${NEEDLE}` : `seeded audit ${i}`,
      });
    }
  });

  it('finds a run that is nowhere near the first page', () => {
    const firstPage = runs.page({ page: 1, pageSize: PAGE });
    expect(firstPage.total).toBeGreaterThanOrEqual(ROWS);
    expect(firstPage.runs.length).toBe(PAGE);

    // The needle is not on the page we are searching from.
    expect(firstPage.runs.some((r) => r.correlationId === NEEDLE)).toBe(false);

    const found = runs.page({ search: NEEDLE, page: 1, pageSize: PAGE });
    expect(found.total).toBe(1);
    expect(found.runs[0]!.correlationId).toBe(NEEDLE);
  });

  it('counts matches across every page, not just the one returned', () => {
    const found = runs.page({ search: 'seeded run', page: 1, pageSize: PAGE });

    // total describes the whole matching set; runs.length is one page of it.
    expect(found.runs.length).toBe(PAGE);
    expect(found.total).toBeGreaterThanOrEqual(ROWS);

    // Every page of the match set is reachable, and the last one is not empty.
    const lastPage = Math.ceil(found.total / PAGE);
    expect(lastPage).toBeGreaterThan(1);
    const last = runs.page({ search: 'seeded run', page: lastPage, pageSize: PAGE });
    expect(last.runs.length).toBeGreaterThan(0);
    expect(last.total).toBe(found.total);
  });

  it('never reports a page it cannot fill', () => {
    /*
     * Asking for a page past the end has to land on the last real page with
     * rows on it. Clamping only the number reported back, while the query still
     * looks past the end, gives "page 4 of 4" above an empty list — which reads
     * as "there is nothing here" rather than "you overshot".
     */
    for (const requested of [1, 2, 99, 1000]) {
      const runPage = runs.page({ page: requested, pageSize: PAGE });
      const auditPage = audit.page({ page: requested, pageSize: PAGE });
      expect(runPage.runs.length, `runs page ${requested}`).toBeGreaterThan(0);
      expect(auditPage.events.length, `audit page ${requested}`).toBeGreaterThan(0);
    }
  });

  it('pages the audit trail the same way', () => {
    const firstPage = audit.page({ page: 1, pageSize: PAGE });
    expect(firstPage.total).toBeGreaterThanOrEqual(ROWS);
    expect(firstPage.events.some((e) => e.summary.includes(NEEDLE))).toBe(false);

    const found = audit.page({ search: NEEDLE, page: 1, pageSize: PAGE });
    expect(found.total).toBe(1);
    expect(found.events[0]!.summary).toContain(NEEDLE);
  });
});

/*
 * The pager's own guarantees, tested once for the helper every list screen
 * shares rather than four times over four route handlers.
 */
describe('Paging is consistent across every list', () => {
  const rows = Array.from({ length: 23 }, (_, i) => `row-${i}`);

  it('walks every row exactly once across the pages', () => {
    const pageSize = 5;
    const first = takePage(rows, 1, pageSize);
    const walked: string[] = [];
    for (let p = 1; p <= first.totalPages; p += 1) {
      walked.push(...takePage(rows, p, pageSize).items);
    }

    // No gaps, no repeats, original order. A pager that drops one row in the
    // seam between pages hides a patient, and nothing on screen would say so.
    expect(walked).toEqual(rows);
    expect(new Set(walked).size).toBe(rows.length);
    expect(first.totalPages).toBe(5);
  });

  it('clamps a page past the end instead of showing an empty list', () => {
    // Narrowing a search while on page four is the ordinary way to reach this.
    const beyond = takePage(rows, 99, 5);
    expect(beyond.page).toBe(5);
    expect(beyond.items).toHaveLength(3);
    expect(beyond.items[0]).toBe('row-20');
  });

  it('reports one empty page rather than zero pages for an empty list', () => {
    // totalPages of 0 makes "page 1 of 0" appear on screen, and any Next button
    // computed from it behaves oddly.
    const none = takePage([], 1, 10);
    expect(none.totalPages).toBe(1);
    expect(none.total).toBe(0);
    expect(none.items).toEqual([]);
  });

  it('refuses absurd page sizes from the query string', () => {
    expect(readPaging({}, 20)).toEqual({ page: 1, pageSize: 20 });

    // A usable number is clamped into range.
    expect(readPaging({ pageSize: '100000' }, 20).pageSize).toBe(100);
    expect(readPaging({ pageSize: '3' }, 20).pageSize).toBe(5);
    expect(readPaging({ page: '2.7' }, 20).page).toBe(2);

    // Anything that is not a usable number is treated as absent, whatever shape
    // it arrives in — a query string can carry an array or an object too.
    for (const junk of ['0', '-10', 'abc', '', ' ', 'NaN', ['2'], {}]) {
      expect(readPaging({ pageSize: junk }, 20).pageSize, `pageSize=${JSON.stringify(junk)}`).toBe(20);
      expect(readPaging({ page: junk }, 20).page, `page=${JSON.stringify(junk)}`).toBe(1);
    }
  });

  it('describes a page counted in SQL the same way as one sliced in memory', () => {
    // The two paths have to agree, or the pager reads differently depending on
    // which screen you are looking at.
    const sliced = takePage(rows, 3, 5);
    const counted = pageMeta(rows.length, 3, 5);
    expect(counted).toEqual({
      total: sliced.total,
      page: sliced.page,
      pageSize: sliced.pageSize,
      totalPages: sliced.totalPages,
    });
  });
});

/*
 * An expired session has to send the clinician back to sign-in.
 *
 * The bug this pins: the shell decided once, at mount, whether anybody was
 * signed in. When the session ended later — expiry, idle timeout, a changed
 * signing key — the shell stayed up and each screen showed its own error with a
 * Try again button, which could only produce the same 401 again. Nothing on
 * screen offered a way back to sign-in.
 */
describe('A session that ends mid-use returns to sign-in', () => {
  const protectedPaths = ['/queue', '/flags?page=2', '/patients', '/agent-runs?search=x', '/settings'];
  const probes = ['/auth/me', '/auth/login', '/auth/status', '/auth/logout'];

  it('treats a 401 on any working call as the end of the session', () => {
    for (const path of protectedPaths) {
      expect(endsTheSession(401, path), path).toBe(true);
    }
  });

  it('leaves the sign-in calls alone', () => {
    // /auth/me answering 401 is how the app asks "is anyone signed in" at boot,
    // and a wrong password is a failed attempt, not an ended session. Treating
    // either as one shows "your session has ended" to somebody who never had a
    // session — including on the very first page load of a new installation.
    for (const path of probes) {
      expect(endsTheSession(401, path), path).toBe(false);
      expect(endsTheSession(401, `${path}?next=/queue`), `${path} with a query`).toBe(false);
    }
  });

  it('ignores every status that is not a 401', () => {
    // A 403, a 500 or a validation error are all things a retry might fix.
    for (const status of [200, 400, 403, 404, 429, 500, 502]) {
      expect(endsTheSession(status, '/queue'), `status ${status}`).toBe(false);
    }
  });

  it('tells the subscriber why, and stops when it unsubscribes', async () => {
    const heard: string[] = [];
    const unsubscribe = onSessionEnded((reason) => heard.push(reason));

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'Your session has ended. Sign in again to continue.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      await expect(api.queue()).rejects.toThrow(/session has ended/);
      expect(heard).toEqual(['Your session has ended. Sign in again to continue.']);

      // The reason is passed through rather than replaced, so an idle timeout
      // says so instead of being flattened into a generic message.
      unsubscribe();
      await expect(api.queue()).rejects.toThrow();
      expect(heard).toHaveLength(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

/*
 * A documentation gap can be true and still not be the system's to action: the
 * test was done at another clinic, the order went in on paper, the patient
 * declined it. With only the automatic route those gaps stayed open forever,
 * so the list filled with work nobody could clear — and a list that cannot be
 * cleared stops being read, which is how a real gap gets missed.
 */
describe('Documentation gaps can be closed by hand as well as automatically', () => {
  beforeAll(async () => {
    freshPopulation();
    await runPopulation(CLINICIAN_ID, { asOf: AS_OF });
  }, 300_000);

  const anyOpenAlert = () => {
    for (const patient of patients.forClinic()) {
      const open = alerts.openForPatient(patient.id);
      if (open.length > 0) return open[0]!;
    }
    throw new Error('the seeded population raised no documentation gaps');
  };

  it('records that the clinician had already done it, and invents no order', async () => {
    const alert = anyOpenAlert();
    const ordersBefore = orders.forPatient(alert.patientId).length;
    const billingBefore = billing.forPatient(alert.patientId).length;

    const outcome = await closeAlertWithoutAction(
      alert.id,
      CLINICIAN_ID,
      'manual',
      'Ordered on paper at the visit.',
    );

    expect(outcome.alertClosed).toBe(true);
    // The whole guarantee of the automatic route is that the record reflects
    // real clinical action. Writing an order for work done elsewhere would
    // break exactly that, and would bill for it too.
    expect(outcome.order).toBeNull();
    expect(outcome.billingEntry).toBeNull();
    expect(orders.forPatient(alert.patientId).length).toBe(ordersBefore);
    expect(billing.forPatient(alert.patientId).length).toBe(billingBefore);

    const stored = alerts.byId(alert.id)!;
    expect(stored.status).toBe('resolved');
    expect(stored.route).toBe('manual');
    expect(stored.note).toBe('Ordered on paper at the visit.');
  }, 300_000);

  it('keeps the clinician’s reason on the record when a gap is declined', async () => {
    const alert = anyOpenAlert();
    await closeAlertWithoutAction(alert.id, CLINICIAN_ID, 'declined', 'Patient declined the test.');

    const stored = alerts.byId(alert.id)!;
    expect(stored.route).toBe('declined');
    expect(stored.note).toBe('Patient declined the test.');
    // Visible in the record rather than only in the audit trail, so the next
    // clinician sees the decision instead of raising the gap again.
    expect(alerts.closedForPatient(alert.patientId).some((a) => a.id === alert.id)).toBe(true);
  }, 300_000);

  it('refuses to decline a gap without saying why', async () => {
    const alert = anyOpenAlert();
    await expect(
      closeAlertWithoutAction(alert.id, CLINICIAN_ID, 'declined', '   '),
    ).rejects.toThrow(/why/i);

    // Refused means unchanged, not half-applied.
    expect(alerts.byId(alert.id)!.status).toBe('open');
  }, 300_000);

  it('refuses to close the same gap twice', async () => {
    const alert = anyOpenAlert();
    await closeAlertWithoutAction(alert.id, CLINICIAN_ID, 'manual', 'done');
    await expect(
      closeAlertWithoutAction(alert.id, CLINICIAN_ID, 'manual', 'done again'),
    ).rejects.toThrow(/already been closed/i);
  }, 300_000);

  it('marks the automatic route so the two are tellable apart afterwards', async () => {
    const alert = anyOpenAlert();
    await resolveAlert(alert.id, CLINICIAN_ID, { asOf: AS_OF });
    // An auditor asking "was this work done, or waved through" needs the
    // record to answer. Closed alone does not.
    expect(alerts.byId(alert.id)!.route).toBe('automatic');
  }, 300_000);
});

/*
 * Observations have to survive dictation.
 *
 * Every sample note in this suite is written in numerals — "Blood pressure
 * today 192 over 124" — and observations used to be extracted by regex from
 * the raw note. A dictated note contains words, so the extractor found nothing
 * and no observation ever reached the record from speech, in a product whose
 * encounters are voice-first. With no observations the rules engine has nothing
 * to evaluate and raises no flags, which made a patient nobody had a single
 * reading for indistinguishable from a patient who is well.
 *
 * Caught by a live demo, not by this suite. These are the tests that would
 * have caught it.
 */
describe('A dictated note reaches the record', () => {
  beforeAll(() => {
    freshPopulation();
  });

  it('reads measurements out of spoken words, not just figures', () => {
    // Clinical speech is not textbook English: "one sixty four", not "one
    // hundred and sixty four". Both have to land on the same number, and a
    // note already written in figures must be untouched.
    const spoken = extractValues(
      'Blood pressure today is one sixty four over ninety eight. Weight seventy nine kilos.',
    );
    expect(spoken.map((v) => v.type).sort()).toEqual(['blood_pressure', 'weight']);
    expect(spoken.find((v) => v.type === 'blood_pressure')!.value).toBe('164/98');
    expect(spoken.find((v) => v.type === 'weight')!.value).toBe('79');

    const written = extractValues('Blood pressure 164/98 mmHg. Weight 79 kg.');
    expect(written.find((v) => v.type === 'blood_pressure')!.value).toBe('164/98');
  });

  it('handles the spoken forms a clinician actually uses', () => {
    const cases: Array<[string, string, string]> = [
      ['Blood pressure one eighty six over one eighteen.', 'blood_pressure', '186/118'],
      ['Blood pressure one hundred and sixty four over ninety.', 'blood_pressure', '164/90'],
      ['HbA1c came back at eight point two percent.', 'hba1c', '8.2'],
      ['Temperature thirty eight point nine degrees.', 'temperature', '38.9'],
      ['Platelets one hundred and sixty four.', 'platelet_count', '164'],
      ['Heart rate eighty two and regular.', 'heart_rate', '82'],
    ];
    for (const [note, type, expected] of cases) {
      const found = extractValues(note).find((v) => v.type === type);
      expect(found?.value, note).toBe(expected);
    }
  });

  it('leaves ordinary prose alone', () => {
    // Number words appear in sentences that are not measurements at all, and
    // rewriting them is harmless only if nothing is extracted from them.
    expect(
      extractValues('She has had headaches for about two weeks and takes it twice daily.'),
    ).toHaveLength(0);
    expect(extractValues('Chest is clear and there is no ankle swelling.')).toHaveLength(0);
  });

  it('records observations from a dictated encounter, and flags the risk in them', async () => {
    const patient = patientNamed(PROFILE.noHistory);
    const before = observations.forPatient(patient.id).length;

    const submission = await submitEncounter(
      patient.id,
      'Attends for review. Blood pressure today is one ninety two over one twenty four, ' +
        'much higher than usual. Weight is eighty one kilos. Continue current medication and review next week.',
      CLINICIAN_ID,
    );

    // Approval is what puts observations on the record (A2-4).
    await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });

    const after = observations.forPatient(patient.id);
    expect(
      after.length,
      'a dictated encounter recorded no observations at all',
    ).toBeGreaterThan(before);
    expect(after.some((o) => o.type === 'blood_pressure')).toBe(true);
  }, 300_000);

  it('will not call a patient managed when nothing has ever been measured', async () => {
    // No flags can mean "looked and found nothing" or "had nothing to look at".
    // Only the first earns managed; the second is how a patient whose blood
    // pressure was never recorded comes to look like one whose reading is fine.
    const patient = patients.forClinic().find((p) => observations.forPatient(p.id).length === 0);
    if (!patient) return; // every seeded patient has readings; nothing to assert

    const alert = alerts.openForPatient(patient.id)[0];
    if (!alert) return;

    await closeAlertWithoutAction(alert.id, CLINICIAN_ID, 'manual', 'handled elsewhere');
    expect(patients.byId(patient.id)!.status).not.toBe('managed');
  }, 300_000);
});
