import { runs } from '../db/repositories.ts';
import { callAgent, cacheKeyFor } from '../model/provider.ts';
import type {
  AgentTrigger,
  ContextBrief,
  FieldConfidence,
  ObservationType,
  StructuredContent,
  StructuringResult,
} from '../../../shared/types.ts';

/**
 * Agent 2 — Record Structuring (Section 5).
 *
 * Trigger: Agent 1 completes.
 * Input:   the raw note and the context brief.
 * Output:  four populated sections, extracted observations with values and
 *          units, and a confidence marking per field.
 *
 * The governing rule is: never guess. A value that is ambiguous, contradictory,
 * or missing a unit is flagged. Flagging is correct behaviour, not failure.
 * Nothing here writes to the saved record — the output is a draft awaiting
 * the clinician's approval (A2-4).
 */

const AGENT = 'record_structuring' as const;

/* --------------------------------------------------------- value extraction -- */

interface Measure {
  type: ObservationType;
  pattern: RegExp;
  defaultUnit: string;
  /**
   * Whether a bare number is ambiguous. Section 8 of the clinical reference
   * lists which measurements are written in more than one unit in practice.
   */
  bareNumberIsAmbiguous: boolean;
  ambiguityNote?: string;
}

const MEASURES: Measure[] = [
  {
    type: 'blood_pressure',
    pattern: /\b(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})\b\s*(mmhg)?/gi,
    defaultUnit: 'mmHg',
    bareNumberIsAmbiguous: false,
  },
  {
    type: 'hba1c',
    pattern: /\bhba1c\b\D{0,30}?(\d{1,3}(?:\.\d+)?)\s*(%|percent|mmol\/mol)?/gi,
    defaultUnit: '%',
    bareNumberIsAmbiguous: false,
  },
  {
    type: 'weight',
    pattern: /\bweight\b\D{0,20}?(\d{1,3}(?:\.\d+)?)\s*(kg|kilograms?|kilos?|lbs?|pounds?)?/gi,
    defaultUnit: 'kg',
    bareNumberIsAmbiguous: true,
    ambiguityNote: 'weight is written in both kilograms and pounds',
  },
  {
    type: 'temperature',
    pattern: /\b(?:temp|temperature)\b\D{0,20}?(\d{2}(?:\.\d+)?)\s*(°\s*[cf]\b|degrees?\s*\w*|\bc\b|\bf\b)?/gi,
    defaultUnit: '°C',
    bareNumberIsAmbiguous: true,
    ambiguityNote: 'temperature is written in both Celsius and Fahrenheit',
  },
  {
    type: 'heart_rate',
    pattern: /\b(?:heart rate|pulse)\b\D{0,20}?(\d{2,3})\s*(bpm|beats(?: per minute)?)?/gi,
    defaultUnit: 'bpm',
    bareNumberIsAmbiguous: false,
  },
  {
    type: 'haemoglobin',
    pattern: /\b(?:haemoglobin|hemoglobin|hb)\b\D{0,20}?(\d{1,2}(?:\.\d+)?)\s*(g\/dl)?/gi,
    defaultUnit: 'g/dL',
    bareNumberIsAmbiguous: false,
  },
  {
    type: 'platelet_count',
    pattern: /\bplatelets?\b\D{0,20}?(\d{1,3})\s*(×?\s*10⁹\/l|x\s*10\^?9\/?l)?/gi,
    defaultUnit: '×10⁹/L',
    bareNumberIsAmbiguous: false,
  },
  {
    type: 'haematocrit',
    pattern: /\b(?:haematocrit|hematocrit|hct)\b\D{0,20}?(\d{1,2})\s*(%)?/gi,
    defaultUnit: '%',
    bareNumberIsAmbiguous: false,
  },
  {
    type: 'egfr',
    pattern: /\begfr\b\D{0,20}?(\d{1,3})\s*(ml\/min[^\s,]*)?/gi,
    defaultUnit: 'mL/min/1.73m²',
    bareNumberIsAmbiguous: false,
  },
  {
    type: 'urine_acr',
    pattern: /\b(?:acr|albumin[- ]to[- ]creatinine(?: ratio)?)\b\D{0,25}?(\d{1,4})\s*(mg\/g)?/gi,
    defaultUnit: 'mg/g',
    bareNumberIsAmbiguous: false,
  },
];

/** Blood glucose is handled separately because a bare number is ambiguous. */
const GLUCOSE_PATTERN = /\b(?:sugar|glucose|blood sugar|bm)\b\D{0,45}?(\d{1,3}(?:\.\d+)?)\s*(mmol\/l|mg\/dl)?/gi;

export interface Extracted {
  type: ObservationType | 'blood_glucose';
  value: string;
  unit: string;
  unitStated: boolean;
  flagged: boolean;
  ambiguity?: string;
  matchedText: string;
}

export function extractValues(note: string): Extracted[] {
  const found: Extracted[] = [];

  for (const measure of MEASURES) {
    measure.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = measure.pattern.exec(note)) !== null) {
      const isBloodPressure = measure.type === 'blood_pressure';
      const value = isBloodPressure ? `${match[1]}/${match[2]}` : (match[1] ?? '');
      const statedUnit = isBloodPressure ? match[3] : match[2];
      const unitStated = Boolean(statedUnit);

      found.push({
        type: measure.type,
        value,
        unit: unitStated ? normaliseUnit(statedUnit!, measure.defaultUnit) : measure.defaultUnit,
        unitStated,
        flagged: !unitStated && measure.bareNumberIsAmbiguous,
        ...(!unitStated && measure.bareNumberIsAmbiguous
          ? {
              ambiguity: `The note gives ${value} with no unit, and ${measure.ambiguityNote}. It has not been assumed.`,
            }
          : {}),
        matchedText: match[0].trim(),
      });
    }
  }

  GLUCOSE_PATTERN.lastIndex = 0;
  let glucose: RegExpExecArray | null;
  while ((glucose = GLUCOSE_PATTERN.exec(note)) !== null) {
    const unitStated = Boolean(glucose[2]);
    found.push({
      type: 'blood_glucose',
      value: glucose[1] ?? '',
      unit: unitStated ? (glucose[2] ?? '') : 'unit not stated',
      unitStated,
      flagged: !unitStated,
      ...(unitStated
        ? {}
        : {
            ambiguity: `The note gives a blood sugar of ${glucose[1]} with no unit, and blood glucose is written in both mmol/L and mg/dL. It has not been assumed.`,
          }),
      matchedText: glucose[0].trim(),
    });
  }

  return found;
}

/** Two different readings of the same measure in one note (A2-3). */
export interface Contradiction {
  type: string;
  readings: string[];
  description: string;
}

export function findContradictions(extracted: Extracted[]): Contradiction[] {
  const byType = new Map<string, Extracted[]>();
  for (const item of extracted) {
    byType.set(item.type, [...(byType.get(item.type) ?? []), item]);
  }

  const contradictions: Contradiction[] = [];
  for (const [type, items] of byType) {
    const distinct = [...new Set(items.map((i) => i.value))];
    if (distinct.length < 2) continue;
    contradictions.push({
      type,
      readings: distinct,
      description: `The note records more than one ${readable(type)}: ${distinct.join(' and ')}. Both are shown; neither has been chosen.`,
    });
  }
  return contradictions;
}

function readable(type: string): string {
  return type.replace(/_/g, ' ');
}

function normaliseUnit(stated: string, fallback: string): string {
  const s = stated.trim().toLowerCase();
  if (/^°?\s*c$|celsius|centigrade/.test(s)) return '°C';
  if (/^°?\s*f$|fahrenheit/.test(s)) return '°F';
  if (/^kg|kilo/.test(s)) return 'kg';
  if (/^lb|pound/.test(s)) return 'lb';
  if (/percent|%/.test(s)) return '%';
  if (/mmhg/.test(s)) return 'mmHg';
  if (/bpm|beats/.test(s)) return 'bpm';
  return stated.trim() || fallback;
}

/* -------------------------------------------------------- section splitting -- */

type Section = keyof StructuredContent;

/**
 * Sentences are scored across all four sections rather than assigned by the
 * first pattern that matches. First-match was too brittle: "the pain start up
 * again" read as a plan because of "start", and "no fever that she has
 * measured" read as objective because of "measured".
 */
const SIGNALS: Array<{ section: Section; weight: number; pattern: RegExp }> = [
  // Subjective — the patient's own account.
  // "tells?" is deliberately absent: "tell she come back if it get worse" is a
  // plan instruction, not the patient's account.
  { section: 'subjective', weight: 3, pattern: /\b(reports?|says?|saying|complain\w*|feels?|denies|describes|mentions?|told me|tells me)\b/i },
  { section: 'subjective', weight: 3, pattern: /\b(come in|came in|presents?|attends?|attending)\b/i },
  { section: 'subjective', weight: 2, pattern: /\b(for the past|since|history of|at home)\b/i },
  { section: 'subjective', weight: 2, pattern: /\b(headache|pain|fever|cough|nausea|vomiting|tired\w*|dizz\w*|breathless\w*|swelling|unwell|ache\w*)\b/i },

  // Objective — measured or observed.
  { section: 'objective', weight: 3, pattern: /\b(on examination|examined|examination|afebrile|tenderness|palpation|auscultation|sensation intact|no ulceration|within normal limits)\b/i },

  // Assessment — the clinical interpretation.
  { section: 'assessment', weight: 4, pattern: /\b(impression|assessment|diagnosis|consistent with|likely|appears to be)\b/i },
  { section: 'assessment', weight: 3, pattern: /\b(stage [12]|with warning signs|well controlled|uncontrolled|not controlled|above goal|off target|deteriorat\w+|worsening|resolved|responding to treatment|remains? \w+ controlled)\b/i },

  // Plan — what happens next.
  { section: 'plan', weight: 4, pattern: /\b(continue|reviewed? in|arranged?|refer(red)?|discharged?|prescrib(e|ed)|renew(ed)?|encourag(e|ed)|monitor|follow.?up|no change)\b/i },
  { section: 'plan', weight: 4, pattern: /\b(return if|come back if|advis(e|ed) (to|her|him|she)|tell (she|her|him)|give (she|her|him))\b/i },
  { section: 'plan', weight: 3, pattern: /\bin (three|six|twelve|two|four|\d+) (months?|weeks?|days?)\b/i },
  // "start" only counts as a plan when it is starting a treatment, not when a
  // symptom starts up.
  { section: 'plan', weight: 3, pattern: /\b(start(ed|ing)? (on|her|him|them|the patient)|increase[sd]? \w+ to|decreased?|stopp?(ed)?) \b/i },
];

function splitSentences(note: string): string[] {
  return note
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function classify(sentence: string, hasValue: boolean): Section {
  const scores: Record<Section, number> = { subjective: 0, objective: 0, assessment: 0, plan: 0 };

  for (const signal of SIGNALS) {
    if (signal.pattern.test(sentence)) scores[signal.section] += signal.weight;
  }
  // A stated measurement is the strongest objective signal there is.
  if (hasValue) scores.objective += 5;

  const best = (Object.keys(scores) as Section[]).reduce((a, b) => (scores[b] > scores[a] ? b : a));
  return scores[best] === 0 ? 'subjective' : best;
}

/* ------------------------------------------------------------- the agent -- */

const SYSTEM_PROMPT = `You turn a clinician's free-text encounter note into a structured record, for a Caribbean primary care system.

Split the note into four sections, returned under "structured":
- subjective: what the patient reports — symptoms, history, how they say they are
- objective: what was measured or observed — vital signs, results, examination findings
- assessment: the clinical interpretation
- plan: what will happen next

Rules that matter more than completeness:
- NEVER GUESS. If a value is ambiguous, contradictory, or missing a unit, flag that field and say exactly what is ambiguous. Flagging is correct; guessing is not.
- If the note gives a number without a unit and that measurement is written in more than one unit in practice, flag it and do not assume which was meant. Exactly these are ambiguous: weight (kilograms or pounds), temperature (Celsius or Fahrenheit), blood glucose (mmol/L or mg/dL), height (centimetres or feet and inches).
- Everything else has one unit in ordinary use and must NOT be flagged for a missing unit: blood pressure is always mmHg, heart rate beats per minute, haemoglobin g/dL, platelets ×10⁹/L, eGFR mL/min/1.73m². HbA1c is percent when the value is roughly 4 to 15 and mmol/mol when roughly 20 to 140, so a value in either band is unambiguous — do not flag it. Flagging a value whose unit is never in doubt is as much a failure as guessing one that is.
- If the note contains two different readings of the same thing, surface BOTH in the flag. Never silently pick one.
- If the note does not state an assessment, leave the assessment empty and flag it. Do not infer a diagnosis the clinician did not write.
- Informal, colloquial, or dialect phrasing carries the same clinical meaning as formal phrasing. Structure it correctly; do not treat it as less reliable.
- Write each section in clear clinical prose. Do not copy the note verbatim, and do not add anything the note does not say.

Extract every measurement as a separate observation with its value and unit. Where the unit was not stated and the measure is unambiguous by convention (blood pressure, heart rate, haemoglobin), use the conventional unit and do not flag. Where it is ambiguous, flag it.

Observation formatting, which the record depends on:
- "type" must be one of the exact values listed in the schema — blood_pressure, hba1c, egfr and so on. Not a display label: write "blood_pressure", never "Blood pressure"; "hba1c", never "HbA1c".
- "value" is the bare number with no unit in it: "142/88", "7.8", "52". The unit belongs in "unit".
- Where the note gives two different readings of one measure, return both as separate observations and put both bare values in the flag's "readings".

What "fieldConfidence" is for, and what it is not:
- Each entry says one thing only: is THAT field's own value or unit clear. Nothing else belongs there.
- If a field's value and unit are both clear, mark it "confident" — even if something else about the encounter seems worth remarking on. Do not flag a field and then explain in the ambiguity text that the field is actually fine.
- Do NOT use it to report medication discrepancies, disagreements with the patient's record, comparisons against prior notes, or any other clinical concern. That is Agent 3's work, and raising it here puts it in front of the clinician as a data-quality problem when it is not one.
- Never assert that the record, the medication list or a prior note contains something unless it appears in the material you were given. If you did not see it, it is not there.`;

/** The record's observation vocabulary. The model must use these exact values. */
const OBSERVATION_TYPES: ObservationType[] = [
  'blood_pressure',
  'hba1c',
  'weight',
  'temperature',
  'heart_rate',
  'platelet_count',
  'haemoglobin',
  'oxygen_saturation',
  'egfr',
  'creatinine',
  'urine_acr',
  'ldl_cholesterol',
  'haematocrit',
  'respiratory_rate',
];

/**
 * A near-miss must not silently lose a clinical value. Anything the model
 * returns that maps unambiguously onto the vocabulary is accepted; anything
 * that does not is dropped and reported rather than guessed at.
 */
export function normaliseObservationType(raw: string): ObservationType | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((OBSERVATION_TYPES as string[]).includes(key)) return key as ObservationType;

  const aliases: Record<string, ObservationType> = {
    bp: 'blood_pressure',
    blood_pressure_systolic: 'blood_pressure',
    hba1c_percent: 'hba1c',
    a1c: 'hba1c',
    egfr_ml_min: 'egfr',
    hb: 'haemoglobin',
    hemoglobin: 'haemoglobin',
    hematocrit: 'haematocrit',
    hct: 'haematocrit',
    platelets: 'platelet_count',
    platelet: 'platelet_count',
    pulse: 'heart_rate',
    temp: 'temperature',
    acr: 'urine_acr',
    albumin_creatinine_ratio: 'urine_acr',
    urine_albumin_to_creatinine_ratio: 'urine_acr',
    spo2: 'oxygen_saturation',
    resp_rate: 'respiratory_rate',
  };
  return aliases[key] ?? null;
}

/** Strips a unit the model appended to a reading: "142/88 mmHg" -> "142/88". */
export function bareValue(raw: string): string {
  return raw
    .trim()
    .replace(/\s*(mmhg|mg\/g|g\/dl|ml\/min[^\s,]*|°?\s*[cf]\b|%|bpm|kg|lb|×?10⁹\/l|x10\^?9\/?l)\s*$/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

/**
 * The schema mirrors StructuringResult exactly, including the nesting. When the
 * two disagreed — sections flat here, nested in the type — the deterministic
 * path worked and the live path returned an object whose `.structured` was
 * undefined. The type is the contract; the schema has to match it.
 */
const STRUCTURE_SCHEMA = {
  type: 'object',
  properties: {
    structured: {
      type: 'object',
      properties: {
        subjective: { type: 'string' },
        objective: { type: 'string' },
        assessment: { type: 'string' },
        plan: { type: 'string' },
      },
      required: ['subjective', 'objective', 'assessment', 'plan'],
      additionalProperties: false,
    },
    fieldConfidence: {
      // Described in the schema as well as the prompt: this is the channel a
      // model reaches for when it has an observation and nowhere to put it, and
      // a field flagged for an unrelated reason reads to the clinician as a
      // problem with the measurement.
      description:
        "Whether each field's own value and unit are clear. Not a general channel for clinical concerns.",
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'The field this entry is about.' },
          confidence: { type: 'string', enum: ['confident', 'flagged'] },
          ambiguity: {
            type: 'string',
            description:
              "What is unclear about this field's own value or unit. Only present when confidence is flagged.",
          },
          readings: { type: 'array', items: { type: 'string' } },
        },
        required: ['field', 'confidence'],
        additionalProperties: false,
      },
    },
    observations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          // Constrained to the vocabulary the record uses. Left as a free
          // string the model returns human labels — "Blood pressure", "eGFR",
          // "HbA1c" — which match nothing downstream, so every observation is
          // silently dropped and the patient looks like they have no readings.
          type: { type: 'string', enum: OBSERVATION_TYPES },
          // Bare value with no unit in it: "142/88", "7.8", "52".
          value: { type: 'string' },
          unit: { type: 'string' },
          flagged: { type: 'boolean' },
          ambiguity: { type: 'string' },
        },
        required: ['type', 'value', 'unit', 'flagged'],
        additionalProperties: false,
      },
    },
  },
  required: ['structured', 'fieldConfidence', 'observations'],
  additionalProperties: false,
};

/** Rule-based structuring, used when no model is available. */
export function structureDeterministically(rawNote: string): StructuringResult {
  const extracted = extractValues(rawNote);
  const contradictions = findContradictions(extracted);
  const sentences = splitSentences(rawNote);

  const sections: StructuredContent = { subjective: '', objective: '', assessment: '', plan: '' };
  for (const sentence of sentences) {
    const hasValue = extracted.some((e) => sentence.includes(e.matchedText));
    const section = classify(sentence, hasValue);
    sections[section] = sections[section] ? `${sections[section]} ${sentence}` : sentence;
  }

  const fieldConfidence: FieldConfidence[] = [];

  // A2-3: a contradiction is reported against the field that carries it, with
  // both readings, rather than one being chosen.
  for (const contradiction of contradictions) {
    fieldConfidence.push({
      field: 'objective',
      confidence: 'flagged',
      ambiguity: contradiction.description,
      readings: contradiction.readings,
    });
  }

  // A2-2: a value whose unit is missing and ambiguous flags its field.
  for (const item of extracted.filter((e) => e.flagged)) {
    fieldConfidence.push({
      field: 'objective',
      confidence: 'flagged',
      ambiguity: item.ambiguity ?? `${item.matchedText} has no unit.`,
    });
  }

  // A section the note does not cover is left empty and flagged. Nothing is
  // inferred to fill it — an assessment the clinician did not write is exactly
  // the kind of guess this agent must not make.
  const EMPTY_SECTION_NOTE: Record<Section, string> = {
    subjective: 'The note records nothing the patient reported. Please add it or confirm there is none.',
    objective: 'The note records no measurements or examination findings. Please add them or confirm there are none.',
    assessment:
      'The note does not state an assessment. Nothing has been inferred — please add one or confirm there is none.',
    plan: 'The note does not state a plan. Please add one or confirm there is none.',
  };

  for (const section of ['subjective', 'objective', 'assessment', 'plan'] as const) {
    if (sections[section].trim().length > 0) continue;
    fieldConfidence.push({
      field: section,
      confidence: 'flagged',
      ambiguity: EMPTY_SECTION_NOTE[section],
    });
  }

  for (const field of ['subjective', 'objective', 'assessment', 'plan'] as const) {
    if (fieldConfidence.some((f) => f.field === field)) continue;
    fieldConfidence.push({ field, confidence: 'confident' });
  }

  return {
    structured: sections,
    fieldConfidence,
    observations: extracted
      .filter((e) => e.type !== 'blood_glucose')
      .map((e) => ({
        type: e.type as ObservationType,
        value: e.value,
        unit: e.unit,
        flagged: e.flagged,
        ...(e.ambiguity ? { ambiguity: e.ambiguity } : {}),
      })),
  };
}

export interface StructuringOutcome {
  result: StructuringResult;
  durationMs: number;
}

export async function structureNote(
  patientId: string,
  rawNote: string,
  brief: ContextBrief,
  options: { trigger?: AgentTrigger; correlationId: string },
): Promise<StructuringOutcome> {
  const startedAt = Date.now();
  const runId = runs.start({
    agent: AGENT,
    trigger: options.trigger ?? 'encounter_submit',
    patientId,
    correlationId: options.correlationId,
    inputSummary: `${rawNote.trim().split(/\s+/).length} word note, ${brief.selectedCount} prior encounters in context`,
  });

  try {
    const deterministic = structureDeterministically(rawNote);

    const result = await callAgent<StructuringResult>({
      agent: AGENT,
      system: SYSTEM_PROMPT,
      user: [
        'Context assembled for this patient:',
        `Conditions: ${brief.relevantConditions.join(', ') || 'none recorded'}`,
        `Medications: ${brief.relevantMedications.join('; ') || 'none'}`,
        brief.hasPriorHistory
          ? `Prior encounters selected as relevant: ${brief.selectedCount} of ${brief.consideredCount}`
          : 'This patient has no prior encounters.',
        '',
        'Note to structure:',
        rawNote,
      ].join('\n'),
      schema: STRUCTURE_SCHEMA,
      effort: 'low',
      maxTokens: 8000,
      deterministic: () => deterministic,
      cacheKey: cacheKeyFor([AGENT, patientId, rawNote]),
    });

    // Guard the contract rather than trusting the reply. Observation types are
    // normalised onto the record's vocabulary, values stripped of any unit the
    // model folded into them, and anything that still cannot be placed is
    // dropped and counted rather than written under a type nothing reads.
    const raw = result.output;
    const usable: StructuringResult['observations'] = [];
    let unrecognised = 0;

    for (const observation of raw.observations ?? []) {
      const type = normaliseObservationType(String(observation.type));
      if (!type) {
        unrecognised += 1;
        continue;
      }
      usable.push({ ...observation, type, value: bareValue(String(observation.value)) });
    }

    const structured: StructuringResult = {
      structured: raw.structured,
      fieldConfidence: (raw.fieldConfidence ?? []).map((f) => ({
        ...f,
        ...(f.readings ? { readings: f.readings.map((r) => bareValue(String(r))) } : {}),
      })),
      observations: usable,
    };

    const flaggedFields = structured.fieldConfidence.filter((f) => f.confidence === 'flagged');
    const summary =
      `${flaggedFields.length} field(s) flagged, ${structured.observations.length} observation(s) extracted` +
      (unrecognised > 0 ? `, ${unrecognised} not recognised and left out` : '');

    runs.finish(runId, 'success', summary);
    return { result: structured, durationMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runs.finish(runId, 'failure', 'structuring failed', message);
    throw error;
  }
}
