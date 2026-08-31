import { observations, encounters } from '../db/repositories.ts';
import { HSE_DEFAULTS, type HseFindings, type Patient } from '../../../shared/types.ts';

/**
 * Pre-fill an HSE medical from what the record already knows.
 *
 * This is the whole reason to build the wizard rather than keep using a word
 * processor. The clinic has already measured this person's blood pressure and
 * pulse, often on the day of the examination; retyping those numbers into a
 * document is both slow and a chance to transcribe one wrongly.
 *
 * Two rules govern what is filled:
 *
 * 1. **Measurements are only ever copied, never invented.** A field with no
 *    recorded value is left blank for the doctor. A plausible-looking blood
 *    pressure nobody took is the single worst thing this file could produce.
 * 2. **Only recent observations count.** A pulse from eighteen months ago is
 *    not a finding of today's examination, so anything older than the window
 *    is ignored rather than presented as current.
 */

/** How far back a measurement can be and still describe today's examination. */
const RECENT_DAYS = 30;

export interface Prefilled {
  findings: HseFindings;
  /** What was taken from the record, so the screen can say so field by field. */
  sources: Record<string, { value: string; recordedOn: string }>;
  /**
   * Values on file but too old to present as today's findings.
   *
   * Dropping them silently leaves the doctor with a blank box and no idea the
   * clinic has ever measured this. Filling the box with them would assert that
   * a reading from ten months ago is today's. So they are handed over labelled
   * as history, for the doctor to read and ignore or act on.
   */
  stale: Array<{ field: string; label: string; value: string; recordedOn: string; daysAgo: number }>;
}

function daysBetween(from: string, to: Date): number {
  const then = new Date(from).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.floor((to.getTime() - then) / 86_400_000);
}

const LABELS: Record<string, string> = {
  blood_pressure: 'Blood pressure',
  heart_rate: 'Pulse',
  oxygen_saturation: 'SpO2',
  weight: 'Weight',
};

const FIELD_FOR: Record<string, string> = {
  blood_pressure: 'bloodPressure',
  heart_rate: 'pulse',
  oxygen_saturation: 'spo2',
  weight: 'weightLb',
};

export function prefillFor(patient: Patient, asOf = new Date()): Prefilled {
  const findings: HseFindings = structuredClone(HSE_DEFAULTS);
  const sources: Prefilled['sources'] = {};

  const all = observations
    .forPatient(patient.id)
    .sort((a, b) => b.recordedOn.localeCompare(a.recordedOn));

  // Newest first, so the first match for a type is the most recent one.
  const recent = all.filter((o) => daysBetween(o.recordedOn, asOf) <= RECENT_DAYS);

  const stale: Prefilled['stale'] = [];
  for (const type of Object.keys(FIELD_FOR)) {
    if (recent.some((o) => o.type === type)) continue;
    const last = all.find((o) => o.type === type);
    if (!last) continue;
    stale.push({
      field: FIELD_FOR[type]!,
      label: LABELS[type] ?? type,
      value: `${last.value}${last.unit}`,
      recordedOn: last.recordedOn,
      daysAgo: daysBetween(last.recordedOn, asOf),
    });
  }

  const take = (type: string, field: string, apply: (value: string) => void): void => {
    const found = recent.find((o) => o.type === type);
    if (!found) return;
    apply(found.value);
    sources[field] = { value: found.value, recordedOn: found.recordedOn };
  };

  take('blood_pressure', 'bloodPressure', (v) => { findings.vitals.bloodPressure = v; });
  take('heart_rate', 'pulse', (v) => { findings.vitals.pulse = v; });
  take('oxygen_saturation', 'spo2', (v) => { findings.vitals.spo2 = v; });

  // The record keeps weight in kilograms; this form asks for pounds. Converting
  // is safer than asking the doctor to do it, and the source note shows the
  // original so the arithmetic is checkable rather than trusted.
  const weight = recent.find((o) => o.type === 'weight');
  if (weight) {
    const kg = Number(weight.value);
    if (Number.isFinite(kg) && kg > 0) {
      findings.vitals.weightLb = String(Math.round(kg * 2.20462));
      sources['weightLb'] = { value: `${weight.value} kg`, recordedOn: weight.recordedOn };
    }
  }

  return { findings, sources, stale };
}

/** BMI from height and weight, or an empty string when either is missing. */
export function bmiFrom(heightCm: string, weightLb: string): string {
  const h = Number(heightCm) / 100;
  const lb = Number(weightLb);
  if (!Number.isFinite(h) || !Number.isFinite(lb) || h <= 0 || lb <= 0) return '';
  const kg = lb / 2.20462;
  return (kg / (h * h)).toFixed(1);
}

/**
 * The examination date, defaulting to the most recent approved encounter.
 *
 * An HSE medical is written up after the appointment, sometimes days later, so
 * today's date is usually the wrong answer and the last consultation is usually
 * the right one.
 */
export function suggestedExamDate(patientId: string, asOf = new Date()): string {
  const latest = encounters
    .forPatient(patientId)
    .filter((e) => e.status === 'approved')
    .map((e) => e.date)
    .sort()
    .pop();
  return latest ?? asOf.toISOString().slice(0, 10);
}
