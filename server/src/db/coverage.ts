import { patients, encounters, observations, billing } from './repositories.ts';
import { SEED_CLINICIAN, SEED_TODAY, SAMPLE_NOTES } from './seed-data.ts';
import { assessMonitoring, isDiabetic, isHypertensive, hasSickleCell } from '../clinical/monitoring.ts';
import type { Patient } from '../../../shared/types.ts';

/**
 * Section 14.11 — before Phase 2, confirm the seeded population can exercise
 * every scenario. If a scenario cannot be exercised, the population is
 * incomplete, not the scenario.
 */

export interface CoverageCheck {
  profile: string;
  scenarios: string;
  satisfiedBy: string | null;
  pass: boolean;
  detail: string;
}

function all(): Patient[] {
  return patients.forClinician(SEED_CLINICIAN.key);
}

function find(
  predicate: (p: Patient) => boolean,
): { patient: Patient | null; detail: string } {
  const match = all().find(predicate) ?? null;
  return { patient: match, detail: match ? match.name : 'no patient matches' };
}

export function checkCoverage(): CoverageCheck[] {
  const checks: CoverageCheck[] = [];

  const add = (
    profile: string,
    scenarios: string,
    result: { patient: Patient | null; detail: string },
  ): void => {
    checks.push({
      profile,
      scenarios,
      satisfiedBy: result.patient?.name ?? null,
      pass: result.patient !== null,
      detail: result.detail,
    });
  };

  // 1. Diabetes with uncontrolled hypertension, HbA1c overdue.
  add(
    'Diabetes with uncontrolled hypertension, HbA1c overdue',
    'GP-1..GP-9, A3-5',
    (() => {
      for (const p of all()) {
        if (!isDiabetic(p) || !isHypertensive(p)) continue;
        const monitoring = assessMonitoring(p, observations.forPatient(p.id), SEED_TODAY);
        const hba1cOverdue = monitoring.some((m) => m.requirement.type === 'hba1c' && m.overdue);
        if (hba1cOverdue) {
          return { patient: p, detail: `${p.name} — diabetes + hypertension, HbA1c overdue` };
        }
      }
      return { patient: null, detail: 'no diabetic + hypertensive patient with an overdue HbA1c' };
    })(),
  );

  // 2. Dengue with progression markers and recent exposure.
  add(
    'Dengue with progression markers and recent exposure',
    'Acute regional risk',
    (() => {
      for (const p of all()) {
        const hasDengue = p.conditions.some(
          (c) => c.name.toLowerCase().includes('dengue') && !c.name.toLowerCase().includes('resolved'),
        );
        if (!hasDengue) continue;
        const platelets = observations.series(p.id, 'platelet_count');
        const haematocrit = observations.series(p.id, 'haematocrit');
        const falling =
          platelets.length >= 2 &&
          Number(platelets[platelets.length - 1]?.value) < Number(platelets[0]?.value);
        const rising =
          haematocrit.length >= 2 &&
          Number(haematocrit[haematocrit.length - 1]?.value) > Number(haematocrit[0]?.value);
        if (falling && rising) {
          return { patient: p, detail: `${p.name} — falling platelets with rising haematocrit` };
        }
      }
      return { patient: null, detail: 'no active dengue patient with progression markers' };
    })(),
  );

  // 3. Sickle cell with prior crisis.
  add(
    'Sickle cell with prior crisis',
    'Chronic regional risk, trend reasoning',
    (() => {
      const match = all().find(
        (p) =>
          hasSickleCell(p) &&
          encounters.forPatient(p.id).some((e) => /crisis/i.test(e.rawNote)),
      );
      return {
        patient: match ?? null,
        detail: match
          ? `${match.name} — ${encounters.forPatient(match.id).filter((e) => /crisis/i.test(e.rawNote)).length} crises documented`
          : 'no sickle cell patient with a documented crisis',
      };
    })(),
  );

  // 4. Stable, fully documented chronic patient.
  add(
    'Stable, fully documented chronic patient',
    'A3-2 [CRITICAL], A4-3',
    (() => {
      for (const p of all()) {
        const hasChronic = isDiabetic(p) || isHypertensive(p);
        if (!hasChronic) continue;
        const daysSince = encounters.daysSinceLast(p.id, SEED_TODAY);
        const monitoring = assessMonitoring(p, observations.forPatient(p.id), SEED_TODAY);
        const nothingOverdue = monitoring.every((m) => !m.overdue);
        const seenRecently = daysSince !== null && daysSince < 90;
        const everyEncounterBilled = encounters
          .forPatient(p.id)
          .every((e) => billing.forEncounter(e.id).length > 0);
        if (nothingOverdue && seenRecently && everyEncounterBilled && p.status === 'stable') {
          return {
            patient: p,
            detail: `${p.name} — nothing overdue, seen ${daysSince}d ago, every encounter billed`,
          };
        }
      }
      return { patient: null, detail: 'no fully documented stable chronic patient' };
    })(),
  );

  // 5. Clinically complete, billing codes missing.
  add(
    'Clinically complete, billing codes missing',
    'A4-1, A4-2 [CRITICAL]',
    (() => {
      for (const p of all()) {
        const unbilled = encounters
          .forPatient(p.id)
          .filter((e) => e.status === 'approved' && billing.forEncounter(e.id).length === 0);
        if (unbilled.length === 0) continue;
        // "Clinically complete" — the note itself has all four sections filled.
        const complete = unbilled.every(
          (e) =>
            e.structured.subjective && e.structured.objective && e.structured.assessment && e.structured.plan,
        );
        if (complete) {
          return {
            patient: p,
            detail: `${p.name} — ${unbilled.length} complete encounter(s) with no billing entry`,
          };
        }
      }
      return { patient: null, detail: 'no patient with a complete but unbilled encounter' };
    })(),
  );

  // 6. Overdue follow-up, otherwise unremarkable.
  add(
    'Overdue follow-up, otherwise unremarkable',
    'A3-3',
    (() => {
      const match = all().find((p) => {
        const daysSince = encounters.daysSinceLast(p.id, SEED_TODAY);
        return daysSince !== null && daysSince > 365 && !isDiabetic(p) && !hasSickleCell(p);
      });
      return {
        patient: match ?? null,
        detail: match
          ? `${match.name} — last seen ${encounters.daysSinceLast(match.id, SEED_TODAY)}d ago`
          : 'no patient overdue for follow-up without other active problems',
      };
    })(),
  );

  // 7. Long chart, 5 or more encounters.
  // A1-2 needs a symptom tied to ONE condition among several, so a long chart
  // covering a single condition cannot exercise it — the check requires both.
  add(
    'Long chart, 5 or more encounters across several conditions',
    'A1-1, A1-2 [CRITICAL]',
    (() => {
      const candidates = all()
        .filter((p) => encounters.forPatient(p.id).length >= 5 && p.conditions.length >= 3)
        .sort((a, b) => b.conditions.length - a.conditions.length);
      const match = candidates[0] ?? null;
      return {
        patient: match,
        detail: match
          ? `${match.name} — ${encounters.forPatient(match.id).length} encounters across ${match.conditions.length} conditions, so relevance selection has something to discard`
          : 'no patient with 5+ encounters spanning 3 or more conditions',
      };
    })(),
  );

  // 8. No prior encounters.
  add(
    'No prior encounters',
    'A1-3',
    (() => {
      const match = all().find((p) => encounters.forPatient(p.id).length === 0);
      return {
        patient: match ?? null,
        detail: match ? `${match.name} — no encounter history` : 'every patient has encounter history',
      };
    })(),
  );

  // 9. Worsening trend across encounters.
  add(
    'Worsening trend across encounters',
    'A3-4',
    (() => {
      for (const p of all()) {
        const series = observations.series(p.id, 'hba1c');
        if (series.length < 3) continue;
        const values = series.map((o) => Number(o.value));
        const rising = values.every((v, i) => i === 0 || v >= (values[i - 1] ?? 0));
        const first = values[0];
        const last = values[values.length - 1];
        if (rising && first !== undefined && last !== undefined && last - first >= 1.0) {
          return {
            patient: p,
            detail: `${p.name} — HbA1c ${first}% to ${last}% across ${values.length} readings`,
          };
        }
      }
      return { patient: null, detail: 'no patient with a monotonic worsening trend' };
    })(),
  );

  // Case outside the encoded clinical logic (A3-6).
  add(
    'Condition outside the encoded clinical logic',
    'A3-6',
    (() => {
      const encoded = ['diabetes', 'hypertension', 'dengue', 'sickle cell'];
      const matches = all().filter(
        (p) =>
          p.conditions.length > 0 &&
          p.conditions.every((c) => !encoded.some((e) => c.name.toLowerCase().includes(e))),
      );
      const match = matches[0] ?? null;
      return {
        patient: match,
        detail: match
          ? `${matches.length} patient(s): ${matches.map((p) => `${p.name} (${p.conditions.map((c) => c.name).join(', ')})`).join('; ')}`
          : 'every patient falls inside the encoded logic',
      };
    })(),
  );

  return checks;
}

export interface SampleNoteCheck {
  label: string;
  exercises: string;
  patient: string;
  pass: boolean;
  detail: string;
}

/** Section 10 requires four sample notes; the golden path adds a fifth. */
export function checkSampleNotes(): SampleNoteCheck[] {
  return SAMPLE_NOTES.map((note) => {
    const patient = patients.byId(`pat_${note.patientKey}`);
    return {
      label: note.label,
      exercises: note.exercises,
      patient: patient?.name ?? `MISSING (${note.patientKey})`,
      pass: patient !== null && note.text.trim().length > 0,
      detail: patient ? `${note.text.trim().split(/\s+/).length} words` : 'patient not in population',
    };
  });
}
