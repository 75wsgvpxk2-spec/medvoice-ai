import { TH } from './reference.ts';
import {
  assessMonitoring,
  daysBetween,
  followUpIntervalDays,
  hasActiveDengue,
  hasSickleCell,
  isDiabetic,
  isHypertensive,
  latestOf,
  mentionsOutstandingInvestigation,
  parseBloodPressure,
} from './monitoring.ts';
import type { Encounter, FlagUrgency, Observation, Patient } from '../../../shared/types.ts';

/**
 * The encoded clinical logic of Section 12.
 *
 * Every threshold used here comes from TH, which is bound to an entry in
 * docs/clinical-reference.md. This module decides *whether* something is
 * clinically significant; it never decides how to say it. The wording of a
 * flag's reasoning is Agent 3's job (see agents/clinical-intelligence.ts), which
 * keeps the safety-critical numbers sourced and the language human.
 *
 * Section 5: over-flagging is a failure mode, not a safe default. A patient who
 * meets no rule below produces no finding at all.
 */

export interface Finding {
  /** Stable identity for this concern, used for dismissal suppression (FD-2). */
  flagType: string;
  urgency: FlagUrgency;
  confidence: 'high' | 'uncertain';
  /** CS-1: which clinical reference entries authorise this finding. */
  referenceIds: string[];
  /**
   * The clinical facts, in structured form. Agent 3 turns these into a sentence;
   * they are also the fallback wording when no model is available.
   */
  facts: string[];
  /** Plain wording used when the model is unavailable. */
  fallbackReasoning: string;
  fallbackAction: string;
  triggeringEncounterId?: string | null;
  triggeringObservationId?: string | null;
  /** Contribution to ranking. Ranking is severity, trend, and time — not severity alone. */
  severityScore: number;
  /** Set when this finding is a trend rather than a single reading (A3-4). */
  trend?: string;
}

export interface PatientEvidence {
  patient: Patient;
  observations: Observation[];
  encounters: Encounter[];
  daysSinceLastEncounter: number | null;
}

const ENCODED_CONDITIONS = ['diabetes', 'hypertension', 'dengue', 'sickle cell'];

/**
 * CS-5: ten flag reasonings read in sequence must be clinical sentences, not one
 * template with values substituted. When a model is available it writes them.
 * Without one, this picks between hand-written phrasings using a seed derived
 * from the patient id — so the list varies down the page while a repeated run
 * over unchanged data still produces identical output (A3-7).
 */
/** FNV-1a. Distributes short, similar keys such as patient ids far better than a
 *  simple polynomial hash, which clustered them into the same variant. */
function seedOf(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function pick(patientId: string, salt: number, variants: string[]): string {
  const index = seedOf(`${patientId}:${salt}`) % variants.length;
  return variants[index] ?? variants[0] ?? '';
}

function isOutsideEncodedLogic(patient: Patient): boolean {
  return (
    patient.conditions.length > 0 &&
    patient.conditions.every(
      (c) => !ENCODED_CONDITIONS.some((e) => c.name.toLowerCase().includes(e)),
    )
  );
}

/** An investigation the plan says was requested, where no result has come back. */
function hasUnresolvedInvestigation(evidence: PatientEvidence, asOf: Date): boolean {
  const latest = evidence.encounters[0];
  if (!latest) return false;
  if (!mentionsOutstandingInvestigation(latest.structured.plan)) return false;
  // Allow time for a result to come back before treating it as unresolved.
  return daysBetween(latest.date, asOf) > 28;
}

export function evaluate(evidence: PatientEvidence, asOf: Date): Finding[] {
  const { patient, observations, encounters } = evidence;
  const findings: Finding[] = [];

  /* ------------------------------------------------------- blood pressure -- */

  const bpObs = latestOf(observations, 'blood_pressure');
  const bp = bpObs ? parseBloodPressure(bpObs.value) : null;

  if (bp && bpObs) {
    if (bp.systolic > TH.bpCrisisSystolic.value || bp.diastolic > TH.bpCrisisDiastolic.value) {
      findings.push({
        flagType: 'hypertensive_crisis',
        urgency: 'critical',
        confidence: 'high',
        referenceIds: [TH.bpCrisisSystolic.referenceId],
        facts: [`blood pressure ${bpObs.value} mmHg recorded on ${bpObs.recordedOn}`],
        fallbackReasoning: `Blood pressure ${bpObs.value} mmHg is in the hypertensive crisis range.`,
        fallbackAction: 'Assess today and consider urgent antihypertensive review.',
        triggeringObservationId: bpObs.id,
        severityScore: 1000,
      });
    } else if (
      bp.systolic >= TH.bpStage2Systolic.value ||
      bp.diastolic >= TH.bpStage2Diastolic.value
    ) {
      const series = observations
        .filter((o) => o.type === 'blood_pressure')
        .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn));
      const persistent = series.filter((o) => {
        const parsed = parseBloodPressure(o.value);
        return (
          parsed &&
          (parsed.systolic >= TH.bpStage2Systolic.value || parsed.diastolic >= TH.bpStage2Diastolic.value)
        );
      });

      findings.push({
        flagType: 'hypertension_uncontrolled',
        urgency: 'watch',
        confidence: 'high',
        referenceIds: [TH.bpStage2Systolic.referenceId],
        facts: [
          `blood pressure ${bpObs.value} mmHg on ${bpObs.recordedOn}`,
          persistent.length > 1
            ? `${persistent.length} consecutive readings at or above stage 2`
            : 'first reading at stage 2',
        ],
        fallbackReasoning:
          persistent.length > 1
            ? pick(patient.id, 3, [
                `Blood pressure has stayed at stage 2 across ${persistent.length} readings, most recently ${bpObs.value} mmHg.`,
                `${persistent.length} consecutive readings have been at stage 2 or worse, the latest ${bpObs.value} mmHg.`,
                `Blood pressure is not responding, still ${bpObs.value} mmHg after ${persistent.length} readings at stage 2.`,
              ])
            : pick(patient.id, 4, [
                `Blood pressure ${bpObs.value} mmHg has reached stage 2.`,
                `A stage 2 reading of ${bpObs.value} mmHg was recorded on ${bpObs.recordedOn}.`,
              ]),
        fallbackAction: 'Review antihypertensive therapy at the next appointment.',
        triggeringObservationId: bpObs.id,
        severityScore: 400 + Math.min(persistent.length, 4) * 15,
        ...(persistent.length > 1 && { trend: `${persistent.length} readings at stage 2 or above` }),
      });
    }
  }

  /* -------------------------------------------------------------- diabetes -- */

  if (isDiabetic(patient)) {
    const hba1cSeries = observations
      .filter((o) => o.type === 'hba1c')
      .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn));
    const latestHba1c = hba1cSeries[hba1cSeries.length - 1];

    if (latestHba1c) {
      const value = Number(latestHba1c.value);
      const first = hba1cSeries[0];
      const rising =
        hba1cSeries.length >= 3 &&
        first !== undefined &&
        value - Number(first.value) >= 1.0 &&
        hba1cSeries.every((o, i) => i === 0 || Number(o.value) >= Number(hba1cSeries[i - 1]?.value ?? 0));

      if (value >= TH.hba1cPoor.value) {
        findings.push({
          flagType: 'diabetes_poor_control',
          urgency: 'watch',
          confidence: 'high',
          referenceIds: [TH.hba1cPoor.referenceId],
          facts: [`HbA1c ${latestHba1c.value}% on ${latestHba1c.recordedOn}`],
          fallbackReasoning: `HbA1c ${latestHba1c.value}% is in the poorly controlled range.`,
          fallbackAction: 'Review glycaemic therapy.',
          triggeringObservationId: latestHba1c.id,
          severityScore: 500,
        });
      } else if (value >= TH.hba1cTarget.value) {
        findings.push({
          flagType: rising ? 'diabetes_worsening_trend' : 'diabetes_above_target',
          urgency: 'watch',
          confidence: 'high',
          referenceIds: [TH.hba1cTarget.referenceId],
          facts: rising
            ? [
                `HbA1c has risen from ${first?.value}% to ${latestHba1c.value}% across ${hba1cSeries.length} readings`,
                `most recent reading ${latestHba1c.recordedOn}`,
              ]
            : [`HbA1c ${latestHba1c.value}% on ${latestHba1c.recordedOn}, above the ${TH.hba1cTarget.value}% goal`],
          fallbackReasoning: rising
            ? pick(patient.id, 1, [
                `HbA1c has climbed from ${first?.value}% to ${latestHba1c.value}% over ${hba1cSeries.length} readings without settling.`,
                `Glycaemic control has drifted steadily the wrong way, ${first?.value}% up to ${latestHba1c.value}% across ${hba1cSeries.length} readings.`,
                `Each HbA1c since ${first?.recordedOn} has been higher than the last, now ${latestHba1c.value}%.`,
              ])
            : pick(patient.id, 2, [
                `HbA1c ${latestHba1c.value}% sits above the ${TH.hba1cTarget.value}% goal.`,
                `Glycaemic control is off target at ${latestHba1c.value}%.`,
                `Latest HbA1c of ${latestHba1c.value}% has not come down to the ${TH.hba1cTarget.value}% goal.`,
                `Diabetes remains above goal, most recently ${latestHba1c.value}%.`,
                `An HbA1c of ${latestHba1c.value}% on ${latestHba1c.recordedOn} leaves this patient short of target.`,
                `Blood sugar control is running high at ${latestHba1c.value}%.`,
              ]),
          fallbackAction: rising
            ? 'Review glycaemic therapy and what has changed since the trend began.'
            : 'Review glycaemic therapy at the next appointment.',
          triggeringObservationId: latestHba1c.id,
          severityScore: rising ? 430 : 300,
          ...(rising && {
            trend: `HbA1c ${first?.value}% to ${latestHba1c.value}% across ${hba1cSeries.length} readings`,
          }),
        });
      }
    }

    // Monitoring that has fallen due. A never-recorded test is a documentation
    // gap for Agent 4, not a clinical risk — this covers results that have gone
    // stale, where the clinical picture is genuinely unknown.
    for (const m of assessMonitoring(patient, observations, asOf)) {
      if (m.overdue && m.latest && m.requirement.type === 'hba1c') {
        findings.push({
          flagType: 'hba1c_overdue',
          urgency: 'watch',
          confidence: 'high',
          referenceIds: [m.requirement.referenceId],
          facts: [
            `last HbA1c ${m.latest.value}% was ${m.daysSince} days ago`,
            `interval for this patient is ${m.requirement.intervalDays} days`,
          ],
          fallbackReasoning: `HbA1c was last checked ${m.daysSince} days ago, beyond the ${m.requirement.intervalDays} day interval for a patient above goal.`,
          fallbackAction: 'Arrange HbA1c.',
          triggeringObservationId: m.latest.id,
          severityScore: 350,
        });
      }
    }

    const egfr = latestOf(observations, 'egfr');
    if (egfr && Number(egfr.value) < TH.egfrReduced.value) {
      const series = observations
        .filter((o) => o.type === 'egfr')
        .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn));
      const firstEgfr = series[0];
      const declining =
        series.length >= 3 && firstEgfr !== undefined && Number(egfr.value) < Number(firstEgfr.value);

      findings.push({
        flagType: 'reduced_kidney_function',
        urgency: 'watch',
        confidence: 'high',
        referenceIds: [TH.egfrReduced.referenceId],
        facts: [
          `eGFR ${egfr.value} mL/min/1.73m² on ${egfr.recordedOn}`,
          declining ? `declining from ${firstEgfr?.value} across ${series.length} readings` : 'single reading below 60',
        ],
        fallbackReasoning: declining
          ? `Kidney function has declined from ${firstEgfr?.value} to ${egfr.value} mL/min/1.73m² across ${series.length} readings.`
          : `eGFR ${egfr.value} mL/min/1.73m² is below the normal range.`,
        fallbackAction: 'Review kidney protection and consider renal referral if declining further.',
        triggeringObservationId: egfr.id,
        severityScore: declining ? 450 : 380,
        ...(declining && { trend: `eGFR ${firstEgfr?.value} to ${egfr.value} across ${series.length} readings` }),
      });
    }

    const acr = latestOf(observations, 'urine_acr');
    if (acr && Number(acr.value) >= TH.acrAbnormal.value) {
      findings.push({
        flagType: 'albuminuria',
        urgency: 'watch',
        confidence: 'high',
        referenceIds: [TH.acrAbnormal.referenceId],
        facts: [`urine ACR ${acr.value} mg/g on ${acr.recordedOn}`],
        fallbackReasoning: `Urine albumin-to-creatinine ratio ${acr.value} mg/g indicates albuminuria.`,
        fallbackAction: 'Confirm kidney protection therapy is in place.',
        triggeringObservationId: acr.id,
        severityScore: 340,
      });
    }
  }

  /* ---------------------------------------------------------------- dengue -- */

  if (hasActiveDengue(patient)) {
    const platelets = observations
      .filter((o) => o.type === 'platelet_count')
      .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn));
    const haematocrit = observations
      .filter((o) => o.type === 'haematocrit')
      .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn));

    const latestPlatelet = platelets[platelets.length - 1];
    const previousPlatelet = platelets[platelets.length - 2];
    const latestHct = haematocrit[haematocrit.length - 1];
    const previousHct = haematocrit[haematocrit.length - 2];

    const plateletsFalling =
      latestPlatelet !== undefined &&
      previousPlatelet !== undefined &&
      Number(latestPlatelet.value) < Number(previousPlatelet.value);
    const haematocritRising =
      latestHct !== undefined &&
      previousHct !== undefined &&
      Number(latestHct.value) > Number(previousHct.value);

    // Section 4 of the reference file: a low platelet count alone is not a
    // warning sign. It counts when falling alongside a rising haematocrit.
    const narrativeWarningSigns = encounters[0]
      ? /\b(persistent vomiting|abdominal pain|abdominal tenderness|bleeding|lethargy|restless)\b/i.test(
          `${encounters[0].structured.subjective} ${encounters[0].structured.objective}`,
        )
      : false;

    if (plateletsFalling && haematocritRising && narrativeWarningSigns) {
      findings.push({
        flagType: 'dengue_warning_signs',
        urgency: 'critical',
        confidence: 'high',
        referenceIds: [TH.denguePlateletLow.referenceId, 'DENGUE-WARNING-SIGNS'],
        facts: [
          `platelet count fell from ${previousPlatelet?.value} to ${latestPlatelet?.value} ×10⁹/L`,
          `haematocrit rose from ${previousHct?.value}% to ${latestHct?.value}%`,
          'warning signs documented in the most recent encounter',
        ],
        fallbackReasoning: `Dengue with warning signs: platelets have fallen from ${previousPlatelet?.value} to ${latestPlatelet?.value} ×10⁹/L while haematocrit rose from ${previousHct?.value}% to ${latestHct?.value}%.`,
        fallbackAction: 'Assess today for admission and fluid management.',
        triggeringObservationId: latestPlatelet?.id ?? null,
        severityScore: 1000,
        trend: `platelets ${previousPlatelet?.value} to ${latestPlatelet?.value}, haematocrit ${previousHct?.value} to ${latestHct?.value}`,
      });
    } else {
      const onset = encounters[encounters.length - 1];
      const dayOfIllness = onset ? daysBetween(onset.date, asOf) : null;
      if (
        dayOfIllness !== null &&
        dayOfIllness >= TH.dengueCriticalWindowStart.value &&
        dayOfIllness <= TH.dengueCriticalWindowEnd.value
      ) {
        findings.push({
          flagType: 'dengue_critical_window',
          urgency: 'watch',
          confidence: 'high',
          referenceIds: [TH.dengueCriticalWindowStart.referenceId],
          facts: [`day ${dayOfIllness} of illness, inside the critical phase`],
          fallbackReasoning: `Day ${dayOfIllness} of dengue illness falls inside the critical phase when deterioration typically occurs.`,
          fallbackAction: 'Review for warning signs within 24 hours.',
          severityScore: 420,
        });
      }
    }
  }

  /* --------------------------------------------------------- sickle cell -- */

  if (hasSickleCell(patient)) {
    const temperature = latestOf(observations, 'temperature');
    if (temperature && Number(temperature.value) >= TH.scdFeverCelsius.value) {
      findings.push({
        flagType: 'sickle_cell_fever',
        urgency: 'critical',
        confidence: 'high',
        referenceIds: [TH.scdFeverCelsius.referenceId],
        facts: [`temperature ${temperature.value} °C on ${temperature.recordedOn}`],
        fallbackReasoning: `Temperature ${temperature.value} °C in sickle cell disease is a medical emergency because of the risk of serious infection.`,
        fallbackAction: 'Assess today for infection.',
        triggeringObservationId: temperature.id,
        severityScore: 1000,
      });
    }

    const yearAgo = new Date(asOf.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
    const priorYearStart = new Date(asOf.getTime() - 730 * 86_400_000).toISOString().slice(0, 10);
    // An encounter counts as a crisis only when that is what it was assessed as.
    // Matching any mention of the word also catches a routine review that
    // refers back to an earlier crisis, which over-counts.
    const crisisEncounters = encounters.filter((e) =>
      /vaso-occlusive crisis|painful crisis/i.test(e.structured.assessment),
    );
    const recentCrises = crisisEncounters.filter((e) => e.date >= yearAgo).length;
    const previousCrises = crisisEncounters.filter(
      (e) => e.date >= priorYearStart && e.date < yearAgo,
    ).length;

    if (recentCrises >= TH.scdHydroxyureaCrises.value) {
      findings.push({
        flagType: 'sickle_cell_crisis_frequency',
        urgency: 'watch',
        confidence: 'high',
        referenceIds: [TH.scdHydroxyureaCrises.referenceId, 'SCD-CRISIS-PATTERN'],
        facts: [
          `${recentCrises} painful crises in the last 12 months`,
          previousCrises > 0 ? `${previousCrises} in the 12 months before that` : 'none recorded in the preceding year',
        ],
        fallbackReasoning:
          recentCrises > previousCrises
            ? `Painful crises have risen to ${recentCrises} in the last 12 months from ${previousCrises} the year before.`
            : `${recentCrises} painful crises in the last 12 months.`,
        fallbackAction: 'Discuss hydroxyurea.',
        severityScore: 460,
        ...(recentCrises > previousCrises && {
          trend: `${previousCrises} crises to ${recentCrises} year on year`,
        }),
      });
    }
  }

  /* ----------------------------------------------------- overdue follow-up -- */

  const days = evidence.daysSinceLastEncounter;
  if (days !== null) {
    // "At target" means nothing above has fired, so the shorter interval only
    // applies to patients with an active concern.
    const atTarget = findings.length === 0;
    const interval = followUpIntervalDays(patient, atTarget);
    if (days > interval.days) {
      findings.push({
        flagType: 'overdue_followup',
        urgency: 'watch',
        confidence: 'high',
        referenceIds: [interval.referenceId],
        facts: [
          `last seen ${days} days ago`,
          `expected interval ${interval.days} days`,
        ],
        fallbackReasoning: pick(patient.id, 5, [
          `Last seen ${days} days ago, well beyond the ${interval.days} day review interval.`,
          `No contact for ${days} days, against an expected ${interval.days} day interval.`,
          `${days} days have passed since the last visit, and review was due at ${interval.days}.`,
        ]),
        fallbackAction: 'Invite for review.',
        severityScore: 250 + Math.min(Math.floor((days - interval.days) / 30), 10) * 10,
      });
    }
  }

  /* ------------------------------------------- outside the encoded logic -- */

  // Section 12: outside the encoded logic the correct output is a lower
  // confidence flag stating the assessment is uncertain — never an invented
  // threshold. This only fires when there is something active to be uncertain
  // about, so a well patient with an unencoded condition is not flagged.
  if (isOutsideEncodedLogic(patient) && hasUnresolvedInvestigation(evidence, asOf) && findings.length === 0) {
    const latest = encounters[0];
    findings.push({
      flagType: 'uncertain_outside_encoded_logic',
      urgency: 'stable',
      confidence: 'uncertain',
      referenceIds: [],
      facts: [
        `conditions on the problem list: ${patient.conditions.map((c) => c.name).join(', ')}`,
        'no encoded clinical rule covers these conditions',
        latest ? `investigation requested on ${latest.date} with no result recorded since` : '',
      ].filter(Boolean),
      fallbackReasoning: `An investigation requested at the last visit has no recorded result, and this system has no encoded rules for ${patient.conditions.map((c) => c.name).join(' or ').toLowerCase()}, so this assessment is uncertain.`,
      fallbackAction: 'Clinician review — this falls outside what the system can assess.',
      triggeringEncounterId: latest?.id ?? null,
      severityScore: 120,
    });
  }

  return findings;
}

/**
 * A3-7: repeated runs over unchanged data produce stable rankings.
 * Ranking is severity, trend, and time since last contact — not severity alone
 * — and ties break on patient id so ordering never shuffles.
 */
export function rankScore(findings: Finding[], daysSinceLastEncounter: number | null): number {
  if (findings.length === 0) return 0;

  const severity = Math.max(...findings.map((f) => f.severityScore));
  const trendBonus = findings.some((f) => f.trend) ? 40 : 0;
  const breadthBonus = Math.min(findings.length - 1, 3) * 12;
  // Time since contact matters, but never outranks severity.
  const timeBonus = daysSinceLastEncounter === null ? 0 : Math.min(Math.floor(daysSinceLastEncounter / 30), 12) * 8;

  return severity + trendBonus + breadthBonus + timeBonus;
}

export function urgencyOf(findings: Finding[]): FlagUrgency {
  if (findings.some((f) => f.urgency === 'critical')) return 'critical';
  if (findings.some((f) => f.urgency === 'watch')) return 'watch';
  return 'stable';
}

export { isOutsideEncodedLogic };
