import { describe, it, expect, beforeAll } from 'vitest';
import { scanPopulation, scanPatient, detectGaps } from '../server/src/agents/documentation.ts';
import { resolveAlert, previewResolution } from '../server/src/agents/resolution.ts';
import { patients, alerts, billing, orders, encounters, flags } from '../server/src/db/repositories.ts';
import { freshPopulation, patientNamed, CLINICIAN_ID, AS_OF, PROFILE } from './helpers.ts';

/** Section 14.5 — Agent 4, Documentation and Compliance. */

beforeAll(async () => {
  freshPopulation();
  // Deliberately NOT running Agent 3 first. Agent 4 must stand on its own.
  await scanPopulation(CLINICIAN_ID, { asOf: AS_OF });
}, 300_000);

describe('A4-1  Clinically complete, billing codes missing', () => {
  it('raises an alert for the billing gap alone', () => {
    const patient = patientNamed(PROFILE.billingGap);
    const open = alerts.openForPatient(patient.id);

    expect(open.length).toBe(1);
    expect(open[0]!.gapType).toBe('missing_billing_code');
    expect(open[0]!.description.toLowerCase()).toMatch(/billing|code/);
  });

  it('points at the encounter that is actually unbilled', () => {
    const patient = patientNamed(PROFILE.billingGap);
    const alert = alerts.openForPatient(patient.id)[0]!;
    expect(billing.forEncounter(alert.encounterId)).toEqual([]);
  });
});

describe('A4-2 [CRITICAL]  Agent 3 disabled or failing', () => {
  it('still returns alerts with Agent 3 never having run', () => {
    // beforeAll ran only Agent 4. If this suite depended on Agent 3 having
    // populated anything, there would be no alerts at all.
    const total = patients
      .forClinician(CLINICIAN_ID)
      .reduce((n, p) => n + alerts.openForPatient(p.id).length, 0);
    expect(total).toBeGreaterThan(0);

    const noFlagsAnywhere = patients
      .forClinician(CLINICIAN_ID)
      .every((p) => flags.activeForPatient(p.id).length === 0);
    expect(noFlagsAnywhere, 'Agent 3 must not have run for this test to mean anything').toBe(true);
  });

  it('still returns alerts when Agent 3 throws', async () => {
    const patient = patientNamed(PROFILE.comorbidity);

    // Simulate Agent 3 failing outright during the same trigger.
    const agent3 = Promise.reject(new Error('Clinical Intelligence unavailable'));
    const agent4 = scanPatient(patient, { asOf: AS_OF });

    const [clinical, documentation] = await Promise.allSettled([agent3, agent4]);

    expect(clinical.status).toBe('rejected');
    expect(documentation.status).toBe('fulfilled');
    if (documentation.status === 'fulfilled') {
      // Already raised in beforeAll, so these come back as already-open rather
      // than duplicated — the point is that the scan completed regardless.
      expect(documentation.value.raised.length + documentation.value.alreadyOpen).toBeGreaterThan(0);
    }
  });
});

describe('A4-3  Fully documented patient', () => {
  it('raises no alerts and does not manufacture gaps', () => {
    const patient = patientNamed(PROFILE.stableDocumented);
    const open = alerts.openForPatient(patient.id);
    expect(open.map((a) => `${a.gapType}: ${a.description}`)).toEqual([]);
  });

  it('raises no alerts on the well controlled hypertensive', () => {
    const patient = patientNamed(PROFILE.wellControlled);
    expect(alerts.openForPatient(patient.id)).toEqual([]);
  });

  it('leaves most of the population without alerts', () => {
    const population = patients.forClinician(CLINICIAN_ID);
    const withAlerts = population.filter((p) => alerts.openForPatient(p.id).length > 0);
    expect(withAlerts.length).toBeLessThan(population.length / 2);
  });
});

describe('A4-4  Same gap across two consecutive encounters', () => {
  it('is not duplicated into two identical alerts', async () => {
    const patient = patientNamed(PROFILE.comorbidity);
    const before = alerts.openForPatient(patient.id).length;

    // Scanning again finds the same gaps; none should be raised a second time.
    const second = await scanPatient(patient, { asOf: AS_OF });
    expect(second.raised).toEqual([]);
    expect(second.alreadyOpen).toBeGreaterThan(0);

    const after = alerts.openForPatient(patient.id).length;
    expect(after).toBe(before);
  });

  it('holds no duplicate gap keys anywhere in the population', () => {
    for (const p of patients.forClinician(CLINICIAN_ID)) {
      const keys = alerts.allForPatient(p.id).map((a) => a.gapKey);
      expect(new Set(keys).size, `${p.name} has duplicate gap keys`).toBe(keys.length);
    }
  });
});

describe('A4-5  Every alert generated', () => {
  it('has a resolution action that does something', () => {
    for (const p of patients.forClinician(CLINICIAN_ID)) {
      for (const a of alerts.openForPatient(p.id)) {
        const r = a.resolution;
        const doesSomething =
          Boolean(r.createsOrder) ||
          Boolean(r.createsBillingEntry) ||
          Boolean(r.addsCondition) ||
          Boolean(r.opensAmendment);
        expect(doesSomething, `${p.name} / ${a.gapKey} offers a fix that does nothing`).toBe(true);
        expect(r.description.trim().length).toBeGreaterThan(10);
      }
    }
  });

  it('describes accurately what the tap will do', () => {
    for (const p of patients.forClinician(CLINICIAN_ID)) {
      for (const a of alerts.openForPatient(p.id)) {
        const preview = previewResolution(a.id)!;
        if (a.resolution.createsOrder) expect(preview.willCreateOrder).not.toBeNull();
        if (a.resolution.addsCondition) expect(preview.willAddCondition).toBe(a.resolution.addsCondition.name);
        if (a.resolution.createsBillingEntry) expect(preview.willCreateBilling).toContain(a.resolution.createsBillingEntry.code);
        expect(preview.description).toBe(a.resolution.description);
      }
    }
  });

  it('generates each gap type the detector supports', () => {
    const found = new Set(
      patients.forClinician(CLINICIAN_ID).flatMap((p) => alerts.openForPatient(p.id).map((a) => a.gapType)),
    );
    // The seeded population exercises these three; incomplete_note requires an
    // encounter approved with a flagged field, which the golden path produces.
    expect(found).toContain('missing_billing_code');
    expect(found).toContain('missing_result');
    expect(found).toContain('missing_diagnosis');
  });
});

describe('OB-1 to OB-5  One-tap resolution', () => {
  it('creates an order, a linked billing entry, closes the alert and re-assesses', async () => {
    const patient = patientNamed(PROFILE.comorbidity);
    const alert = alerts.openForPatient(patient.id).find((a) => a.resolution.createsOrder);
    expect(alert, 'expected an alert whose resolution creates an order').toBeDefined();

    const ordersBefore = orders.forPatient(patient.id).length;
    const outcome = await resolveAlert(alert!.id, CLINICIAN_ID, { asOf: AS_OF });

    // OB-1: an order record exists afterwards, verified at the data layer.
    expect(outcome.order).not.toBeNull();
    const ordersAfter = orders.forPatient(patient.id);
    expect(ordersAfter.length).toBe(ordersBefore + 1);
    expect(ordersAfter.some((o) => o.id === outcome.order!.id)).toBe(true);
    expect(outcome.order!.fromAlertId).toBe(alert!.id);

    // OB-2: a billing entry exists, linked to the order.
    expect(outcome.billingEntry).not.toBeNull();
    expect(outcome.billingEntry!.fromOrderId).toBe(outcome.order!.id);
    const persisted = billing.forPatient(patient.id).find((b) => b.id === outcome.billingEntry!.id);
    expect(persisted).toBeDefined();

    // OB-3: the alert is closed.
    expect(alerts.byId(alert!.id)!.status).toBe('resolved');
    expect(alerts.openForPatient(patient.id).some((a) => a.id === alert!.id)).toBe(false);

    // OB-4: the patient was re-assessed.
    expect(patients.byId(patient.id)!.lastAssessedAt).not.toBeNull();
  });

  it('OB-3  the resolved alert does not reappear on the next scan', async () => {
    const patient = patientNamed(PROFILE.comorbidity);
    const resolved = alerts.allForPatient(patient.id).filter((a) => a.status === 'resolved');
    expect(resolved.length).toBeGreaterThan(0);

    await scanPatient(patient, { asOf: AS_OF });
    const reopened = alerts
      .allForPatient(patient.id)
      .filter((a) => a.status === 'open' && resolved.some((r) => r.gapKey === a.gapKey));
    expect(reopened).toEqual([]);
  });

  it('OB-5  the order appears in the patient record with its status', () => {
    const patient = patientNamed(PROFILE.comorbidity);
    const record = orders.forPatient(patient.id);
    expect(record.length).toBeGreaterThan(0);
    expect(record[0]!.status).toBe('requested');
    expect(record[0]!.orderedBy).toBe(CLINICIAN_ID);
    expect(record[0]!.orderedAt).not.toBeNull();
  });

  it('adds a condition to the problem list when that is the resolution', async () => {
    const patient = patientNamed(PROFILE.dengue) ?? null;
    // The missing-diagnosis case in the seed is the diabetic with unlisted
    // hypertension named in the assessment.
    const target = patients
      .forClinician(CLINICIAN_ID)
      .find((p) => alerts.openForPatient(p.id).some((a) => a.resolution.addsCondition));
    expect(target, 'expected a missing-diagnosis alert somewhere in the population').toBeDefined();

    const alert = alerts.openForPatient(target!.id).find((a) => a.resolution.addsCondition)!;
    const conditionName = alert.resolution.addsCondition!.name;
    expect(target!.conditions.some((c) => c.name === conditionName)).toBe(false);

    const outcome = await resolveAlert(alert.id, CLINICIAN_ID, { asOf: AS_OF });
    expect(outcome.conditionAdded).toBe(conditionName);

    const updated = patients.byId(target!.id)!;
    expect(updated.conditions.some((c) => c.name === conditionName)).toBe(true);
    void patient;
  });
});

describe('ST-1 and ST-3  managed is distinct from stable', () => {
  it('a patient whose findings are all settled becomes managed, not stable', async () => {
    // Yvette has one billing gap and no clinical findings, so resolving it
    // leaves nothing outstanding.
    const patient = patientNamed(PROFILE.billingGap);
    const alert = alerts.openForPatient(patient.id)[0]!;

    const outcome = await resolveAlert(alert.id, CLINICIAN_ID, { asOf: AS_OF });
    expect(outcome.activeFlagsAfter).toEqual([]);
    expect(outcome.statusAfter).toBe('managed');
    expect(patients.byId(patient.id)!.status).toBe('managed');
  });
});

describe('Gap detection is independent of stored state', () => {
  it('detectGaps is a pure read over the record', () => {
    const patient = patientNamed(PROFILE.stableDocumented);
    const first = detectGaps(patient, AS_OF);
    const second = detectGaps(patient, AS_OF);
    expect(second.map((g) => g.gapKey)).toEqual(first.map((g) => g.gapKey));
  });

  it('finds nothing on a patient with no encounters', () => {
    const patient = patientNamed(PROFILE.noHistory);
    expect(encounters.approvedForPatient(patient.id)).toEqual([]);
    expect(detectGaps(patient, AS_OF)).toEqual([]);
  });
});
