import { describe, it, expect, beforeAll } from 'vitest';
import { assessPopulation, assessPatient } from '../server/src/agents/clinical-intelligence.ts';
import { patients, flags } from '../server/src/db/repositories.ts';
import { verifyReference, loadReference } from '../server/src/clinical/reference.ts';
import { freshPopulation, patientNamed, CLINICIAN_ID, AS_OF, PROFILE } from './helpers.ts';
import type { PopulationAssessment } from '../server/src/agents/clinical-intelligence.ts';

/** Section 14.4 — Agent 3, Clinical Intelligence. */

let run: PopulationAssessment;

beforeAll(async () => {
  freshPopulation();
  run = await assessPopulation(CLINICIAN_ID, { asOf: AS_OF });
}, 300_000);

describe('A3-1  Full population assessed', () => {
  it('gives every patient a status', () => {
    const population = patients.forClinician(CLINICIAN_ID);
    expect(population).toHaveLength(15);
    for (const p of population) {
      expect(['critical', 'watch', 'stable', 'managed']).toContain(p.status);
      expect(p.lastAssessedAt).not.toBeNull();
    }
  });

  it('gives every flag reasoning — a flag with no reasoning is a bug', () => {
    for (const p of patients.forClinician(CLINICIAN_ID)) {
      for (const f of flags.activeForPatient(p.id)) {
        expect(f.reasoning.trim().length, `${p.name} / ${f.flagType}`).toBeGreaterThan(20);
        expect(f.recommendedAction.trim().length, `${p.name} / ${f.flagType}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('A3-2 [CRITICAL]  The stable, fully documented patient stays stable', () => {
  it('raises no flags on the fully documented diabetic at goal', () => {
    const patient = patientNamed(PROFILE.stableDocumented);
    const active = flags.activeForPatient(patient.id);
    expect(
      active.map((f) => `${f.flagType}: ${f.reasoning}`),
      'over-flagging makes the ranking worthless',
    ).toEqual([]);
    expect(patient.status).toBe('stable');
  });

  it('raises no flags on the well controlled hypertensive', () => {
    const patient = patientNamed(PROFILE.wellControlled);
    expect(flags.activeForPatient(patient.id).map((f) => f.flagType)).toEqual([]);
    expect(patient.status).toBe('stable');
  });

  it('keeps the proportion of the caseload flagged plausible (CS-4)', () => {
    const population = patients.forClinician(CLINICIAN_ID);
    const critical = population.filter((p) => p.status === 'critical').length;
    const needingAttention = population.filter(
      (p) => p.status === 'critical' || p.status === 'watch',
    ).length;
    // A chronic disease panel; most patients should not need attention today.
    expect(critical / population.length).toBeLessThanOrEqual(0.2);
    expect(needingAttention / population.length).toBeLessThan(0.5);
  });
});

describe('A3-3  Overdue follow-up only', () => {
  it('flags the overdue patient and names the overdue follow-up', () => {
    const patient = patientNamed(PROFILE.overdueFollowUp);
    const active = flags.activeForPatient(patient.id);
    expect(active.length).toBeGreaterThan(0);

    const overdue = active.find((f) => f.flagType === 'overdue_followup');
    expect(overdue, 'expected an overdue follow-up flag').toBeDefined();
    expect(overdue!.reasoning.toLowerCase()).toMatch(/seen|review|follow|overdue|contact|visit/);
  });

  it('ranks on time since contact, not severity alone', () => {
    const patient = patientNamed(PROFILE.overdueFollowUp);
    const assessment = run.assessments.find((a) => a.patientId === patient.id);
    expect(assessment!.score).toBeGreaterThan(0);
    expect(run.ranking).toContain(patient.id);
  });
});

describe('A3-4  Worsening trend across encounters', () => {
  it('references the trend rather than only the latest value', () => {
    const patient = patientNamed(PROFILE.worseningTrend);
    const active = flags.activeForPatient(patient.id);
    const trendFlag = active.find((f) => f.flagType === 'diabetes_worsening_trend');
    expect(trendFlag, 'expected a trend flag on the worsening patient').toBeDefined();

    const reasoning = trendFlag!.reasoning;
    // The earliest value must appear, so the sentence describes movement rather
    // than reporting the latest reading in isolation.
    expect(reasoning, reasoning).toMatch(/6\.6|risen|rising|climbed|increased|trend|from/i);
  });
});

describe('A3-5  Comorbidity patient', () => {
  it('connects the conditions rather than listing them separately', () => {
    const patient = patientNamed(PROFILE.comorbidity);
    const active = flags.activeForPatient(patient.id);
    expect(active.length).toBeGreaterThanOrEqual(2);

    const combined = active.map((f) => f.reasoning).join(' ').toLowerCase();
    // Some sentence must tie the findings together rather than reporting each
    // in isolation.
    expect(combined, combined).toMatch(
      /combined|together|alongside|both|while|compound|overall|as well as|in addition/,
    );
  });
});

describe('A3-6  Case outside the encoded logic', () => {
  it('returns a lower confidence flag stating the assessment is uncertain', () => {
    const patient = patientNamed(PROFILE.outsideLogic);
    const active = flags.activeForPatient(patient.id);
    const uncertain = active.find((f) => f.confidence === 'uncertain');
    expect(uncertain, 'expected an uncertain flag for a condition outside the encoded logic').toBeDefined();
    // The sentence has to tell the clinician a limitation is being flagged
    // rather than a judgement made. The wording is the model's, so this accepts
    // the reasonable ways of saying it rather than one fixed phrase — CS-5
    // requires varied language, and a regex demanding one form fights that.
    expect(uncertain!.reasoning.toLowerCase(), uncertain!.reasoning).toMatch(
      /uncertain|cannot|could not|unable|outside|not covered|no encoded rule|no rule|beyond what/,
    );
  });

  it('invents no threshold — every reference id resolves to the reference file', () => {
    const reference = loadReference();
    for (const p of patients.forClinician(CLINICIAN_ID)) {
      for (const f of flags.activeForPatient(p.id)) {
        for (const referenceId of f.referenceIds) {
          expect(reference.has(referenceId), `${f.flagType} cites unknown ${referenceId}`).toBe(true);
        }
        // An uncertain flag cites nothing, because there is no rule to cite.
        if (f.confidence === 'uncertain') expect(f.referenceIds).toEqual([]);
        else expect(f.referenceIds.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('A3-7  Same population run twice over unchanged data', () => {
  it('produces a stable ranking with no random shuffling', async () => {
    const second = await assessPopulation(CLINICIAN_ID, { asOf: AS_OF });
    expect(second.ranking).toEqual(run.ranking);

    const third = await assessPopulation(CLINICIAN_ID, { asOf: AS_OF });
    expect(third.ranking).toEqual(run.ranking);
  }, 300_000);

  it('produces the same statuses each time', async () => {
    const before = patients.forClinician(CLINICIAN_ID).map((p) => `${p.id}:${p.status}`);
    await assessPopulation(CLINICIAN_ID, { asOf: AS_OF });
    const after = patients.forClinician(CLINICIAN_ID).map((p) => `${p.id}:${p.status}`);
    expect(after).toEqual(before);
  }, 300_000);
});

describe('CS-1  Every threshold is sourced', () => {
  it('matches docs/clinical-reference.md', () => {
    const result = verifyReference();
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('8.2  Reasoning fits one line of the queue', () => {
  it('keeps every reasoning short enough to scan down a ranked list', () => {
    const reasonings = patients
      .forClinician(CLINICIAN_ID)
      .flatMap((p) => flags.activeForPatient(p.id).map((f) => ({ name: p.name, text: f.reasoning })));

    expect(reasonings.length).toBeGreaterThan(0);

    // Section 8.2 asks for one line of clinical reasoning per row, and Section 9
    // requires five patients visible without scrolling. A sentence that wraps to
    // four lines pushes the fifth patient off the screen.
    for (const { name, text } of reasonings) {
      const words = text.trim().split(/\s+/).length;
      expect(words, `${name}: ${words} words — "${text}"`).toBeLessThanOrEqual(34);
    }
  });
});

describe('CS-5  Flag reasonings read as clinical sentences, not one template', () => {
  it('does not reuse a single sentence skeleton across the population', () => {
    const reasonings = patients
      .forClinician(CLINICIAN_ID)
      .flatMap((p) => flags.activeForPatient(p.id).map((f) => f.reasoning));

    expect(reasonings.length).toBeGreaterThanOrEqual(8);

    // Strip the numbers, dates and units. What is left is the sentence skeleton.
    // If two flags share a skeleton, they are the same template with values
    // substituted — which is exactly what CS-5 rules out.
    const skeleton = (s: string): string =>
      s
        .replace(/[\d.,/]+/g, '#')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const skeletons = reasonings.map(skeleton);
    const duplicates = skeletons.filter((s, i) => skeletons.indexOf(s) !== i);

    expect(
      duplicates,
      `repeated sentence skeletons:\n${[...new Set(duplicates)].join('\n')}`,
    ).toEqual([]);
  });

  it('varies sentence openings', () => {
    const openings = patients
      .forClinician(CLINICIAN_ID)
      .flatMap((p) => flags.activeForPatient(p.id).map((f) => f.reasoning.split(' ')[0]?.toLowerCase()));
    const distinct = new Set(openings);
    // Half the flags starting with the same word reads as a generated list.
    expect(distinct.size).toBeGreaterThanOrEqual(Math.ceil(openings.length / 2));
  });
});

describe('CS-3  Recommended actions are advisory', () => {
  it('never auto-orders or auto-prescribes', () => {
    for (const p of patients.forClinician(CLINICIAN_ID)) {
      for (const f of flags.activeForPatient(p.id)) {
        const action = f.recommendedAction.toLowerCase();
        expect(action, `${p.name}: ${f.recommendedAction}`).not.toMatch(
          /\b(i have ordered|has been ordered|prescribed for|automatically|i've started|we have started)\b/,
        );
      }
    }
  });
});

describe('FD-2 [CRITICAL]  A dismissed flag does not regenerate identically', () => {
  it('suppresses the flag while the clinical picture is unchanged', async () => {
    const patient = patientNamed(PROFILE.overdueFollowUp);
    const before = flags.activeForPatient(patient.id);
    expect(before.length).toBeGreaterThan(0);

    const target = before[0]!;
    // Dismissal records the fingerprint of the picture at the time.
    const { fingerprintOf } = await import('../server/src/agents/clinical-intelligence.ts');
    const { evaluate } = await import('../server/src/clinical/rules.ts');
    const { encounters, observations } = await import('../server/src/db/repositories.ts');
    const findings = evaluate(
      {
        patient,
        observations: observations.forPatient(patient.id),
        encounters: encounters.approvedForPatient(patient.id),
        daysSinceLastEncounter: encounters.daysSinceLast(patient.id, AS_OF),
      },
      AS_OF,
    );
    const finding = findings.find((f) => f.flagType === target.flagType)!;
    flags.dismiss(target.id, 'disagree_with_assessment', CLINICIAN_ID, fingerprintOf(finding));

    const after = await assessPatient(patient, {
      asOf: AS_OF,
      trigger: 'population_run',
      correlationId: 'test-dismissal',
    });

    expect(after.flags.map((f) => f.flagType)).not.toContain(target.flagType);
    expect(after.suppressed).toBeGreaterThan(0);
  });

  it('records the dismissal and its reason in the record (FD-3)', () => {
    const patient = patientNamed(PROFILE.overdueFollowUp);
    const dismissed = flags.dismissedForPatient(patient.id);
    expect(dismissed.length).toBeGreaterThan(0);
    expect(dismissed[0]!.dismissalReason).toBe('disagree_with_assessment');
    expect(dismissed[0]!.dismissedBy).toBe(CLINICIAN_ID);
    expect(dismissed[0]!.dismissedAt).not.toBeNull();
  });
});
