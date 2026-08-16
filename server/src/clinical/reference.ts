import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/config.ts';

/**
 * Section 12: every clinical threshold comes from published guidance and is
 * recorded in a single reference file with its source. No magic numbers live in
 * code or prompts.
 *
 * This module is the one place a number appears in the codebase, and each one is
 * bound to an entry in docs/clinical-reference.md. `verifyReference()` checks at
 * startup and in the test suite that the number here still appears in the row it
 * claims — so editing the reference file without editing the code fails loudly
 * rather than letting the two drift apart. CS-1 is checked this way.
 */

export const REFERENCE_PATH = path.join(ROOT, 'docs', 'clinical-reference.md');

export interface ReferenceEntry {
  id: string;
  rule: string;
  value: string;
  meaning: string;
  section: string;
}

let entries: Map<string, ReferenceEntry> | null = null;

/** Parses the ID / Rule / Value / Meaning tables out of the reference file. */
export function loadReference(): Map<string, ReferenceEntry> {
  if (entries) return entries;

  const text = fs.readFileSync(REFERENCE_PATH, 'utf8');
  const parsed = new Map<string, ReferenceEntry>();
  let section = '';

  for (const line of text.split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading?.[1]) {
      section = heading[1].trim();
      continue;
    }

    // A data row looks like: | `ID` | rule | value | meaning |
    const row = /^\|\s*`([A-Z0-9-]+)`\s*\|(.+)\|\s*$/.exec(line);
    if (!row?.[1] || !row[2]) continue;

    const cells = row[2].split('|').map((c) => c.trim());
    if (cells.length < 3) continue;

    parsed.set(row[1], {
      id: row[1],
      rule: cells[0] ?? '',
      value: cells[1] ?? '',
      meaning: cells[2] ?? '',
      section,
    });
  }

  entries = parsed;
  return parsed;
}

export function referenceEntry(id: string): ReferenceEntry {
  const entry = loadReference().get(id);
  if (!entry) {
    throw new Error(
      `Clinical reference entry "${id}" is not in docs/clinical-reference.md. ` +
        'Every threshold must be recorded there with its source (Section 12).',
    );
  }
  return entry;
}

/**
 * A threshold: a number, the units it is in, and the reference entry that is its
 * authority. Nothing in the system uses a number that is not one of these.
 *
 * `value` is a getter rather than a plain number so a clinic can adjust a
 * threshold without any rule needing to know that adjustment exists. What it
 * never loses is `referenceId` and `baseValue`: an adjusted threshold still
 * names the published entry it departs from, and still knows what that entry
 * said. That is what keeps CS-1 true — traceability was never a claim that the
 * numbers are immutable, it is a claim that every number can be traced to a
 * source and any departure from it is visible.
 */
export interface Threshold {
  readonly value: number;
  readonly baseValue: number;
  readonly referenceId: string;
  readonly label: string;
  /** The key this threshold is adjusted under, and its name in TH. */
  readonly name: string;
}

/**
 * Resolves a clinic's override for a threshold, or null for "use the reference".
 *
 * Injected at startup rather than imported, because this module is the bottom
 * of the clinical stack and must not depend on the database — the rules tests
 * exercise it with no server running.
 */
type OverrideResolver = (name: string) => number | null;
let resolveOverride: OverrideResolver = () => null;

export function setThresholdResolver(resolver: OverrideResolver): void {
  resolveOverride = resolver;
}

/** Restores reference values. Used between tests so one cannot leak into another. */
export function clearThresholdResolver(): void {
  resolveOverride = () => null;
}

function threshold(referenceId: string, value: number, label: string, name = ''): Threshold {
  return {
    baseValue: value,
    referenceId,
    label,
    name,
    get value(): number {
      const override = resolveOverride(name);
      return override === null || !Number.isFinite(override) ? value : override;
    },
  };
}

export const TH = {
  // 1. Blood pressure — 2017 ACC/AHA
  bpStage1Systolic: threshold('BP-STAGE1', 130, 'stage 1 hypertension, systolic', 'bpStage1Systolic'),
  bpStage1Diastolic: threshold('BP-STAGE1', 80, 'stage 1 hypertension, diastolic', 'bpStage1Diastolic'),
  bpStage2Systolic: threshold('BP-STAGE2', 140, 'stage 2 hypertension, systolic', 'bpStage2Systolic'),
  bpStage2Diastolic: threshold('BP-STAGE2', 90, 'stage 2 hypertension, diastolic', 'bpStage2Diastolic'),
  bpCrisisSystolic: threshold('BP-CRISIS', 180, 'hypertensive crisis, systolic', 'bpCrisisSystolic'),
  bpCrisisDiastolic: threshold('BP-CRISIS', 120, 'hypertensive crisis, diastolic', 'bpCrisisDiastolic'),

  // 2. Diabetes — ADA Standards of Care
  hba1cTarget: threshold('HBA1C-TARGET', 7.0, 'HbA1c goal', 'hba1cTarget'),
  hba1cPoor: threshold('HBA1C-POOR', 9.0, 'HbA1c poor control', 'hba1cPoor'),
  hba1cIntervalStableDays: threshold('HBA1C-INTERVAL-STABLE', 182, 'HbA1c interval when at goal', 'hba1cIntervalStableDays'),
  hba1cIntervalUnstableDays: threshold('HBA1C-INTERVAL-UNSTABLE', 91, 'HbA1c interval when above goal', 'hba1cIntervalUnstableDays'),

  // 3. Kidney monitoring in diabetes — ADA Standards of Care
  acrIntervalDays: threshold('ACR-INTERVAL', 365, 'urine ACR interval', 'acrIntervalDays'),
  acrAbnormal: threshold('ACR-ABNORMAL', 30, 'raised urine ACR', 'acrAbnormal'),
  egfrIntervalDays: threshold('EGFR-INTERVAL', 365, 'eGFR interval', 'egfrIntervalDays'),
  egfrReduced: threshold('EGFR-REDUCED', 60, 'reduced eGFR', 'egfrReduced'),

  // 4. Dengue — WHO 2009
  dengueCriticalWindowStart: threshold('DENGUE-CRITICAL-WINDOW', 3, 'critical phase, first day', 'dengueCriticalWindowStart'),
  dengueCriticalWindowEnd: threshold('DENGUE-CRITICAL-WINDOW', 7, 'critical phase, last day', 'dengueCriticalWindowEnd'),
  denguePlateletLow: threshold('DENGUE-PLATELET-LOW', 100, 'falling platelet count', 'denguePlateletLow'),
  denguePlateletCritical: threshold('DENGUE-PLATELET-CRITICAL', 50, 'marked thrombocytopenia', 'denguePlateletCritical'),

  // 5. Sickle cell disease — NHLBI 2014
  scdFeverCelsius: threshold('SCD-FEVER', 38.5, 'fever in sickle cell disease', 'scdFeverCelsius'),
  scdHydroxyureaCrises: threshold('SCD-HYDROXYUREA', 3, 'crises prompting hydroxyurea discussion', 'scdHydroxyureaCrises'),

  // 6. Follow-up intervals
  followupUncontrolledDays: threshold('FOLLOWUP-CHRONIC-UNCONTROLLED', 91, 'follow-up, not at target', 'followupUncontrolledDays'),
  followupStableDays: threshold('FOLLOWUP-CHRONIC-STABLE', 182, 'follow-up, at target', 'followupStableDays'),
  followupNoChronicDays: threshold('FOLLOWUP-NO-CHRONIC', 365, 'follow-up, no chronic condition', 'followupNoChronicDays'),
} as const;

export type ThresholdName = keyof typeof TH;

/**
 * Intervals are stored in days for arithmetic but written in the reference file
 * in months. This maps a day count back to the phrase the file uses, so the
 * verification below compares like with like.
 */
const DAY_EQUIVALENTS: Record<number, string[]> = {
  91: ['3 months'],
  182: ['6 months'],
  365: ['a year', '12 months'],
};

export interface VerificationResult {
  ok: boolean;
  problems: string[];
  checked: number;
}

/**
 * CS-1: read every threshold the system uses and confirm each appears in the
 * clinical reference file with a source. Run at startup and in the test suite.
 */
export function verifyReference(): VerificationResult {
  const problems: string[] = [];
  let checked = 0;

  for (const [name, th] of Object.entries(TH) as Array<[string, Threshold]>) {
    checked += 1;

    let entry: ReferenceEntry;
    try {
      entry = referenceEntry(th.referenceId);
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
      continue;
    }

    const haystack = entry.value.toLowerCase();
    const candidates = [
      String(th.value),
      // 7 should match "7.0 percent", and 7.0 should match "7".
      th.value % 1 === 0 ? `${th.value}.0` : String(Math.round(th.value)),
      ...(DAY_EQUIVALENTS[th.value] ?? []),
    ];

    if (!candidates.some((c) => haystack.includes(c.toLowerCase()))) {
      problems.push(
        `Threshold "${name}" uses ${th.value} but reference entry ${th.referenceId} ` +
          `("${entry.value}") does not contain that value. Update one to match the other.`,
      );
    }
  }

  return { ok: problems.length === 0, problems, checked };
}

/** Human-readable citation for a flag's reasoning trail. */
export function citation(referenceId: string): string {
  const entry = referenceEntry(referenceId);
  return `${entry.section} — ${entry.rule}: ${entry.value}`;
}
