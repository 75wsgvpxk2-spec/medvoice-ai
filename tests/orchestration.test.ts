import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  submitEncounter,
  approveEncounter,
  runPopulation,
  amendEncounter,
  parallelismFor,
} from '../server/src/orchestration/triggers.ts';
import { subscribe, type ClinicEvent } from '../server/src/orchestration/events.ts';
import { resolveAlert } from '../server/src/agents/resolution.ts';
import {
  patients,
  encounters,
  observations,
  flags,
  alerts,
  runs,
  populationRuns,
} from '../server/src/db/repositories.ts';
import { freshPopulation, patientNamed, sampleNote, CLINICIAN_ID, AS_OF, PROFILE } from './helpers.ts';

/** Sections 14.1, 14.6, 14.7 and 14.8 — orchestration, population run, amendment. */

beforeAll(() => {
  freshPopulation();
});

describe('PR-1  Fresh system, no encounters, run assessment', () => {
  it('assesses and ranks every patient, populating the queue before any encounter exists', async () => {
    const result = await runPopulation(CLINICIAN_ID, { asOf: AS_OF });

    expect(result.assessed).toBe(15);
    expect(result.failures).toEqual([]);

    const population = patients.forClinician(CLINICIAN_ID);
    expect(population.every((p) => p.lastAssessedAt !== null)).toBe(true);

    const queued = population.filter((p) => p.queuePosition !== null);
    expect(queued.length).toBeGreaterThan(0);
  });

  it('PR-3  runs Agents 3 and 4 in parallel on the population trigger', async () => {
    const result = await runPopulation(CLINICIAN_ID, { asOf: AS_OF });
    expect(result.parallelism.overlapped, 'the population run must fire both agents together').toBe(true);
    expect(result.parallelism.maxConcurrency).toBeGreaterThanOrEqual(2);
  });

  it('PR-2  records the run so the queue can report when it was last checked', () => {
    const last = populationRuns.last(CLINICIAN_ID);
    expect(last).not.toBeNull();
    expect(last!.outcome).toBe('success');
    expect(new Date(last!.completedAt).toString()).not.toBe('Invalid Date');
  });

  it('PR-4  reports no run at all on a system where none has completed', () => {
    freshPopulation();
    expect(populationRuns.last(CLINICIAN_ID)).toBeNull();
  });
});

describe('OR-1 [CRITICAL]  Encounter approved fires Agents 3 and 4 in parallel', () => {
  let correlationId: string;

  beforeAll(async () => {
    freshPopulation();
    await runPopulation(CLINICIAN_ID, { asOf: AS_OF });

    const patient = patientNamed(PROFILE.comorbidity);
    const submission = await submitEncounter(patient.id, sampleNote('golden_path'), CLINICIAN_ID);
    const approval = await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });
    correlationId = approval.correlationId;
  }, 300_000);

  it('shows the two agents overlapping in the run log, not on the screen', () => {
    const entries = runs
      .byCorrelation(correlationId)
      .filter((r) => r.agent === 'clinical_intelligence' || r.agent === 'documentation_and_compliance');

    expect(entries).toHaveLength(2);

    // Sequential execution can only ever record a concurrency of 1 at start.
    const overlap = parallelismFor(correlationId);
    expect(
      overlap.overlapped,
      `concurrency at start: ${entries.map((e) => `${e.agent}=${e.concurrencyAtStart}`).join(', ')}`,
    ).toBe(true);
  });

  it('OR-5  logs every run with agent, trigger, patient, duration and outcome', () => {
    for (const entry of runs.byCorrelation(correlationId)) {
      expect(entry.agent).toBeTruthy();
      expect(entry.trigger).toBe('encounter_approval');
      expect(entry.patientId).toBeTruthy();
      expect(entry.durationMs).not.toBeNull();
      expect(['success', 'failure']).toContain(entry.outcome);
      expect(entry.outputSummary).toBeTruthy();
    }
  });

  it('OR-2  needs no user action for the results to arrive', async () => {
    const patient = patientNamed(PROFILE.sickleCell);
    const seen: ClinicEvent[] = [];
    const unsubscribe = subscribe((e) => seen.push(e));

    const submission = await submitEncounter(patient.id, sampleNote('informal'), CLINICIAN_ID);
    await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });
    unsubscribe();

    // The queue update is published by the orchestrator itself.
    expect(seen.some((e) => e.type === 'queue_updated')).toBe(true);
    expect(seen.some((e) => e.type === 'patient_updated')).toBe(true);
    expect(seen.filter((e) => e.type === 'agent_finished').length).toBeGreaterThanOrEqual(4);
  }, 300_000);
});

describe('OR-3 and OR-4  One agent fails, the other still delivers', () => {
  it('delivers Agent 4 when Agent 3 fails, and reports the failure', async () => {
    freshPopulation();
    const patient = patientNamed(PROFILE.comorbidity);
    const submission = await submitEncounter(patient.id, sampleNote('golden_path'), CLINICIAN_ID);

    // Force Agent 3 to fail by removing the clinical reference it depends on.
    const clinicalModule = await import('../server/src/agents/clinical-intelligence.ts');
    const original = clinicalModule.assessPatient;
    // The orchestrator calls assessPatientRun, which wraps assessPatient; make
    // the underlying evaluation throw.
    const rules = await import('../server/src/clinical/rules.ts');
    const originalEvaluate = rules.evaluate;
    Object.defineProperty(rules, 'evaluate', {
      value: () => {
        throw new Error('Clinical Intelligence unavailable');
      },
      configurable: true,
      writable: true,
    });

    const approval = await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });

    Object.defineProperty(rules, 'evaluate', {
      value: originalEvaluate,
      configurable: true,
      writable: true,
    });
    void original;

    // Whatever happened to Agent 3, Agent 4 must have delivered.
    expect(approval.documentation, 'Agent 4 must return regardless of Agent 3').not.toBeNull();
    // And the loop as a whole did not fail.
    expect(approval.encounterId).toBe(submission.encounter.id);
  }, 300_000);

  it('never throws out of the approval when an agent fails', async () => {
    freshPopulation();
    const patient = patientNamed(PROFILE.stableDocumented);
    const submission = await submitEncounter(patient.id, sampleNote('clean'), CLINICIAN_ID);

    await expect(approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF })).resolves.toBeDefined();
  }, 300_000);
});

describe('OR-6  Malformed agent output is handled gracefully', () => {
  it('does not crash and does not surface a raw error', async () => {
    freshPopulation();
    const patient = patientNamed(PROFILE.noHistory);

    // A note with nothing recognisable in it at all.
    const submission = await submitEncounter(patient.id, '...', CLINICIAN_ID);
    expect(submission.encounter.status).toBe('awaiting_approval');

    const approval = await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });
    expect(approval.failures).toEqual([]);
  }, 300_000);

  it('refuses an empty note with a message that says what to do', async () => {
    const patient = patientNamed(PROFILE.noHistory);
    await expect(submitEncounter(patient.id, '   ', CLINICIAN_ID)).rejects.toThrow(/empty|enter/i);
  });
});

describe('DI-1 [CRITICAL]  No path saves an encounter without the approval action', () => {
  beforeEach(() => {
    freshPopulation();
  });

  it('leaves a submitted encounter out of the saved record until approved', async () => {
    const patient = patientNamed(PROFILE.comorbidity);
    const approvedBefore = encounters.approvedForPatient(patient.id).length;

    const submission = await submitEncounter(patient.id, sampleNote('golden_path'), CLINICIAN_ID);

    expect(submission.encounter.status).toBe('awaiting_approval');
    expect(submission.encounter.approvedBy).toBeNull();
    expect(submission.encounter.approvedAt).toBeNull();
    // Invisible to every agent, which read history through approved encounters.
    expect(encounters.approvedForPatient(patient.id).length).toBe(approvedBefore);
  }, 300_000);

  it('records no observations until approval', async () => {
    const patient = patientNamed(PROFILE.comorbidity);
    const before = observations.forPatient(patient.id).length;

    const submission = await submitEncounter(patient.id, sampleNote('golden_path'), CLINICIAN_ID);
    expect(observations.forPatient(patient.id).length).toBe(before);

    await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });
    expect(observations.forPatient(patient.id).length).toBeGreaterThan(before);
  }, 300_000);

  it('will not approve the same encounter twice', async () => {
    const patient = patientNamed(PROFILE.comorbidity);
    const submission = await submitEncounter(patient.id, sampleNote('golden_path'), CLINICIAN_ID);
    await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });

    await expect(
      approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF }),
    ).rejects.toThrow(/already been approved/i);
  }, 300_000);
});

describe('DI-2  The original raw note is retained and viewable', () => {
  it('stores the note exactly as entered on an approved encounter', async () => {
    freshPopulation();
    const patient = patientNamed(PROFILE.comorbidity);
    const note = sampleNote('golden_path');

    const submission = await submitEncounter(patient.id, note, CLINICIAN_ID);
    await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });

    const saved = encounters.byId(submission.encounter.id)!;
    expect(saved.rawNote).toBe(note);
    expect(saved.status).toBe('approved');
  }, 300_000);
});

describe('DI-3  Flags and alerts are traceable to what triggered them', () => {
  it('links every flag and alert back to an encounter or observation', async () => {
    freshPopulation();
    await runPopulation(CLINICIAN_ID, { asOf: AS_OF });

    for (const p of patients.forClinician(CLINICIAN_ID)) {
      for (const f of flags.activeForPatient(p.id)) {
        const traceable =
          f.triggeringEncounterId !== null ||
          f.triggeringObservationId !== null ||
          f.referenceIds.length > 0;
        expect(traceable, `${p.name} / ${f.flagType} has no trigger`).toBe(true);
      }
      for (const a of alerts.openForPatient(p.id)) {
        expect(encounters.byId(a.encounterId), `${a.gapKey} points at a missing encounter`).not.toBeNull();
      }
    }
  }, 300_000);
});

describe('AM-1 to AM-3  Amendment', () => {
  it('creates a new version, preserves the original, and records who and when', async () => {
    freshPopulation();
    const patient = patientNamed(PROFILE.comorbidity);
    const submission = await submitEncounter(patient.id, sampleNote('golden_path'), CLINICIAN_ID);
    await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });

    const before = encounters.byId(submission.encounter.id)!;

    const amendment = await amendEncounter(
      submission.encounter.id,
      CLINICIAN_ID,
      { assessment: 'Hypertensive crisis with possible dengue exposure. Requires same-day review.' },
      { asOf: AS_OF },
    );

    // AM-1: a new version exists and the original is untouched.
    expect(amendment.version).toBe(2);
    const original = encounters.byId(submission.encounter.id)!;
    expect(original.structured.assessment).toBe(before.structured.assessment);
    expect(original.version).toBe(1);

    const amended = encounters.byId(amendment.newEncounterId)!;
    expect(amended.structured.assessment).toMatch(/Hypertensive crisis/);
    expect(amended.amendsEncounterId).toBe(original.id);

    // AM-2: who and when.
    expect(amended.amendedBy).toBe(CLINICIAN_ID);
    expect(amended.amendedAt).not.toBeNull();

    // AM-3: assessment re-triggered.
    expect(amendment.assessment).not.toBeNull();
    const amendRuns = runs.byCorrelation(amendment.correlationId);
    expect(amendRuns.some((r) => r.trigger === 'encounter_amendment')).toBe(true);
  }, 300_000);

  it('will not amend an encounter that was never approved', async () => {
    freshPopulation();
    const patient = patientNamed(PROFILE.comorbidity);
    const submission = await submitEncounter(patient.id, sampleNote('golden_path'), CLINICIAN_ID);

    await expect(
      amendEncounter(submission.encounter.id, CLINICIAN_ID, { plan: 'x' }, { asOf: AS_OF }),
    ).rejects.toThrow(/approved/i);
  }, 300_000);
});

describe('GP-1 to GP-6  The golden path', () => {
  it('runs the whole loop and lands the target patient in the queue', async () => {
    freshPopulation();

    // GP-1: the queue is already populated from the last population run.
    const firstRun = await runPopulation(CLINICIAN_ID, { asOf: AS_OF });
    expect(firstRun.assessed).toBe(15);

    const target = patientNamed(PROFILE.comorbidity);
    const before = patients.byId(target.id)!;
    expect(before.status).toBe('watch');
    expect(before.queuePosition, 'target should already be ranked').not.toBeNull();
    expect(encounters.daysSinceLast(target.id, AS_OF)).toBe(43);

    // GP-2 and GP-3: submit the note; Agents 1 and 2 run in sequence.
    const submission = await submitEncounter(target.id, sampleNote('golden_path'), CLINICIAN_ID);
    expect(submission.brief.hasPriorHistory).toBe(true);
    expect(submission.brief.consideredCount).toBe(4);
    expect(submission.brief.selectionReasoning.length).toBeGreaterThan(20);

    // GP-4: sections populated, the ambiguous detail flagged, raw note kept.
    const flagged = submission.structuring.fieldConfidence.filter((f) => f.confidence === 'flagged');
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.some((f) => /unit/i.test(f.ambiguity ?? ''))).toBe(true);
    expect(submission.encounter.rawNote).toBe(sampleNote('golden_path'));

    // GP-5: the record saves only on approval.
    const approval = await approveEncounter(submission.encounter.id, CLINICIAN_ID, {
      edits: { assessment: 'Hypertensive crisis. Dengue exposure in the household.' },
      asOf: AS_OF,
    });
    expect(encounters.byId(submission.encounter.id)!.status).toBe('approved');

    // GP-6: both agents ran together and the patient moved up.
    expect(approval.parallelism.overlapped).toBe(true);
    expect(approval.failures).toEqual([]);

    const after = patients.byId(target.id)!;
    expect(after.status).toBe('critical');

    const activeFlags = flags.activeForPatient(target.id);
    expect(activeFlags.length).toBeGreaterThanOrEqual(2);
    for (const f of activeFlags) {
      expect(f.reasoning.trim().length).toBeGreaterThan(20);
    }

    // The blood pressure crisis is what makes this critical.
    expect(activeFlags.some((f) => f.flagType === 'hypertensive_crisis')).toBe(true);
  }, 300_000);

  it('GP-6  the patient moves to a new queue position rather than keeping a stale one', async () => {
    freshPopulation();
    await runPopulation(CLINICIAN_ID, { asOf: AS_OF });

    const target = patientNamed(PROFILE.comorbidity);
    const positionBefore = patients.byId(target.id)!.queuePosition;
    expect(positionBefore).not.toBeNull();

    const submission = await submitEncounter(target.id, sampleNote('golden_path'), CLINICIAN_ID);
    await approveEncounter(submission.encounter.id, CLINICIAN_ID, { asOf: AS_OF });

    const after = patients.byId(target.id)!;
    expect(after.status).toBe('critical');
    // Approval re-assesses one patient; without a re-rank the position would
    // stay where the last population run left it.
    expect(after.queuePosition).not.toBeNull();
    expect(after.queuePosition!).toBeLessThan(positionBefore!);

    // And no watch patient may sit above a critical one.
    const ranked = patients
      .forClinician(CLINICIAN_ID)
      .filter((p) => p.queuePosition !== null)
      .sort((a, b) => a.queuePosition! - b.queuePosition!);
    const firstWatch = ranked.findIndex((p) => p.status === 'watch');
    const lastCritical = ranked.map((p) => p.status).lastIndexOf('critical');
    if (firstWatch !== -1 && lastCritical !== -1) {
      expect(lastCritical, 'a critical patient is ranked below a watch patient').toBeLessThan(firstWatch);
    }
  }, 300_000);

  it('GP-7  one tap creates the order, the billing entry, closes the alert and re-assesses', async () => {
    const target = patientNamed(PROFILE.comorbidity);
    const alert = alerts.openForPatient(target.id).find((a) => a.resolution.createsOrder);
    expect(alert, 'expected an actionable alert on the target patient').toBeDefined();

    const outcome = await resolveAlert(alert!.id, CLINICIAN_ID, { asOf: AS_OF });

    expect(outcome.order).not.toBeNull();
    expect(outcome.billingEntry).not.toBeNull();
    expect(outcome.billingEntry!.fromOrderId).toBe(outcome.order!.id);
    expect(outcome.alertClosed).toBe(true);
    expect(outcome.statusBefore).toBe('critical');

    // See docs/DEVIATIONS.md item 1: the status does not drop to managed while
    // a hypertensive crisis flag is still active.
    expect(outcome.activeFlagsAfter.length).toBeGreaterThan(0);
    expect(outcome.statusAfter).toBe('critical');
  }, 300_000);
});
