import { settings as store } from '../db/repositories.ts';
import { TH, referenceEntry, setThresholdResolver, type ThresholdName } from '../clinical/reference.ts';

/**
 * Clinic adjustments to clinical thresholds.
 *
 * The reference file stays the authority: it holds the published value and the
 * source it came from, and nothing here rewrites it. An override sits on top,
 * and every one of them has to carry two things a clinician can be held to —
 * why this clinic differs, and what guidance supports the difference. An
 * adjustment with no stated basis is exactly the untraceable number CS-1 exists
 * to prevent, so the API refuses to store one.
 *
 * Departures stay visible: `describeThresholds` reports the reference value
 * alongside the effective one, the Settings screen shows both, and every change
 * lands in the audit trail with its justification.
 */

const KEY = 'clinical.thresholdOverrides';

export interface ThresholdOverride {
  value: number;
  /** Why this clinic's number differs. Required. */
  reason: string;
  /** The guidance supporting it — a named guideline, not a feeling. Required. */
  source: string;
  setBy: string;
  setByName: string;
  setAt: string;
}

export type OverrideMap = Partial<Record<ThresholdName, ThresholdOverride>>;

export function overrides(): OverrideMap {
  return (store.raw(KEY) as OverrideMap | null) ?? {};
}

/** Wired into the clinical layer at startup so rules read adjusted values. */
export function installResolver(): void {
  setThresholdResolver((name) => {
    const override = overrides()[name as ThresholdName];
    return override ? override.value : null;
  });
}

export interface ThresholdRow {
  name: ThresholdName;
  label: string;
  referenceId: string;
  /** The published number from docs/clinical-reference.md. */
  referenceValue: number;
  /** What the rules actually use right now. */
  value: number;
  adjusted: boolean;
  /** The reference file's own wording, so the units and comparison are visible. */
  referenceText: string;
  meaning: string;
  section: string;
  override: ThresholdOverride | null;
}

export function describeThresholds(): ThresholdRow[] {
  const current = overrides();
  return (Object.keys(TH) as ThresholdName[]).map((name) => {
    const threshold = TH[name];
    const entry = referenceEntry(threshold.referenceId);
    const override = current[name] ?? null;
    return {
      name,
      label: threshold.label,
      referenceId: threshold.referenceId,
      referenceValue: threshold.baseValue,
      value: threshold.value,
      adjusted: override !== null,
      referenceText: entry.value,
      meaning: entry.meaning,
      section: entry.section,
      override,
    };
  });
}

/**
 * Orderings that must survive any adjustment.
 *
 * These are not preferences. A stage 2 cut-off below stage 1, or a crisis
 * threshold below stage 2, makes the rules incoherent rather than merely
 * unusual — a reading could be simultaneously in two bands, and which flag
 * fires would depend on evaluation order. Refusing the edit is the only safe
 * answer, and the message says which pair is in conflict.
 */
const ORDERINGS: Array<{ lower: ThresholdName; higher: ThresholdName; what: string }> = [
  { lower: 'bpStage1Systolic', higher: 'bpStage2Systolic', what: 'systolic stage 1 and stage 2' },
  { lower: 'bpStage2Systolic', higher: 'bpCrisisSystolic', what: 'systolic stage 2 and crisis' },
  { lower: 'bpStage1Diastolic', higher: 'bpStage2Diastolic', what: 'diastolic stage 1 and stage 2' },
  { lower: 'bpStage2Diastolic', higher: 'bpCrisisDiastolic', what: 'diastolic stage 2 and crisis' },
  { lower: 'hba1cTarget', higher: 'hba1cPoor', what: 'the HbA1c goal and the poor-control mark' },
  {
    lower: 'denguePlateletCritical',
    higher: 'denguePlateletLow',
    what: 'the platelet marks — the critical one must be the lower number',
  },
  {
    lower: 'hba1cIntervalUnstableDays',
    higher: 'hba1cIntervalStableDays',
    what: 'the HbA1c intervals — a patient above goal must be checked sooner, not later',
  },
];

export interface ValidationProblem {
  message: string;
}

/** Returns null when the proposed change is safe, or the reason it is not. */
export function validate(
  name: ThresholdName,
  value: number,
): ValidationProblem | null {
  if (!Number.isFinite(value)) {
    return { message: 'Enter a number for the threshold.' };
  }
  if (value <= 0) {
    return { message: 'A clinical threshold has to be greater than zero.' };
  }

  const base = TH[name].baseValue;
  // An order of magnitude out is almost always a typo — 70 for an HbA1c goal of
  // 7, say — and silently accepting it would change what the system flags for
  // every patient at once.
  if (value >= base * 10 || value <= base / 10) {
    return {
      message: `${value} is more than ten times away from the published value of ${base}. If that is genuinely intended, the reference file is the place to change it.`,
    };
  }

  // Check the proposed value against the others as they would then stand.
  const projected = (target: ThresholdName): number =>
    target === name ? value : TH[target].value;

  for (const rule of ORDERINGS) {
    if (rule.lower !== name && rule.higher !== name) continue;
    if (projected(rule.lower) >= projected(rule.higher)) {
      return {
        message: `That would put ${rule.what} out of order (${projected(rule.lower)} is not below ${projected(
          rule.higher,
        )}). Adjust the other value first.`,
      };
    }
  }

  return null;
}

export function put(
  name: ThresholdName,
  override: ThresholdOverride,
  clinicianId: string,
): void {
  store.put(KEY, { ...overrides(), [name]: override }, clinicianId);
}

export function remove(name: ThresholdName, clinicianId: string): void {
  const next = { ...overrides() };
  delete next[name];
  store.put(KEY, next, clinicianId);
}

export function isThresholdName(value: string): value is ThresholdName {
  return Object.prototype.hasOwnProperty.call(TH, value);
}
