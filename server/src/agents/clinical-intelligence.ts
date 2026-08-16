import { createHash } from 'node:crypto';
import { id, now } from '../db/index.ts';
import { patients, encounters, observations, flags, runs } from '../db/repositories.ts';
import { callAgent, cacheKeyFor } from '../model/provider.ts';
import { evaluate, rankScore, urgencyOf, type Finding, type PatientEvidence } from '../clinical/rules.ts';
import type {
  AgentTrigger,
  Patient,
  PatientStatus,
  RiskFlag,
} from '../../../shared/types.ts';

/**
 * Agent 3 — Clinical Intelligence (Section 5).
 *
 * Trigger: an encounter reaches approved status, or a population run.
 * Input:   the patient or population in scope, the full records, the whole population.
 * Output:  risk flags with urgency, one sentence of reasoning, and a recommended
 *          action; an updated status per patient; a re-ranked priority queue.
 *
 * The encoded logic in clinical/rules.ts decides what is clinically significant,
 * using only thresholds sourced in docs/clinical-reference.md. This agent decides
 * how to say it, how the findings relate to each other, and where the patient
 * belongs in the queue.
 */

const AGENT = 'clinical_intelligence' as const;

const SYSTEM_PROMPT = `You write the clinical reasoning shown to a clinician in a patient prioritisation tool used in Caribbean primary care.

You are given a patient and a set of findings that have already been established by encoded clinical rules. The rules decided what is significant. Your job is only to put each finding into one sentence of clinical language, and to say what the clinician might do about it.

How to write the reasoning:
- One sentence per finding, and it must fit on one line of a list — roughly 15 to 25 words, never more than 30. A clinician scans these down a ranked queue at a glance; a sentence that wraps to four lines pushes the next patient off the screen and defeats the ranking.
- Say the most decision-relevant thing. Cut anything the clinician can see elsewhere on the row: the patient's age, their sex, how long since they were seen. Do not restate the diagnosis they already know about.
- Plain clinical language a nurse or physician would use in handover.
- Where findings relate to each other, connect them. A patient with diabetes and hypertension both off target is at higher combined risk than either alone, and the sentence should say so rather than listing them separately.
- Where a finding describes a trend, say what the trend is doing, not just the latest number. "Risen from 6.6% to 8.7% across five readings" is better than "HbA1c is 8.7%".
- Use the numbers you are given. Never introduce a threshold, cut-off, or number that is not in the facts provided. Do not compute elapsed times or convert dates into day counts — if a day count matters it is already in the facts.
- When a finding is marked "assessment uncertain", the sentence must say plainly that this is uncertain — use the word "uncertain" — and say what the system could not assess. A clinician reading it has to be able to tell at a glance that the system is flagging a limitation rather than making a judgement.
- Vary the phrasing naturally between patients. These sentences are read one after another down a list, and they must not read as one template with values substituted.

How to write the recommended action:
- Advisory only. The clinician decides. Write "consider", "review", "arrange", "assess" — never instruct, never state a diagnosis, and never say the system has ordered or prescribed anything.
- Keep it to a short phrase.

Never imply a diagnosis. The system surfaces and ranks; the clinician decides.`;

const REASONING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          flagType: { type: 'string' },
          reasoning: { type: 'string' },
          recommendedAction: { type: 'string' },
        },
        required: ['flagType', 'reasoning', 'recommendedAction'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
};

interface ReasoningOutput {
  findings: Array<{ flagType: string; reasoning: string; recommendedAction: string }>;
}

function evidenceFor(patient: Patient, asOf: Date): PatientEvidence {
  return {
    patient,
    observations: observations.forPatient(patient.id),
    encounters: encounters.approvedForPatient(patient.id),
    daysSinceLastEncounter: encounters.daysSinceLast(patient.id, asOf),
  };
}

/**
 * FD-4 (per the Section 16 answer): a dismissed flag stays suppressed while the
 * clinical picture is unchanged, and returns only when the underlying data moves
 * materially. The fingerprint is the facts that produced the finding, so a new
 * value that crosses a threshold produces a different fingerprint.
 */
export function fingerprintOf(finding: Finding): string {
  return createHash('sha256').update(JSON.stringify(finding.facts)).digest('hex').slice(0, 24);
}

function describePatient(patient: Patient, evidence: PatientEvidence): string {
  const lines = [
    `Patient: ${patient.age} year old ${patient.sex}`,
    `Conditions: ${patient.conditions.map((c) => c.name).join(', ') || 'none recorded'}`,
    `Medications: ${patient.medications.map((m) => `${m.name} ${m.dose} ${m.frequency}`).join('; ') || 'none'}`,
    `Last seen: ${evidence.daysSinceLastEncounter === null ? 'never' : `${evidence.daysSinceLastEncounter} days ago`}`,
  ];
  const latest = evidence.encounters[0];
  if (latest) {
    lines.push(`Most recent assessment: ${latest.structured.assessment}`);
  }
  return lines.join('\n');
}

function fallbackReasoning(findings: Finding[]): ReasoningOutput {
  // Without a model, wording comes from the rules layer. Comorbidity is still
  // connected, but the sentences are templated — CS-5 is weaker on this path.
  const connected =
    findings.length > 1 &&
    findings.some((f) => f.flagType.startsWith('diabetes')) &&
    findings.some((f) => f.flagType.startsWith('hypertension'));

  return {
    findings: findings.map((f, index) => ({
      flagType: f.flagType,
      reasoning:
        connected && index === 0
          ? `${f.fallbackReasoning} Combined with the other findings on this patient, the overall cardiovascular risk is higher than either problem alone.`
          : f.fallbackReasoning,
      recommendedAction: f.fallbackAction,
    })),
  };
}

export interface PatientAssessment {
  patientId: string;
  status: PatientStatus;
  flags: RiskFlag[];
  score: number;
  suppressed: number;
}

/** Assess one patient. Writes flags and status; does not touch the queue order. */
export async function assessPatient(
  patient: Patient,
  options: { asOf: Date; trigger: AgentTrigger; correlationId: string; encounterId?: string | null },
): Promise<PatientAssessment> {
  const evidence = evidenceFor(patient, options.asOf);
  const findings = evaluate(evidence, options.asOf);

  // FD-2 and FD-4: drop findings the clinician has already dismissed, unless the
  // clinical picture behind them has materially changed.
  const dismissed = flags.dismissedForPatient(patient.id);
  const live: Finding[] = [];
  let suppressed = 0;

  for (const finding of findings) {
    const previous = dismissed.find((d) => d.flagType === finding.flagType);
    if (previous && previous.dismissedFingerprint === fingerprintOf(finding)) {
      suppressed += 1;
      continue;
    }
    live.push(finding);
  }

  let wording: ReasoningOutput;
  if (live.length === 0) {
    wording = { findings: [] };
  } else {
    const result = await callAgent<ReasoningOutput>({
      agent: AGENT,
      system: SYSTEM_PROMPT,
      user: [
        describePatient(patient, evidence),
        '',
        'Findings established by the encoded rules:',
        ...live.map((f, i) =>
          [
            `${i + 1}. flagType: ${f.flagType} (urgency ${f.urgency}${f.confidence === 'uncertain' ? ', assessment uncertain' : ''})`,
            `   facts: ${f.facts.join('; ')}`,
            f.trend ? `   trend: ${f.trend}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        ),
        '',
        'Write one sentence of reasoning and a short recommended action for each finding, keyed by flagType.',
      ].join('\n'),
      schema: REASONING_SCHEMA,
      effort: 'low',
      maxTokens: 4000,
      deterministic: () => fallbackReasoning(live),
      // Section 11: cached for the seeded population, so repeat population runs
      // do not re-spend on unchanged patients (PF-6).
      cacheKey: cacheKeyFor([AGENT, patient.id, live.map((f) => [f.flagType, f.facts])]),
    });
    wording = result.output;
  }

  const written: RiskFlag[] = [];
  const timestamp = now();

  flags.clearActiveForPatient(patient.id);

  for (const finding of live) {
    const said = wording.findings.find((w) => w.flagType === finding.flagType);
    // A flag with no reasoning is a bug (Section 5) — the rules layer's wording
    // is used rather than writing an empty flag.
    const reasoning = said?.reasoning?.trim() || finding.fallbackReasoning;
    const action = said?.recommendedAction?.trim() || finding.fallbackAction;

    const flag: RiskFlag = {
      id: id('flag'),
      patientId: patient.id,
      flagType: finding.flagType,
      urgency: finding.urgency,
      reasoning,
      recommendedAction: action,
      triggeringEncounterId: finding.triggeringEncounterId ?? options.encounterId ?? null,
      triggeringObservationId: finding.triggeringObservationId ?? null,
      createdAt: timestamp,
      status: 'active',
      dismissalReason: null,
      dismissedBy: null,
      dismissedAt: null,
      confidence: finding.confidence,
      referenceIds: finding.referenceIds,
      dismissedFingerprint: null,
      // The trend bonus is folded in here so the stored score is the whole
      // ranking contribution, and the population run and a single-patient
      // re-rank cannot drift apart.
      severityScore: finding.severityScore + (finding.trend ? 40 : 0),
    };
    flags.insert(flag);
    written.push(flag);
  }

  // Section 4: managed means a risk was identified and a clinician acted on it.
  // A patient with no findings is stable; a patient whose only flags have been
  // resolved through an action keeps their managed status rather than dropping
  // back to stable, because those are clinically different.
  const previouslyManaged = patient.status === 'managed';
  const status: PatientStatus =
    live.length === 0 ? (previouslyManaged ? 'managed' : 'stable') : urgencyOf(live) === 'stable' ? 'stable' : urgencyOf(live);

  patients.setStatus(patient.id, status, timestamp);

  return {
    patientId: patient.id,
    status,
    flags: written,
    score: rankScore(live, evidence.daysSinceLastEncounter),
    suppressed,
  };
}

/**
 * Re-rank the queue from the flags already stored, without re-running any agent.
 *
 * A single-patient assessment — after an approval, a resolution, or a dismissal
 * — changes that patient's flags and status but says nothing about where they
 * now belong relative to everyone else. Without this the patient's queue
 * position stays as the last population run left it, so a patient who has just
 * become critical can sit below a watch patient (GP-6).
 *
 * Ranking is severity, trend, and time since last contact, the same inputs the
 * population run uses, and ties break on patient id so the order is stable
 * across repeated runs over unchanged data (A3-7).
 */
export function rerankQueue(clinicianId: string): string[] {
  const scored = patients.forClinic().map((patient) => {
    const active = flags.activeForPatient(patient.id);
    const daysSince = encounters.daysSinceLast(patient.id);

    const severity = active.reduce((max, f) => Math.max(max, f.severityScore), 0);
    const breadthBonus = Math.min(Math.max(active.length - 1, 0), 3) * 12;
    const timeBonus = daysSince === null ? 0 : Math.min(Math.floor(daysSince / 30), 12) * 8;
    const score = active.length === 0 ? 0 : severity + breadthBonus + timeBonus;

    return { patient, score };
  });

  scored.sort((a, b) => b.score - a.score || a.patient.id.localeCompare(b.patient.id));

  scored.forEach(({ patient }, index) => {
    const needsAttention = patient.status === 'critical' || patient.status === 'watch';
    patients.setQueuePosition(patient.id, needsAttention ? index + 1 : null);
  });

  return scored.map((s) => s.patient.id);
}

export interface PopulationAssessment {
  assessed: number;
  ranking: string[];
  assessments: PatientAssessment[];
  durationMs: number;
}

/**
 * Assess the clinician's whole population and re-rank the queue.
 * Ranking considers severity, trend, and time since last contact, and is stable
 * across repeated runs over unchanged data (A3-7).
 */
export async function assessPopulation(
  clinicianId: string,
  options: { asOf?: Date; trigger?: AgentTrigger; correlationId?: string } = {},
): Promise<PopulationAssessment> {
  const asOf = options.asOf ?? new Date();
  const trigger = options.trigger ?? 'population_run';
  const correlationId = options.correlationId ?? id('corr');
  const startedAt = Date.now();

  const population = patients.forClinic();
  const runId = runs.start({
    agent: AGENT,
    trigger,
    correlationId,
    inputSummary: `${population.length} patients in scope`,
  });

  try {
    const assessments: PatientAssessment[] = [];
    for (const patient of population) {
      assessments.push(await assessPatient(patient, { asOf, trigger, correlationId }));
    }

    // One ranking implementation for both paths, so a population run and a
    // single-patient re-rank always agree.
    const ranking = rerankQueue(clinicianId);

    const flagged = assessments.filter((a) => a.flags.length > 0).length;
    runs.finish(
      runId,
      'success',
      `${population.length} assessed, ${flagged} with active flags, queue re-ranked`,
    );

    return {
      assessed: population.length,
      ranking,
      assessments,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runs.finish(runId, 'failure', 'assessment failed', message);
    throw error;
  }
}

/** Assess a single patient inside its own run log entry (encounter approval path). */
export async function assessPatientRun(
  patientId: string,
  options: { asOf?: Date; trigger: AgentTrigger; correlationId: string; encounterId?: string | null },
): Promise<PatientAssessment> {
  const patient = patients.byId(patientId);
  if (!patient) throw new Error(`Patient ${patientId} not found`);

  const runId = runs.start({
    agent: AGENT,
    trigger: options.trigger,
    patientId,
    encounterId: options.encounterId ?? null,
    correlationId: options.correlationId,
    inputSummary: `${patient.name}, ${encounters.approvedForPatient(patientId).length} prior encounters`,
  });

  try {
    const assessment = await assessPatient(patient, {
      asOf: options.asOf ?? new Date(),
      trigger: options.trigger,
      correlationId: options.correlationId,
      encounterId: options.encounterId ?? null,
    });
    runs.finish(
      runId,
      'success',
      `status ${assessment.status}, ${assessment.flags.length} flag(s)` +
        (assessment.suppressed > 0 ? `, ${assessment.suppressed} suppressed by dismissal` : ''),
    );
    return assessment;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runs.finish(runId, 'failure', 'assessment failed', message);
    throw error;
  }
}
