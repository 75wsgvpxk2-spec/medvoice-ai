import { id, now } from '../db/index.ts';
import { patients, alerts, orders, billing, flags, encounters } from '../db/repositories.ts';
import { assessPatientRun, rerankQueue } from './clinical-intelligence.ts';
import type { BillingEntry, Order, PatientStatus, RiskFlag } from '../../../shared/types.ts';

/**
 * The one-tap resolution of Section 7, step 7 and Section 8.6.
 *
 * One tap creates the order, creates the billing entry, closes the alert,
 * re-assesses the patient, and updates the status — and every one of those five
 * outcomes is returned so the interface can show each of them rather than a
 * success toast (OB-1 to OB-5).
 */

export interface ResolutionOutcome {
  alertId: string;
  patientId: string;
  /** OB-1: the order this tap created, if the resolution defines one. */
  order: Order | null;
  /** OB-2: the billing entry, linked to the order where there is one. */
  billingEntry: BillingEntry | null;
  /** A condition added to the problem list, if the resolution defines one. */
  conditionAdded: string | null;
  /** An amendment opened, if the gap was missing narrative. */
  amendmentEncounterId: string | null;
  /** OB-3: the alert, now closed. */
  alertClosed: boolean;
  /** OB-4: the patient after re-assessment. */
  statusBefore: PatientStatus;
  statusAfter: PatientStatus;
  activeFlagsAfter: RiskFlag[];
  /** Flags this action addressed, now resolved rather than left active. */
  flagsResolved: string[];
}

/**
 * Which risk flags an order settles. Ordering the overdue test is the action
 * that answers the concern the flag raised, so the flag resolves with it.
 */
const ORDER_RESOLVES_FLAGS: Record<string, string[]> = {
  'result:hba1c': ['hba1c_overdue'],
  'result:egfr': ['reduced_kidney_function'],
  'result:urine_acr': ['albuminuria'],
};

export function previewResolution(alertId: string): {
  alertId: string;
  description: string;
  willCreateOrder: string | null;
  willCreateBilling: string | null;
  willAddCondition: string | null;
  willOpenAmendment: string | null;
} | null {
  const alert = alerts.byId(alertId);
  if (!alert) return null;

  // Section 8.6: tapping an alert shows exactly what the resolution will do
  // before it does it.
  return {
    alertId,
    description: alert.resolution.description,
    willCreateOrder: alert.resolution.createsOrder
      ? `${alert.resolution.createsOrder.orderType}: ${alert.resolution.createsOrder.what}`
      : null,
    willCreateBilling: alert.resolution.createsBillingEntry
      ? `${alert.resolution.createsBillingEntry.code} — ${alert.resolution.createsBillingEntry.description}`
      : alert.resolution.createsOrder
        ? 'a billing entry linked to the new order'
        : null,
    willAddCondition: alert.resolution.addsCondition?.name ?? null,
    willOpenAmendment: alert.resolution.opensAmendment?.encounterId ?? null,
  };
}

/** Human decision point two. Nothing here happens without the clinician's tap. */
export async function resolveAlert(
  alertId: string,
  clinicianId: string,
  options: { asOf?: Date; correlationId?: string } = {},
): Promise<ResolutionOutcome> {
  const alert = alerts.byId(alertId);
  if (!alert) throw new Error(`Alert ${alertId} not found`);
  if (alert.status === 'resolved') throw new Error('That alert has already been resolved.');

  const patient = patients.byId(alert.patientId);
  if (!patient) throw new Error(`Patient ${alert.patientId} not found`);

  const statusBefore = patient.status;
  const timestamp = now();
  const correlationId = options.correlationId ?? id('corr');

  let order: Order | null = null;
  let billingEntry: BillingEntry | null = null;
  let conditionAdded: string | null = null;

  /* ---------------------------------------------------------------- order -- */

  if (alert.resolution.createsOrder) {
    order = {
      id: id('ord'),
      patientId: alert.patientId,
      encounterId: alert.encounterId,
      orderType: alert.resolution.createsOrder.orderType,
      what: alert.resolution.createsOrder.what,
      status: 'requested',
      orderedBy: clinicianId,
      orderedAt: timestamp,
      completedAt: null,
      fromAlertId: alert.id,
    };
    orders.insert(order);
  }

  /* -------------------------------------------------------------- billing -- */

  // Section 7: one tap creates the order and the billing entry. Where the
  // resolution does not name a code, the entry derives from the order.
  const codeFromResolution = alert.resolution.createsBillingEntry;
  if (codeFromResolution || order) {
    billingEntry = {
      id: id('bill'),
      patientId: alert.patientId,
      encounterId: alert.encounterId,
      code: codeFromResolution?.code ?? 'ORD-LAB',
      description: codeFromResolution?.description ?? `Laboratory order: ${order?.what ?? 'investigation'}`,
      status: 'recorded',
      fromOrderId: order?.id ?? null,
      createdAt: timestamp,
    };
    billing.insert(billingEntry);
  }

  /* ------------------------------------------------------------ diagnosis -- */

  if (alert.resolution.addsCondition) {
    patients.addCondition(alert.patientId, {
      name: alert.resolution.addsCondition.name,
      diagnosedOn: timestamp.slice(0, 10),
    });
    conditionAdded = alert.resolution.addsCondition.name;
  }

  /* ---------------------------------------------------------------- close -- */

  alerts.resolve(alert.id, clinicianId);

  /* --------------------------------------------------- resolve settled flags -- */

  const settles = ORDER_RESOLVES_FLAGS[alert.gapKey] ?? [];
  const flagsResolved: string[] = [];
  for (const flag of flags.activeForPatient(alert.patientId)) {
    if (settles.includes(flag.flagType)) {
      flags.resolve(flag.id);
      flagsResolved.push(flag.flagType);
    }
  }

  /* --------------------------------------------------------- re-assessment -- */

  const assessment = await assessPatientRun(alert.patientId, {
    asOf: options.asOf ?? new Date(),
    trigger: 'alert_resolution',
    correlationId,
    encounterId: alert.encounterId,
  });

  /*
   * Section 4: managed means a risk was identified and a clinician acted on it.
   * That applies once the action has settled everything outstanding. A patient
   * who still has an active flag keeps that flag's urgency, because a managed
   * patient drops out of the urgent positions and a patient with an unaddressed
   * critical finding must not.
   *
   * NOTE: GP-7 expects the status to become managed after any resolution. Where
   * a higher-urgency flag is still active this build keeps that urgency instead.
   * See docs/DEVIATIONS.md.
   */
  let statusAfter = assessment.status;
  if (assessment.flags.length === 0) {
    patients.setStatus(alert.patientId, 'managed', timestamp);
    statusAfter = 'managed';
  }

  // The patient's standing has changed, so the queue order has too.
  rerankQueue(patient.clinicianId);

  return {
    alertId: alert.id,
    patientId: alert.patientId,
    order,
    billingEntry,
    conditionAdded,
    amendmentEncounterId: alert.resolution.opensAmendment?.encounterId ?? null,
    alertClosed: true,
    statusBefore,
    statusAfter,
    activeFlagsAfter: flags.activeForPatient(alert.patientId),
    flagsResolved,
  };
}

/**
 * ST-4: a managed patient whose order completes resolves rather than remaining
 * managed indefinitely.
 */
export async function completeOrder(
  orderId: string,
  options: { asOf?: Date } = {},
): Promise<{ order: Order; statusAfter: PatientStatus }> {
  const existing = orders.byId(orderId);
  if (!existing) throw new Error(`Order ${orderId} not found`);

  orders.complete(orderId);

  const patient = patients.byId(existing.patientId);
  if (!patient) throw new Error(`Patient ${existing.patientId} not found`);

  const assessment = await assessPatientRun(existing.patientId, {
    asOf: options.asOf ?? new Date(),
    trigger: 'alert_resolution',
    correlationId: id('corr'),
  });

  // Everything outstanding is now closed, so the patient returns to stable.
  let statusAfter = assessment.status;
  const outstanding = orders.forPatient(existing.patientId).filter((o) => o.status === 'requested');
  if (assessment.flags.length === 0 && outstanding.length === 0) {
    patients.setStatus(existing.patientId, 'stable', now());
    statusAfter = 'stable';
  }

  return { order: orders.byId(orderId)!, statusAfter };
}

export { encounters };
