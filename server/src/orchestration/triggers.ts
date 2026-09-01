import { id, now } from '../db/index.ts';
import { patients, encounters, observations, populationRuns, runs } from '../db/repositories.ts';
import { assembleContext } from '../agents/intake.ts';
import { structureNote, extractValues } from '../agents/structuring.ts';
import { assessPatientRun, assessPopulation, rerankQueue } from '../agents/clinical-intelligence.ts';
import { scanPatientRun, scanPopulation } from '../agents/documentation.ts';
import { publish } from './events.ts';
import type {
  AgentTrigger,
  ContextBrief,
  Encounter,
  FieldConfidence,
  ObservationType,
  StructuredContent,
  StructuringResult,
} from '../../../shared/types.ts';

/**
 * Section 6 — orchestration and triggers.
 *
 *   encounter submit    Agent 1, then Agent 2, in sequence
 *   encounter approval  Agents 3 and 4 in parallel on the same event
 *   population run      Agents 3 and 4 across the whole population
 *
 * If one of Agents 3 or 4 fails, the other still delivers and the failure is
 * reported rather than swallowed. The loop is never failed on one agent.
 */

/* ----------------------------------------------------------- submit note -- */

export interface SubmissionResult {
  encounter: Encounter;
  brief: ContextBrief;
  structuring: StructuringResult;
  correlationId: string;
  timings: { intakeMs: number; structuringMs: number; totalMs: number };
}

/**
 * The clinician submits a note. Agents 1 and 2 run in sequence and both
 * complete before the review screen is shown.
 *
 * The encounter is persisted as `awaiting_approval`. It is not part of the
 * saved record: agents read history through `approvedForPatient`, so an
 * unapproved draft is invisible to them, and only `approveEncounter` can move
 * it to `approved` (DI-1).
 */
export async function submitEncounter(
  patientId: string,
  rawNote: string,
  clinicianId: string,
): Promise<SubmissionResult> {
  const startedAt = Date.now();
  const correlationId = id('corr');

  const patient = patients.byId(patientId);
  if (!patient) throw new Error(`Patient ${patientId} not found`);
  if (rawNote.trim().length === 0) throw new Error('The note is empty. Enter the encounter note before submitting.');

  /*
   * The note is written to the record before a single agent runs.
   *
   * PF-3 asks that an interrupted loop never costs the clinician what they
   * entered, and until now this function did the opposite: both agents ran
   * first and the insert came last, so a provider that was unreachable, out of
   * credit or rejecting the key threw before anything was stored and the
   * dictation existed only in a React state variable. One refresh and it was
   * gone. The schema has carried a `draft` status for exactly this the whole
   * time; nothing used it.
   *
   * So the row goes in first, empty of everything the agents produce, and is
   * promoted once they succeed. A failure now leaves a draft holding the
   * clinician's words.
   */
  const encounterId = id('enc');
  encounters.insert({
    id: encounterId,
    patientId,
    clinicianId,
    date: now().slice(0, 10),
    // A1-4: stored exactly as entered, and never overwritten.
    rawNote,
    structured: { subjective: '', objective: '', assessment: '', plan: '' },
    fieldConfidence: [],
    status: 'draft',
    approvedBy: null,
    approvedAt: null,
    version: 1,
    amendsEncounterId: null,
    amendedBy: null,
    amendedAt: null,
    contextBrief: null,
  });

  publish({ type: 'agent_started', agent: 'intake_and_context', correlationId, patientId });
  const intake = await assembleContext(patientId, rawNote, { trigger: 'encounter_submit', correlationId });
  publish({
    type: 'agent_finished',
    agent: 'intake_and_context',
    correlationId,
    patientId,
    outcome: 'success',
    durationMs: intake.durationMs,
    summary: intake.brief.hasPriorHistory
      ? `Considered ${intake.brief.consideredCount} prior encounters, selected ${intake.brief.selectedCount}`
      : 'No prior history on record',
  });

  publish({ type: 'agent_started', agent: 'record_structuring', correlationId, patientId });
  const structuring = await structureNote(patientId, rawNote, intake.brief, {
    trigger: 'encounter_submit',
    correlationId,
  });
  const flaggedCount = structuring.result.fieldConfidence.filter((f) => f.confidence === 'flagged').length;
  publish({
    type: 'agent_finished',
    agent: 'record_structuring',
    correlationId,
    patientId,
    outcome: 'success',
    durationMs: structuring.durationMs,
    summary: `${flaggedCount} field(s) flagged for review`,
  });

  // Both agents are done, so the draft becomes a note awaiting approval.
  encounters.completeStructuring(
    encounterId,
    structuring.result.structured,
    structuring.result.fieldConfidence,
    intake.brief,
  );
  const encounter = encounters.byId(encounterId)!;

  return {
    encounter,
    brief: intake.brief,
    structuring: structuring.result,
    correlationId,
    timings: {
      intakeMs: intake.durationMs,
      structuringMs: structuring.durationMs,
      totalMs: Date.now() - startedAt,
    },
  };
}

/* --------------------------------------------------------------- approve -- */

export interface ApprovalResult {
  encounterId: string;
  correlationId: string;
  /** Present when Agent 3 succeeded. */
  assessment: Awaited<ReturnType<typeof assessPatientRun>> | null;
  /** Present when Agent 4 succeeded. */
  documentation: Awaited<ReturnType<typeof scanPatientRun>> | null;
  /** Section 6: a failed agent is reported, and never fails the whole loop. */
  failures: Array<{ agent: 'clinical_intelligence' | 'documentation_and_compliance'; message: string }>;
  /** Proof of overlap for OR-1, read back out of the run log. */
  parallelism: { maxConcurrency: number; overlapped: boolean };
  durationMs: number;
}

/**
 * Human decision point one. Approval is the only path that saves the record,
 * and it is what fires Agents 3 and 4 — in parallel, on the same event.
 */
export async function approveEncounter(
  encounterId: string,
  clinicianId: string,
  options: {
    /** Corrections the clinician made on the review screen. */
    edits?: Partial<StructuredContent>;
    /** Field confidence after the clinician resolved (or kept) the flags. */
    fieldConfidence?: FieldConfidence[];
    asOf?: Date;
  } = {},
): Promise<ApprovalResult> {
  const startedAt = Date.now();
  const encounter = encounters.byId(encounterId);
  if (!encounter) throw new Error(`Encounter ${encounterId} not found`);
  if (encounter.status === 'approved') throw new Error('That encounter has already been approved.');
  /*
   * A draft is a note whose agents never finished — the structuring failed and
   * the row was kept so the words were not lost. Approving one would save an
   * encounter with empty S/O/A/P into the record and hand it to Agents 3 and 4
   * as history.
   */
  if (encounter.status === 'draft') {
    throw new Error('This note has not been structured yet. Submit it again before approving.');
  }

  const correlationId = id('corr');
  const asOf = options.asOf ?? new Date();

  if (options.edits || options.fieldConfidence) {
    encounters.updateStructured(
      encounterId,
      { ...encounter.structured, ...options.edits },
      options.fieldConfidence ?? encounter.fieldConfidence,
    );
  }

  // The only path to a saved record.
  encounters.approve(encounterId, clinicianId, now());

  // Observations extracted by Agent 2 become part of the record on approval,
  // not before. A value the clinician left flagged is recorded as flagged.
  const approved = encounters.byId(encounterId)!;
  persistObservations(approved, asOf);

  publish({ type: 'agent_started', agent: 'clinical_intelligence', correlationId, patientId: encounter.patientId });
  publish({
    type: 'agent_started',
    agent: 'documentation_and_compliance',
    correlationId,
    patientId: encounter.patientId,
  });

  // Section 6: fired in parallel on the same event. allSettled rather than all,
  // so one agent failing never takes the other down with it (OR-3, OR-4).
  const [clinical, documentation] = await Promise.allSettled([
    assessPatientRun(encounter.patientId, {
      asOf,
      trigger: 'encounter_approval',
      correlationId,
      encounterId,
    }),
    scanPatientRun(encounter.patientId, {
      asOf,
      trigger: 'encounter_approval',
      correlationId,
      encounterId,
    }),
  ]);

  const failures: ApprovalResult['failures'] = [];

  // The patient's flags have changed, so their place in the queue has too.
  // Without this they keep the position the last population run gave them, and
  // a patient who has just become critical can sit below a watch patient.
  if (clinical.status === 'fulfilled') rerankQueue(clinicianId);

  if (clinical.status === 'fulfilled') {
    publish({
      type: 'agent_finished',
      agent: 'clinical_intelligence',
      correlationId,
      patientId: encounter.patientId,
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      summary: `${clinical.value.flags.length} flag(s), status ${clinical.value.status}`,
    });
    publish({
      type: 'patient_updated',
      patientId: encounter.patientId,
      status: clinical.value.status,
      correlationId,
    });
  } else {
    const message = messageOf(clinical.reason);
    failures.push({ agent: 'clinical_intelligence', message });
    publish({
      type: 'agent_finished',
      agent: 'clinical_intelligence',
      correlationId,
      patientId: encounter.patientId,
      outcome: 'failure',
      durationMs: Date.now() - startedAt,
      summary: message,
    });
  }

  if (documentation.status === 'fulfilled') {
    publish({
      type: 'agent_finished',
      agent: 'documentation_and_compliance',
      correlationId,
      patientId: encounter.patientId,
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      summary: `${documentation.value.raised.length} alert(s) raised`,
    });
  } else {
    const message = messageOf(documentation.reason);
    failures.push({ agent: 'documentation_and_compliance', message });
    publish({
      type: 'agent_finished',
      agent: 'documentation_and_compliance',
      correlationId,
      patientId: encounter.patientId,
      outcome: 'failure',
      durationMs: Date.now() - startedAt,
      summary: message,
    });
  }

  publish({ type: 'queue_updated', clinicianId, correlationId });

  return {
    encounterId,
    correlationId,
    assessment: clinical.status === 'fulfilled' ? clinical.value : null,
    documentation: documentation.status === 'fulfilled' ? documentation.value : null,
    failures,
    parallelism: parallelismFor(correlationId),
    durationMs: Date.now() - startedAt,
  };
}

/** OR-1: read the overlap back out of the run log rather than asserting it. */
export function parallelismFor(correlationId: string): { maxConcurrency: number; overlapped: boolean } {
  const entries = runs.byCorrelation(correlationId).filter(
    (r) => r.agent === 'clinical_intelligence' || r.agent === 'documentation_and_compliance',
  );
  const maxConcurrency = entries.reduce((max, r) => Math.max(max, r.concurrencyAtStart), 0);
  return { maxConcurrency, overlapped: maxConcurrency >= 2 };
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Observations reach the record only on approval, never before (A2-4).
 *
 * A value the clinician left flagged is not recorded: a weight with no unit
 * cannot be stored as kilograms without making exactly the guess Agent 2
 * refused to make. A contradiction the clinician did not resolve is likewise
 * left out rather than silently picking one of the two readings.
 *
 * Read from the **approved objective section, not the raw note**, for two
 * reasons that both come down to accuracy:
 *
 * 1. A dictated note contains words, not numerals — "one sixty four over
 *    ninety eight". The extractor matches digits, so reading the raw note
 *    captured nothing at all from speech, in a product whose encounters are
 *    voice-first. Agent 2 has already normalised those words into figures.
 * 2. The raw note is never modified (A1-4), so a correction the clinician made
 *    on the review screen was invisible here. The uncorrected value went onto
 *    the record and the corrected one did not.
 *
 * The failure mode this fixes is the worst one available: with no observations
 * the rules engine has nothing to evaluate, so it raises no flags, and a
 * patient nobody has any readings for is indistinguishable from a patient who
 * is well.
 */
function persistObservations(encounter: Encounter, asOf: Date): void {
  const unresolvedContradiction = encounter.fieldConfidence.some(
    (f) => f.confidence === 'flagged' && (f.readings?.length ?? 0) >= 2,
  );

  const extracted = extractValues(encounter.structured.objective).filter(
    (e) => e.type !== 'blood_glucose' && !e.flagged,
  );

  const byType = new Map<string, typeof extracted>();
  for (const item of extracted) {
    byType.set(item.type, [...(byType.get(item.type) ?? []), item]);
  }

  for (const [, items] of byType) {
    // Two different readings of one measure that the clinician did not settle.
    const distinct = new Set(items.map((i) => i.value));
    if (unresolvedContradiction && distinct.size > 1) continue;

    const item = items[items.length - 1];
    if (!item) continue;

    observations.insert({
      id: id('obs'),
      patientId: encounter.patientId,
      encounterId: encounter.id,
      type: item.type as ObservationType,
      value: item.value,
      unit: item.unit,
      recordedOn: asOf.toISOString().slice(0, 10),
      overdue: false,
    });
  }
}

/* -------------------------------------------------------- population run -- */

export interface PopulationRunResult {
  runId: string;
  correlationId: string;
  assessed: number;
  alertsRaised: number;
  failures: Array<{ agent: string; message: string }>;
  parallelism: { maxConcurrency: number; overlapped: boolean };
  durationMs: number;
}

/**
 * The population run of Section 6. This is what populates the queue before any
 * encounter exists (PR-1) and the recovery path when the queue looks stale.
 */
export async function runPopulation(
  clinicianId: string,
  options: { asOf?: Date; trigger?: AgentTrigger } = {},
): Promise<PopulationRunResult> {
  const startedAt = Date.now();
  const correlationId = id('corr');
  const asOf = options.asOf ?? new Date();
  const runId = populationRuns.start(clinicianId);

  publish({ type: 'agent_started', agent: 'clinical_intelligence', correlationId, patientId: null });
  publish({ type: 'agent_started', agent: 'documentation_and_compliance', correlationId, patientId: null });

  // Carried through to the run log so a sweep that nobody asked for is
  // distinguishable from one somebody clicked. That distinction is the whole
  // reason automations are worth having a run log for.
  const trigger = options.trigger ?? 'population_run';

  const [clinical, documentation] = await Promise.allSettled([
    assessPopulation(clinicianId, { asOf, trigger, correlationId }),
    scanPopulation(clinicianId, { asOf, trigger, correlationId }),
  ]);

  const failures: PopulationRunResult['failures'] = [];

  if (clinical.status === 'fulfilled') {
    publish({
      type: 'agent_finished',
      agent: 'clinical_intelligence',
      correlationId,
      patientId: null,
      outcome: 'success',
      durationMs: clinical.value.durationMs,
      summary: `${clinical.value.assessed} patients assessed and ranked`,
    });
  } else {
    failures.push({ agent: 'clinical_intelligence', message: messageOf(clinical.reason) });
    publish({
      type: 'agent_finished',
      agent: 'clinical_intelligence',
      correlationId,
      patientId: null,
      outcome: 'failure',
      durationMs: Date.now() - startedAt,
      summary: messageOf(clinical.reason),
    });
  }

  if (documentation.status === 'fulfilled') {
    publish({
      type: 'agent_finished',
      agent: 'documentation_and_compliance',
      correlationId,
      patientId: null,
      outcome: 'success',
      durationMs: documentation.value.durationMs,
      summary: `${documentation.value.raised} alert(s) raised`,
    });
  } else {
    failures.push({ agent: 'documentation_and_compliance', message: messageOf(documentation.reason) });
    publish({
      type: 'agent_finished',
      agent: 'documentation_and_compliance',
      correlationId,
      patientId: null,
      outcome: 'failure',
      durationMs: Date.now() - startedAt,
      summary: messageOf(documentation.reason),
    });
  }

  const assessed = clinical.status === 'fulfilled' ? clinical.value.assessed : 0;
  const alertsRaised = documentation.status === 'fulfilled' ? documentation.value.raised : 0;
  const outcome = failures.length === 0 ? 'success' : failures.length === 2 ? 'failure' : 'partial';

  populationRuns.finish(
    runId,
    outcome,
    assessed,
    failures.length > 0 ? failures.map((f) => `${f.agent}: ${f.message}`).join('; ') : undefined,
  );

  publish({ type: 'population_run_finished', clinicianId, outcome, assessed, correlationId });
  publish({ type: 'queue_updated', clinicianId, correlationId });

  return {
    runId,
    correlationId,
    assessed,
    alertsRaised,
    failures,
    parallelism: parallelismFor(correlationId),
    durationMs: Date.now() - startedAt,
  };
}

/* ------------------------------------------------------------- amendment -- */

export interface AmendmentResult {
  originalEncounterId: string;
  newEncounterId: string;
  version: number;
  correlationId: string;
  assessment: Awaited<ReturnType<typeof assessPatientRun>> | null;
}

/**
 * AM-1 to AM-3: an approved encounter can be amended. A new version is created,
 * the original is preserved and still viewable, who amended it and when are
 * recorded, and assessment re-triggers for that patient.
 */
export async function amendEncounter(
  encounterId: string,
  clinicianId: string,
  edits: Partial<StructuredContent>,
  options: { asOf?: Date } = {},
): Promise<AmendmentResult> {
  const original = encounters.byId(encounterId);
  if (!original) throw new Error(`Encounter ${encounterId} not found`);
  if (original.status !== 'approved') throw new Error('Only an approved encounter can be amended.');

  const correlationId = id('corr');
  const timestamp = now();

  const amended: Encounter = {
    ...original,
    id: id('enc'),
    structured: { ...original.structured, ...edits },
    status: 'approved',
    approvedBy: clinicianId,
    approvedAt: timestamp,
    version: original.version + 1,
    amendsEncounterId: original.id,
    amendedBy: clinicianId,
    amendedAt: timestamp,
  };
  encounters.insert(amended);

  // The original is preserved exactly as it was, and stays viewable.
  const assessment = await assessPatientRun(original.patientId, {
    asOf: options.asOf ?? new Date(),
    trigger: 'encounter_amendment',
    correlationId,
    encounterId: amended.id,
  });
  rerankQueue(clinicianId);

  publish({
    type: 'patient_updated',
    patientId: original.patientId,
    status: assessment.status,
    correlationId,
  });
  publish({ type: 'queue_updated', clinicianId, correlationId });

  return {
    originalEncounterId: original.id,
    newEncounterId: amended.id,
    version: amended.version,
    correlationId,
    assessment,
  };
}
