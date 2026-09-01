import { patients, encounters, observations, runs } from '../db/repositories.ts';
import { callAgent, cacheKeyFor } from '../model/provider.ts';
import { assertVerified, verifyIntake } from '../model/claims.ts';
import type { AgentTrigger, ContextBrief, Encounter, Patient } from '../../../shared/types.ts';

/**
 * Agent 1 — Intake and Context (Section 5).
 *
 * Trigger: the clinician submits an encounter note.
 * Input:   patient identifier, raw note text.
 * Output:  the raw note unchanged, the prior encounters judged relevant, one
 *          sentence saying why, a context brief, and how many were considered
 *          against how many were selected.
 *
 * Selecting everything every time would mean the relevance judgement is not
 * real (A1-2), so the selection is scored and capped.
 */

const AGENT = 'intake_and_context' as const;

/**
 * Symptom associations from section 7 of docs/clinical-reference.md. These
 * decide which past visits to surface, never what a patient has.
 */
const SYMPTOM_ASSOCIATIONS: Array<{ symptom: RegExp; conditions: string[] }> = [
  {
    symptom: /\b(breathless|short(ness)? of breath|dyspnoea|dyspnea|winded|out of breath)\b/i,
    conditions: ['atrial fibrillation', 'heart failure', 'anaemia', 'sickle cell'],
  },
  { symptom: /\b(chest pain|palpitation)\b/i, conditions: ['atrial fibrillation', 'hypertension'] },
  { symptom: /\b(crisis|bone pain|limb pain|pain in (she|her|his) (arms|legs|back))\b/i, conditions: ['sickle cell'] },
  { symptom: /\b(fever|rash|joint ache|muscle ache|myalgia|arthralgia)\b/i, conditions: ['dengue'] },
  { symptom: /\b(headache|blurred vision|visual disturbance)\b/i, conditions: ['hypertension'] },
  {
    symptom: /\b(thirst|passing urine|polyuria|blurred vision|foot ulcer|sugar)\b/i,
    conditions: ['diabetes'],
  },
  { symptom: /\b(ankle swelling|oedema|edema|urine output)\b/i, conditions: ['chronic kidney disease', 'heart failure'] },
  { symptom: /\b(tired|tiredness|fatigue|feeling cold|weight gain)\b/i, conditions: ['hypothyroid', 'anaemia'] },
  { symptom: /\b(joint pain|stiffness)\b/i, conditions: ['osteoarthritis'] },
];

/** Conditions the note points at, via direct mention or symptom association. */
export function implicatedConditions(note: string, patient: Patient): string[] {
  const implicated = new Set<string>();

  for (const condition of patient.conditions) {
    const shortName = condition.name.toLowerCase().replace(/\s*\(.*\)/, '').split(',')[0]?.trim() ?? '';
    if (shortName && note.toLowerCase().includes(shortName)) implicated.add(condition.name);
  }

  for (const association of SYMPTOM_ASSOCIATIONS) {
    if (!association.symptom.test(note)) continue;
    for (const condition of patient.conditions) {
      const name = condition.name.toLowerCase();
      if (association.conditions.some((c) => name.includes(c))) implicated.add(condition.name);
    }
  }

  return [...implicated];
}

function scoreEncounter(encounter: Encounter, note: string, implicated: string[]): number {
  const text =
    `${encounter.rawNote} ${encounter.structured.assessment} ${encounter.structured.plan}`.toLowerCase();
  let score = 0;

  for (const condition of implicated) {
    const shortName = condition.toLowerCase().replace(/\s*\(.*\)/, '').split(',')[0]?.trim() ?? '';
    if (shortName && text.includes(shortName)) score += 10;
  }

  // A symptom named in the note and echoed in a past visit is a strong signal.
  for (const association of SYMPTOM_ASSOCIATIONS) {
    if (association.symptom.test(note) && association.symptom.test(text)) score += 6;
  }

  // Recency breaks ties without dominating relevance.
  score += Math.max(0, 3 - Math.floor((Date.now() - new Date(encounter.date).getTime()) / (86_400_000 * 180)));

  return score;
}

const SYSTEM_PROMPT = `You decide which of a patient's past visits a clinician needs to see alongside a new note, in a Caribbean primary care record system.

You are given the new note, the patient's problem list, and a summary of each past visit. Choose the visits that bear on what the new note describes.

- Choose a subset. A patient with a long chart rarely needs all of it, and returning everything means no judgement was made.
- Choose on clinical relevance to what the note describes, not on recency alone. A note about breathlessness needs the heart-related visits even if a more recent visit was about something else.
- Include a visit when it establishes a baseline the new note should be read against, or when it shows the same problem before.
- Leave out visits about unrelated problems, however recent.
- Then write one sentence saying why you chose what you chose. Name the thread you followed. This sentence is shown to the clinician, so write it as an explanation, not a list.

Never restate or alter the note itself.`;

const SELECTION_SCHEMA = {
  type: 'object',
  properties: {
    selectedEncounterIds: { type: 'array', items: { type: 'string' } },
    selectionReasoning: { type: 'string' },
  },
  required: ['selectedEncounterIds', 'selectionReasoning'],
  additionalProperties: false,
};

interface SelectionOutput {
  selectedEncounterIds: string[];
  selectionReasoning: string;
}

export interface IntakeResult {
  brief: ContextBrief;
  durationMs: number;
}

export async function assembleContext(
  patientId: string,
  rawNote: string,
  options: { trigger?: AgentTrigger; correlationId: string },
): Promise<IntakeResult> {
  const startedAt = Date.now();
  const patient = patients.byId(patientId);
  if (!patient) throw new Error(`Patient ${patientId} not found`);

  const history = encounters.approvedForPatient(patientId);
  const runId = runs.start({
    agent: AGENT,
    trigger: options.trigger ?? 'encounter_submit',
    patientId,
    correlationId: options.correlationId,
    inputSummary: `${history.length} prior encounters considered`,
  });

  try {
    // A1-3: no prior encounters is stated explicitly, not returned as empty.
    if (history.length === 0) {
      const brief: ContextBrief = {
        rawNote,
        selectedEncounterIds: [],
        selectionReasoning:
          'This patient has no previous encounters on record, so there is no prior history to draw on for this note.',
        relevantConditions: patient.conditions.map((c) => c.name),
        relevantMedications: patient.medications.map((m) => `${m.name} ${m.dose} ${m.frequency}`),
        recentObservations: [],
        consideredCount: 0,
        selectedCount: 0,
        hasPriorHistory: false,
        noHistoryNote: 'First recorded encounter for this patient.',
      };
      runs.finish(runId, 'success', 'no prior history; stated explicitly');
      return { brief, durationMs: Date.now() - startedAt };
    }

    const implicated = implicatedConditions(rawNote, patient);
    const scored = history
      .map((e) => ({ encounter: e, score: scoreEncounter(e, rawNote, implicated) }))
      .sort((a, b) => b.score - a.score || b.encounter.date.localeCompare(a.encounter.date));

    const result = await callAgent<SelectionOutput>({
      agent: AGENT,
      system: SYSTEM_PROMPT,
      user: [
        `Patient: ${patient.age} year old ${patient.sex}`,
        `Problem list: ${patient.conditions.map((c) => c.name).join(', ') || 'none recorded'}`,
        `Medications: ${patient.medications.map((m) => `${m.name} ${m.dose}`).join('; ') || 'none'}`,
        '',
        'New note:',
        rawNote,
        '',
        `Past visits (${history.length}):`,
        ...history.map(
          (e) =>
            `- id ${e.id} | ${e.date} | assessment: ${e.structured.assessment} | plan: ${e.structured.plan}`,
        ),
        '',
        'Select the visit ids that bear on this note, and say in one sentence why.',
      ].join('\n'),
      schema: SELECTION_SCHEMA,
      effort: 'low',
      maxTokens: 3000,
      deterministic: () => {
        // Keep the encounters that scored on relevance. Where nothing scores, a
        // short chart is kept whole and a long one is cut to the most recent
        // few, so the selection is never simply "everything".
        const relevant = scored.filter((s) => s.score >= 6);
        const chosen =
          relevant.length > 0
            ? relevant.slice(0, Math.max(2, Math.ceil(history.length / 2)))
            : scored.slice(0, Math.min(3, history.length));

        const reasoning =
          implicated.length > 0
            ? `Selected the ${chosen.length} of ${history.length} previous encounters that bear on ${implicated
                .map((c) => c.toLowerCase())
                .join(' and ')}, which is what this note describes.`
            : `This note does not point at any one problem on the list, so the ${chosen.length} most recent of ${history.length} encounters were selected to give recent context.`;

        return { selectedEncounterIds: chosen.map((s) => s.encounter.id), selectionReasoning: reasoning };
      },
      cacheKey: cacheKeyFor([AGENT, patientId, rawNote, history.map((e) => e.id)]),
    });

    /*
     * An id that was not in the list it was shown means the model invented an
     * encounter. The filter below would drop it, but dropping it silently hides
     * that the reply is not answering the question asked — and if it invented
     * one id, the reasoning it wrote alongside is not trustworthy either.
     */
    assertVerified(AGENT, verifyIntake(result.output, history.map((e) => e.id)));

    // Guard the contract rather than trusting the reply: unknown ids are
    // dropped, and an empty or total selection is corrected to a real subset.
    const known = new Set(history.map((e) => e.id));
    let selected = result.output.selectedEncounterIds.filter((eid) => known.has(eid));
    if (selected.length === 0) {
      selected = scored.slice(0, Math.min(3, history.length)).map((s) => s.encounter.id);
    }
    if (selected.length === history.length && history.length > 4) {
      selected = scored.slice(0, Math.ceil(history.length * 0.6)).map((s) => s.encounter.id);
    }

    const selectedEncounters = history.filter((e) => selected.includes(e.id));
    const obs = observations.forPatient(patientId).slice(0, 8);

    const brief: ContextBrief = {
      // A1-4: the raw note is passed through untouched.
      rawNote,
      selectedEncounterIds: selected,
      // Always populated, even when everything is selected.
      selectionReasoning:
        result.output.selectionReasoning?.trim() ||
        `Selected ${selected.length} of ${history.length} previous encounters as relevant to this note.`,
      relevantConditions:
        implicated.length > 0 ? implicated : patient.conditions.map((c) => c.name),
      relevantMedications: patient.medications.map((m) => `${m.name} ${m.dose} ${m.frequency}`),
      recentObservations: obs.map((o) => ({
        type: o.type,
        value: o.value,
        unit: o.unit,
        recordedOn: o.recordedOn,
      })),
      consideredCount: history.length,
      selectedCount: selected.length,
      hasPriorHistory: true,
    };

    runs.finish(
      runId,
      'success',
      `considered ${history.length}, selected ${selected.length}${
        selectedEncounters.length > 0 ? ` (${selectedEncounters.map((e) => e.date).join(', ')})` : ''
      }`,
    );

    return { brief, durationMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runs.finish(runId, 'failure', 'context assembly failed', message);
    throw error;
  }
}
