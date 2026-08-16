import { describe, it, expect, beforeAll } from 'vitest';
import { assembleContext } from '../server/src/agents/intake.ts';
import { structureNote, structureDeterministically } from '../server/src/agents/structuring.ts';
import { encounters, observations } from '../server/src/db/repositories.ts';
import { freshPopulation, patientNamed, sampleNote, PROFILE } from './helpers.ts';
import type { ContextBrief } from '../shared/types.ts';

/** Section 14.2 and 14.3 — Agents 1 and 2. */

beforeAll(() => {
  freshPopulation();
});

const correlationId = 'test-intake';

describe('A1-1  Patient with 5 or more prior encounters', () => {
  it('selects a subset, not all of them', async () => {
    const patient = patientNamed(PROFILE.longChart);
    const history = encounters.approvedForPatient(patient.id);
    expect(history.length).toBeGreaterThanOrEqual(5);

    const { brief } = await assembleContext(
      patient.id,
      'Attends complaining of breathlessness on climbing the hill, worse than before. No chest pain.',
      { correlationId },
    );

    expect(brief.selectedCount).toBeGreaterThan(0);
    expect(brief.selectedCount).toBeLessThan(brief.consideredCount);
  });

  it('states how many were considered against how many were selected, with a reason', async () => {
    const patient = patientNamed(PROFILE.longChart);
    const { brief } = await assembleContext(patient.id, 'Breathlessness on exertion, getting worse.', {
      correlationId,
    });

    expect(brief.consideredCount).toBe(encounters.approvedForPatient(patient.id).length);
    expect(brief.selectedCount).toBe(brief.selectedEncounterIds.length);
    // Always populated, even when everything is selected.
    expect(brief.selectionReasoning.trim().length).toBeGreaterThan(20);
  });
});

describe('A1-2 [CRITICAL]  Note mentions a symptom tied to one condition in a long chart', () => {
  it('surfaces the encounters relevant to that condition', async () => {
    const patient = patientNamed(PROFILE.longChart);
    const history = encounters.approvedForPatient(patient.id);

    const { brief } = await assembleContext(
      patient.id,
      'Reports breathlessness climbing the hill to the house, worse over the past month. No chest pain.',
      { correlationId },
    );

    const selected = history.filter((e) => brief.selectedEncounterIds.includes(e.id));
    const selectedText = selected
      .map((e) => `${e.structured.assessment} ${e.structured.subjective}`)
      .join(' ')
      .toLowerCase();

    // The cardiac thread must be present — that is what breathlessness points at.
    expect(selectedText, `selected: ${selected.map((e) => e.date).join(', ')}`).toMatch(
      /atrial fibrillation|breathless/,
    );
  });

  it('does not simply return everything — the unrelated visits are left out', async () => {
    const patient = patientNamed(PROFILE.longChart);
    const history = encounters.approvedForPatient(patient.id);

    const { brief } = await assembleContext(
      patient.id,
      'Reports breathlessness climbing the hill to the house, worse over the past month. No chest pain.',
      { correlationId },
    );

    expect(brief.selectedEncounterIds.length).toBeLessThan(history.length);

    // The cataract visit has no bearing on breathlessness.
    const cataract = history.find((e) => /cataract/i.test(e.structured.assessment));
    expect(cataract, 'seed should contain a cataract encounter').toBeDefined();
    expect(brief.selectedEncounterIds).not.toContain(cataract!.id);
  });

  it('picks a different subset for a different symptom', async () => {
    const patient = patientNamed(PROFILE.longChart);

    const breathless = await assembleContext(patient.id, 'Breathlessness on exertion for a month.', {
      correlationId,
    });
    const joint = await assembleContext(patient.id, 'Hip joint pain and stiffness worse on the stairs.', {
      correlationId,
    });

    expect(
      breathless.brief.selectedEncounterIds.sort(),
      'relevance selection that never changes is not a real judgement',
    ).not.toEqual(joint.brief.selectedEncounterIds.sort());
  });
});

describe('A1-3  Patient with no prior encounters', () => {
  it('states explicitly that there is no prior history', async () => {
    const patient = patientNamed(PROFILE.noHistory);
    expect(encounters.approvedForPatient(patient.id)).toEqual([]);

    const { brief } = await assembleContext(patient.id, 'New patient, presenting with a cough for three days.', {
      correlationId,
    });

    expect(brief.hasPriorHistory).toBe(false);
    expect(brief.consideredCount).toBe(0);
    expect(brief.selectedCount).toBe(0);
    // Not an empty panel and not an error — it says so in words.
    expect(brief.selectionReasoning.toLowerCase()).toMatch(/no previous|no prior|first/);
    expect(brief.noHistoryNote).toBeTruthy();
  });
});

describe('A1-4  The raw note is never modified', () => {
  it('passes the note downstream byte for byte', async () => {
    const patient = patientNamed(PROFILE.comorbidity);
    const note = sampleNote('golden_path');

    const { brief } = await assembleContext(patient.id, note, { correlationId });
    expect(brief.rawNote).toBe(note);
    expect(brief.rawNote.length).toBe(note.length);
  });

  it('preserves an informally phrased note exactly', async () => {
    const patient = patientNamed(PROFILE.sickleCell);
    const note = sampleNote('informal');

    const { brief } = await assembleContext(patient.id, note, { correlationId });
    expect(brief.rawNote).toBe(note);
  });
});

/* ------------------------------------------------------------------ Agent 2 -- */

async function structure(patientKey: string, noteKey: string) {
  const patient = patientNamed(patientKey);
  const { brief } = await assembleContext(patient.id, sampleNote(noteKey), { correlationId });
  const { result } = await structureNote(patient.id, sampleNote(noteKey), brief, { correlationId });
  return { patient, brief, result };
}

describe('A2-1  Clean note', () => {
  it('populates all sections, flags nothing, and extracts units', async () => {
    const { result } = await structure(PROFILE.wellControlled, 'clean');

    for (const section of ['subjective', 'objective', 'assessment', 'plan'] as const) {
      expect(result.structured[section].trim().length, `${section} is empty`).toBeGreaterThan(0);
    }

    const flagged = result.fieldConfidence.filter((f) => f.confidence === 'flagged');
    expect(flagged.map((f) => `${f.field}: ${f.ambiguity}`)).toEqual([]);

    const bp = result.observations.find((o) => o.type === 'blood_pressure');
    expect(bp?.value).toBe('126/78');
    expect(bp?.unit).toBe('mmHg');
    expect(result.observations.find((o) => o.type === 'weight')?.unit).toBe('kg');
    expect(result.observations.every((o) => !o.flagged)).toBe(true);
  });
});

describe('A2-2 [CRITICAL]  Value with a missing or ambiguous unit', () => {
  it('flags the field rather than guessing the unit', async () => {
    const { result } = await structure(PROFILE.worseningTrend, 'ambiguous_unit');

    const weight = result.observations.find((o) => o.type === 'weight');
    expect(weight, 'expected the weight to be extracted').toBeDefined();
    expect(weight!.flagged, 'a bare weight must not be assumed to be kilograms').toBe(true);

    const flagged = result.fieldConfidence.filter((f) => f.confidence === 'flagged');
    expect(flagged.length).toBeGreaterThan(0);
  });

  it('names what specifically is ambiguous', async () => {
    const { result } = await structure(PROFILE.worseningTrend, 'ambiguous_unit');
    const explanation = result.fieldConfidence
      .filter((f) => f.confidence === 'flagged')
      .map((f) => f.ambiguity ?? '')
      .join(' ')
      .toLowerCase();

    expect(explanation).toMatch(/unit/);
    expect(explanation, explanation).toMatch(/kilogram|pound|kg|lb/);
  });

  it('does not flag values whose unit is unambiguous by convention', async () => {
    const { result } = await structure(PROFILE.worseningTrend, 'ambiguous_unit');
    expect(result.observations.find((o) => o.type === 'blood_pressure')?.flagged).toBe(false);
    expect(result.observations.find((o) => o.type === 'hba1c')?.flagged).toBe(false);
  });
});

describe('A2-3 [CRITICAL]  Contradictory information', () => {
  it('surfaces both readings and picks neither', async () => {
    const { result } = await structure(PROFILE.comorbidity, 'contradictory');

    const contradiction = result.fieldConfidence.find(
      (f) => f.confidence === 'flagged' && (f.readings?.length ?? 0) >= 2,
    );
    expect(contradiction, 'expected a flag carrying both readings').toBeDefined();
    expect(contradiction!.readings).toContain('142/88');
    expect(contradiction!.readings).toContain('128/76');
    expect(contradiction!.ambiguity?.toLowerCase()).toMatch(/both|neither|more than one/);
  });

  it('keeps both readings in the extracted observations', async () => {
    const { result } = await structure(PROFILE.comorbidity, 'contradictory');
    const readings = result.observations.filter((o) => o.type === 'blood_pressure').map((o) => o.value);
    expect(readings).toContain('142/88');
    expect(readings).toContain('128/76');
  });
});

describe('A2-4  Nothing is written to the saved record before approval', () => {
  it('leaves the data layer untouched — verified at the data layer', async () => {
    const patient = patientNamed(PROFILE.comorbidity);
    const encountersBefore = encounters.forPatient(patient.id).map((e) => e.id);
    const observationsBefore = observations.forPatient(patient.id).length;

    await structure(PROFILE.comorbidity, 'golden_path');

    expect(encounters.forPatient(patient.id).map((e) => e.id)).toEqual(encountersBefore);
    expect(observations.forPatient(patient.id).length).toBe(observationsBefore);
  });
});

describe('A2-5  Informal phrasing', () => {
  it('still structures correctly and preserves clinical meaning', async () => {
    const { result } = await structure(PROFILE.sickleCell, 'informal');

    // The complaint belongs in subjective.
    expect(result.structured.subjective.toLowerCase()).toMatch(/pain/);
    // The measured value belongs in objective.
    expect(result.structured.objective.toLowerCase()).toMatch(/7\.3|hb/);
    // The instructions belong in plan.
    expect(result.structured.plan.toLowerCase()).toMatch(/water|pain|come back/);

    // The haemoglobin survived the register.
    const hb = result.observations.find((o) => o.type === 'haemoglobin');
    expect(hb?.value).toBe('7.3');
    expect(hb?.unit).toBe('g/dL');
  });

  it('does not invent an assessment the clinician never wrote', async () => {
    const { result } = await structure(PROFILE.sickleCell, 'informal');
    if (result.structured.assessment.trim().length === 0) {
      const flagged = result.fieldConfidence.find(
        (f) => f.field === 'assessment' && f.confidence === 'flagged',
      );
      expect(flagged, 'an empty assessment must be flagged, not left silently blank').toBeDefined();
    }
  });
});

describe('Structuring is deterministic and side-effect free', () => {
  it('produces the same result for the same note', () => {
    const note = sampleNote('contradictory');
    const first = structureDeterministically(note);
    const second = structureDeterministically(note);
    expect(second).toEqual(first);
  });

  it('handles a note with no recognisable values without throwing', () => {
    const result = structureDeterministically(
      'Patient attends to discuss travel vaccination options before a trip. Advised to return once dates are confirmed.',
    );
    expect(result.observations).toEqual([]);
    expect(result.fieldConfidence.some((f) => f.confidence === 'flagged')).toBe(true);
  });
});

/** The context brief Agent 2 receives stays intact through the handoff. */
describe('The Agent 1 to Agent 2 handoff', () => {
  it('carries the context brief into structuring', async () => {
    const { brief } = await structure(PROFILE.comorbidity, 'golden_path');
    const typed: ContextBrief = brief;
    expect(typed.relevantMedications.join(' ')).toMatch(/Metformin/i);
    expect(typed.hasPriorHistory).toBe(true);
    expect(typed.consideredCount).toBeGreaterThan(0);
  });
});
