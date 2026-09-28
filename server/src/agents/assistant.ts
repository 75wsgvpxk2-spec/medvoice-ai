import {
  patients,
  encounters,
  observations,
  flags,
  alerts,
  orders,
} from '../db/repositories.ts';
import { callAgent, cacheKeyFor } from '../model/provider.ts';
import { describeThresholds } from '../lib/thresholds.ts';
import type { Patient } from '../../../shared/types.ts';

/**
 * The clinical assistant.
 *
 * Three things a clinician asks between patients: what does this record
 * actually say, what does our guideline actually say, and what are the
 * sensible next steps. This answers those three, and refuses to be anything
 * else.
 *
 * It is not a fifth agent. The four named agents assess the population and
 * structure encounters, and their output is written to the record and shown
 * with their reasoning. This reads that record back and explains it. Nothing
 * it says is stored, nothing it says changes a patient's status, and nothing
 * it says can close an alert or resolve a flag — every clinical action still
 * goes through the workflow that requires the clinician to make it (§25).
 *
 * The constraints below are the whole design:
 *
 *   - It answers from a brief the server assembled from the database, not from
 *     what the model remembers about medicine.
 *   - It cites what it used, every time. `basis` is not decoration; it is how
 *     the clinician checks the answer against the record.
 *   - It says when the record does not contain the answer, rather than filling
 *     the gap. `uncertain` is set by the assistant and shown prominently.
 *   - It never diagnoses and never prescribes. Planning proposes options for a
 *     clinician to choose between, in the clinician's own words.
 */

export type AssistantMode = 'patient' | 'research' | 'planning';

export interface AssistantAnswer {
  answer: string;
  /** Exactly what was used: record fields, flags, thresholds, guideline ids. */
  basis: string[];
  /** The record did not settle the question. */
  uncertain: boolean;
}

export interface AssistantReply extends AssistantAnswer {
  mode: AssistantMode;
  patientId: string | null;
  patientName: string | null;
  /** True when no model was configured and the local engine answered. */
  deterministic: boolean;
  degradedReason?: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    basis: { type: 'array', items: { type: 'string' } },
    uncertain: { type: 'boolean' },
  },
  required: ['answer', 'basis', 'uncertain'],
  additionalProperties: false,
} as const;

const SHARED_RULES = [
  'You are a clinical assistant inside MedVoice AI, a decision-support tool used by a doctor.',
  'You are talking to a qualified clinician, not a patient.',
  '',
  'Absolute rules:',
  '- Answer only from the BRIEF supplied in the user message. It is the record.',
  '- Never state a clinical value, date, medication or threshold that is not in the brief.',
  '- If the brief does not answer the question, say exactly what is missing and set uncertain to true.',
  '- Never give a diagnosis. Never prescribe. Never tell the clinician what they must do.',
  '- Never claim an action has been taken. You cannot order, prescribe, resolve or record anything.',
  '- List in `basis` each item of the brief you actually used, quoting the value.',
  '- Write in plain clinical English, in short paragraphs. No headings, no markdown.',
].join('\n');

const MODE_RULES: Record<AssistantMode, string> = {
  patient: [
    'MODE: PATIENT.',
    'Answer the question about this specific patient from their record.',
    'Where the agents have already raised a flag, use their reasoning rather than forming your own.',
    'Quote values and dates as they appear. Say when something was last recorded.',
  ].join('\n'),
  research: [
    'MODE: RESEARCH.',
    "Answer from this clinic's own configured clinical reference and thresholds, which are in the brief.",
    'Name the threshold and its reference id. If the clinic has adjusted a threshold, say so and say why.',
    'If the brief has no threshold covering the question, say so plainly and set uncertain to true.',
    'Do not supply a figure from general medical knowledge; this clinic assesses against its own reference.',
  ].join('\n'),
  planning: [
    'MODE: PLANNING.',
    'Propose next steps as options for the clinician to consider, never as instructions.',
    'Ground every option in something in the brief: an open alert, an active flag, an overdue review, a recorded value.',
    'Where a flag already carries a recommended action, surface that action rather than inventing another.',
    'Say plainly that each option is for the clinician to decide, and that nothing has been ordered or booked.',
  ].join('\n'),
};

/** How much history is worth putting in front of the model. */
const RECENT_OBSERVATIONS = 12;
const RECENT_ENCOUNTERS = 4;

/**
 * The brief.
 *
 * Assembled here, from the database, so that what the assistant can say is
 * bounded by what the clinic actually holds. This is the single most important
 * function in the file: everything the answer is allowed to contain passes
 * through it.
 */
function patientBrief(patient: Patient): string[] {
  const activeFlags = flags.activeForPatient(patient.id);
  const openAlerts = alerts.openForPatient(patient.id);
  const outstanding = orders.forPatient(patient.id).filter((order) => order.status !== 'completed');
  const history = encounters.forPatient(patient.id).slice(0, RECENT_ENCOUNTERS);
  const values = observations.forPatient(patient.id).slice(0, RECENT_OBSERVATIONS);

  const lines: string[] = [
    `PATIENT: ${patient.name}, ${patient.age} year old ${patient.sex}.`,
    `Current status set by the agents: ${patient.status}.`,
    `Last assessed: ${patient.lastAssessedAt ?? 'never assessed'}.`,
    `Conditions: ${
      patient.conditions.map((c) => `${c.name} (recorded ${c.diagnosedOn})`).join('; ') || 'none recorded'
    }`,
    `Medications: ${
      patient.medications.map((m) => `${m.name} ${m.dose} ${m.frequency}`).join('; ') || 'none recorded'
    }`,
    `Allergies: ${patient.allergies.join('; ') || 'none recorded'}`,
  ];

  lines.push('', 'RECENT RECORDED VALUES (most recent first):');
  if (values.length === 0) lines.push('  none recorded');
  for (const value of values) {
    lines.push(`  ${value.recordedOn}: ${value.type} = ${value.value} ${value.unit}${value.overdue ? ' (overdue)' : ''}`.trimEnd());
  }

  lines.push('', 'ACTIVE RISK FLAGS RAISED BY THE AGENTS:');
  if (activeFlags.length === 0) lines.push('  none');
  for (const flag of activeFlags) {
    lines.push(
      `  [${flag.urgency}${flag.confidence === 'uncertain' ? ', agent was uncertain' : ''}] ${flag.reasoning}`,
      `     recommended action on file: ${flag.recommendedAction}`,
      `     reference ids: ${flag.referenceIds.join(', ') || 'none'}`,
    );
  }

  lines.push('', 'OPEN DOCUMENTATION ALERTS:');
  if (openAlerts.length === 0) lines.push('  none');
  for (const alert of openAlerts) lines.push(`  ${alert.gapType}: ${alert.description}`);

  lines.push('', 'OUTSTANDING ORDERS:');
  if (outstanding.length === 0) lines.push('  none');
  for (const order of outstanding) lines.push(`  ${order.orderType}: ${order.what} (${order.status}, ordered ${order.orderedAt})`);

  lines.push('', 'RECENT ENCOUNTERS:');
  if (history.length === 0) lines.push('  none recorded');
  for (const encounter of history) {
    lines.push(`  ${encounter.date} (${encounter.status}): ${encounter.rawNote.slice(0, 400)}`);
  }

  return lines;
}

/** The clinic's own reference, as the research mode's only source of numbers. */
function referenceBrief(): string[] {
  return [
    "THIS CLINIC'S CONFIGURED CLINICAL REFERENCE:",
    ...describeThresholds().map(
      (row) =>
        `  ${row.label}: ${row.value} (reference ${row.referenceId}; published ${row.referenceValue}${
          row.adjusted ? `; this clinic changed it — ${row.override?.reason ?? 'no reason recorded'} (source: ${row.override?.source ?? 'none given'})` : ''
        })`,
    ),
  ];
}

/**
 * The answer when no model is configured.
 *
 * Not a placeholder. A clinic running on the encoded engine still gets the
 * record read back to them, organised by the question they asked — and is told
 * plainly that no model was consulted, so nobody mistakes a local summary for
 * an analysis. §25's rule against hidden degradation applies to this feature
 * exactly as it does to the agents.
 */
function locally(mode: AssistantMode, patient: Patient | null): AssistantAnswer {
  if (mode === 'research') {
    const rows = describeThresholds();
    const adjusted = rows.filter((row) => row.adjusted);
    return {
      answer: [
        `No model is configured, so this is the clinic's reference read straight from the database rather than an answer to your question.`,
        `${rows.length} thresholds are in use${
          adjusted.length > 0 ? `, of which ${adjusted.length} have been changed by this clinic` : ''
        }. Every flag names the reference id it was measured against, and the full list with published values is in Settings.`,
      ].join(' '),
      basis: rows.slice(0, 8).map((row) => `${row.label}: ${row.value} (${row.referenceId})`),
      uncertain: true,
    };
  }

  if (!patient) {
    return {
      answer: 'Choose a patient first — this mode reads a specific record.',
      basis: [],
      uncertain: true,
    };
  }

  const activeFlags = flags.activeForPatient(patient.id);
  const openAlerts = alerts.openForPatient(patient.id);

  const summary = [
    `No model is configured, so this is ${patient.name}'s record summarised locally rather than an answer to your question.`,
    `Status ${patient.status}${patient.lastAssessedAt ? `, last assessed ${patient.lastAssessedAt}` : ', never assessed'}.`,
    activeFlags.length > 0
      ? `${activeFlags.length} active flag${activeFlags.length === 1 ? '' : 's'}, the most urgent being: ${activeFlags[0]!.reasoning}`
      : 'No active flags.',
    openAlerts.length > 0
      ? `${openAlerts.length} open documentation alert${openAlerts.length === 1 ? '' : 's'}.`
      : 'No open documentation alerts.',
    mode === 'planning'
      ? 'Next steps are on the record itself: each flag carries the action the agents recommended, and each alert carries what resolving it would do. Nothing has been ordered or booked.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    answer: summary,
    basis: [
      `status: ${patient.status}`,
      ...activeFlags.slice(0, 3).map((flag) => `flag (${flag.urgency}): ${flag.reasoning}`),
      ...openAlerts.slice(0, 3).map((alert) => `alert: ${alert.description}`),
    ],
    uncertain: true,
  };
}

export async function ask(input: {
  mode: AssistantMode;
  patientId: string | null;
  question: string;
}): Promise<AssistantReply> {
  const patient = input.patientId ? patients.byId(input.patientId) : null;

  const brief: string[] = [];
  if (patient) brief.push(...patientBrief(patient));
  // Research reads the reference; the other two get it as well, because "which
  // number is that measured against" is the follow-up to almost every answer.
  brief.push('', ...referenceBrief());

  const result = await callAgent<AssistantAnswer>({
    agent: 'clinical_assistant',
    system: `${SHARED_RULES}\n\n${MODE_RULES[input.mode]}`,
    user: [
      'BRIEF:',
      ...brief,
      '',
      'QUESTION FROM THE CLINICIAN:',
      input.question,
    ].join('\n'),
    schema: SCHEMA as unknown as Record<string, unknown>,
    deterministic: () => locally(input.mode, patient),
    effort: 'low',
    maxTokens: 900,
    /*
     * Cached on the question and the record's current shape, so asking the
     * same thing twice about an unchanged record does not bill twice — and so
     * that the moment the record does change, the answer is recomputed rather
     * than served stale.
     */
    cacheKey: cacheKeyFor([
      'assistant',
      input.mode,
      input.question,
      patient?.id ?? null,
      patient?.lastAssessedAt ?? null,
      patient?.status ?? null,
      flags.activeForPatient(patient?.id ?? '').length,
      alerts.openForPatient(patient?.id ?? '').length,
    ]),
  });

  return {
    ...result.output,
    mode: input.mode,
    patientId: patient?.id ?? null,
    patientName: patient?.name ?? null,
    deterministic: result.provider === 'deterministic',
    ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
  };
}
