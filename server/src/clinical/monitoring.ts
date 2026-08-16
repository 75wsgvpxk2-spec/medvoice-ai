import { TH } from './reference.ts';
import type { Observation, ObservationType, Patient } from '../../../shared/types.ts';

/**
 * Which observations a patient's conditions require, and how often.
 * Every interval comes from docs/clinical-reference.md via TH — nothing here is
 * a number typed into code (Section 12).
 */

export function hasCondition(patient: Patient, match: string): boolean {
  return patient.conditions.some((c) => c.name.toLowerCase().includes(match.toLowerCase()));
}

export const isDiabetic = (p: Patient): boolean => hasCondition(p, 'diabetes');
export const isHypertensive = (p: Patient): boolean => hasCondition(p, 'hypertension');
export const hasSickleCell = (p: Patient): boolean => hasCondition(p, 'sickle cell disease');
export const hasActiveDengue = (p: Patient): boolean =>
  p.conditions.some((c) => c.name.toLowerCase().includes('dengue') && !c.name.toLowerCase().includes('resolved'));

export interface MonitoringRequirement {
  type: ObservationType;
  intervalDays: number;
  referenceId: string;
  /** Plain wording used in alerts and flag reasoning. */
  label: string;
}

/**
 * What this patient should have on file, given their problem list.
 * The HbA1c interval depends on whether the last result was at goal, which is
 * why the latest value is passed in rather than assumed.
 */
export function requirementsFor(
  patient: Patient,
  latestHba1c: Observation | null,
): MonitoringRequirement[] {
  const required: MonitoringRequirement[] = [];

  if (isDiabetic(patient)) {
    const atGoal = latestHba1c !== null && Number(latestHba1c.value) < TH.hba1cTarget.value;
    required.push({
      type: 'hba1c',
      intervalDays: atGoal ? TH.hba1cIntervalStableDays.value : TH.hba1cIntervalUnstableDays.value,
      referenceId: atGoal ? TH.hba1cIntervalStableDays.referenceId : TH.hba1cIntervalUnstableDays.referenceId,
      label: 'HbA1c',
    });
    required.push({
      type: 'urine_acr',
      intervalDays: TH.acrIntervalDays.value,
      referenceId: TH.acrIntervalDays.referenceId,
      label: 'urine albumin-to-creatinine ratio',
    });
    required.push({
      type: 'egfr',
      intervalDays: TH.egfrIntervalDays.value,
      referenceId: TH.egfrIntervalDays.referenceId,
      label: 'kidney function (eGFR)',
    });
  }

  return required;
}

export interface OverdueFinding {
  requirement: MonitoringRequirement;
  /** The most recent result on file, or null when there has never been one. */
  latest: Observation | null;
  daysSince: number | null;
  overdue: boolean;
}

export function assessMonitoring(
  patient: Patient,
  observations: Observation[],
  asOf: Date,
): OverdueFinding[] {
  const latestHba1c = latestOf(observations, 'hba1c');

  return requirementsFor(patient, latestHba1c).map((requirement) => {
    const latest = latestOf(observations, requirement.type);
    if (!latest) {
      return { requirement, latest: null, daysSince: null, overdue: true };
    }
    const daysSince = daysBetween(latest.recordedOn, asOf);
    return { requirement, latest, daysSince, overdue: daysSince > requirement.intervalDays };
  });
}

/** How long a patient may go between encounters before they are overdue to be seen. */
export function followUpIntervalDays(patient: Patient, atTarget: boolean): {
  days: number;
  referenceId: string;
} {
  const hasChronic = isDiabetic(patient) || isHypertensive(patient) || hasSickleCell(patient);
  if (!hasChronic) {
    return { days: TH.followupNoChronicDays.value, referenceId: TH.followupNoChronicDays.referenceId };
  }
  return atTarget
    ? { days: TH.followupStableDays.value, referenceId: TH.followupStableDays.referenceId }
    : { days: TH.followupUncontrolledDays.value, referenceId: TH.followupUncontrolledDays.referenceId };
}

export function latestOf(observations: Observation[], type: ObservationType): Observation | null {
  const matching = observations
    .filter((o) => o.type === type)
    .sort((a, b) => b.recordedOn.localeCompare(a.recordedOn));
  return matching[0] ?? null;
}

export function daysBetween(iso: string, asOf: Date): number {
  return Math.floor((asOf.getTime() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Whether a plan says an investigation was requested and is still outstanding.
 *
 * Matching a verb alone ("arranged", "requested") is too loose: "Review of
 * ongoing management arranged" and "Referral to the diabetes nurse arranged"
 * both match and neither produces a result. A test has to be named too.
 */
const REQUEST_VERB = /\b(requested|arranged|sent|await(ing|ed)?|ordered)\b/i;
const INVESTIGATION_NOUN =
  /\b(test|tests|bloods|blood test|level|levels|function|profile|panel|scan|x-?ray|ultrasound|ecg|culture|swab|sample|screen|biopsy|hba1c|acr|egfr|albumin|creatinine|platelet)\b/i;

export function mentionsOutstandingInvestigation(plan: string): boolean {
  return REQUEST_VERB.test(plan) && INVESTIGATION_NOUN.test(plan);
}

/** "148/92" -> {systolic: 148, diastolic: 92}. Returns null if unparseable. */
export function parseBloodPressure(value: string): { systolic: number; diastolic: number } | null {
  const m = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/.exec(value);
  if (!m?.[1] || !m[2]) return null;
  return { systolic: Number(m[1]), diastolic: Number(m[2]) };
}
