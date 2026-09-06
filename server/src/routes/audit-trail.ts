import type { Request, Response, NextFunction } from 'express';
import { audit, clinicians, patients, encounters } from '../db/repositories.ts';

/**
 * Records every state-changing request that succeeds.
 *
 * Written as middleware rather than a call inside each handler on purpose: an
 * audit trail whose completeness depends on remembering to add a line to every
 * new route is one that will be incomplete within a month. Here, a route added
 * tomorrow is covered the moment it is mounted, and the worst case for an
 * undescribed route is a plain summary rather than a missing row.
 *
 * Reads are not recorded. This is a change log, and logging every GET would
 * bury the changes in noise.
 */

type Describer = (context: {
  req: Request;
  body: Record<string, unknown>;
  params: Record<string, string>;
}) => { summary: string; entityType: string; patientId?: string | null; detail?: Record<string, unknown> } | null;

const nameOf = (patientId: string | undefined | null): string =>
  (patientId && patients.byId(patientId)?.name) || 'a patient';

/**
 * Keyed by method and the route's declared path, so an identifier in the URL
 * does not produce a different key for every record.
 */
const DESCRIBERS: Record<string, Describer> = {
  'POST /auth/login': () => ({ summary: 'Signed in.', entityType: 'session' }),
  'POST /auth/logout': () => ({ summary: 'Signed out.', entityType: 'session' }),

  'PUT /clinic': ({ req }) => {
    const changed = Object.keys((req.body ?? {}) as Record<string, unknown>).filter((k) => k !== 'logo');
    const logo = (req.body as Record<string, unknown> | undefined)?.['logo'];
    return {
      summary: `Updated the clinic profile${logo ? ', including the logo' : ''}.`,
      entityType: 'clinic',
      detail: { fields: changed },
    };
  },

  'POST /patients': ({ body }) => {
    const patient = body['patient'] as { id?: string; name?: string } | undefined;
    return {
      summary: `Added ${patient?.name ?? 'a patient'} to the population.`,
      entityType: 'patient',
      patientId: patient?.id ?? null,
    };
  },

  'POST /patients/:id/encounters': ({ params }) => ({
    summary: `Submitted an encounter note for ${nameOf(params['id'])}. Agents 1 and 2 ran; nothing is saved to the record until it is approved.`,
    entityType: 'encounter',
    patientId: params['id'] ?? null,
  }),

  'POST /encounters/:id/approve': ({ params }) => {
    const encounter = encounters.byId(params['id'] ?? '');
    return {
      summary: `Approved the encounter for ${nameOf(encounter?.patientId)}. The note was written to the record and Agents 3 and 4 ran.`,
      entityType: 'encounter',
      patientId: encounter?.patientId ?? null,
    };
  },

  'POST /encounters/:id/amend': ({ params }) => {
    const encounter = encounters.byId(params['id'] ?? '');
    return {
      summary: `Amended the encounter for ${nameOf(encounter?.patientId)}. The earlier version is retained.`,
      entityType: 'encounter',
      patientId: encounter?.patientId ?? null,
    };
  },

  'POST /alerts/:id/resolve': ({ body }) => {
    const outcome = body as { description?: string; patientId?: string };
    return {
      summary: outcome.description
        ? `Resolved a documentation alert — ${outcome.description}`
        : 'Resolved a documentation alert.',
      entityType: 'documentation_alert',
      patientId: outcome.patientId ?? null,
    };
  },

  /*
   * Closed by hand rather than by the system. The route and the clinician's own
   * words go in the summary, not just the detail — the trail is read as a list,
   * and "declined" is precisely the entry a reviewer needs to see without
   * expanding a row.
   */
  /*
   * Operations. Money moving through a clinic needs the same trail the clinical
   * record has — arguably more, since a financial entry has no second copy in
   * anybody's memory of the consultation.
   */
  'POST /products': ({ body }) => {
    const p = (body as { product?: { name?: string; kind?: string; sku?: string } }).product;
    return {
      summary: `Added ${p?.name ?? 'a product'} to the catalogue${p?.sku ? ` (${p.sku})` : ''}.`,
      entityType: 'product',
    };
  },

  'PUT /products/:id': ({ req, body }) => {
    const p = (body as { product?: { name?: string; archived?: boolean } }).product;
    const archived = (req.body as Record<string, unknown>)?.['archived'];
    return {
      summary:
        archived === true
          ? `Archived ${p?.name ?? 'a product'}.`
          : `Updated ${p?.name ?? 'a product'}.`,
      entityType: 'product',
    };
  },

  'POST /invoices': ({ body }) => {
    const i = (body as { invoice?: { number?: string; contactName?: string; amountCents?: number } }).invoice;
    return {
      summary:
        `Raised invoice ${i?.number ?? ''} for ${i?.contactName ?? 'a contact'}` +
        `${typeof i?.amountCents === 'number' ? ` — ${(i.amountCents / 100).toFixed(2)}` : ''}.`,
      entityType: 'invoice',
      detail: { number: i?.number, amountCents: i?.amountCents },
    };
  },

  'PUT /invoices/:id/status': ({ body }) => {
    const i = (body as { invoice?: { number?: string; status?: string; amountCents?: number } }).invoice;
    return {
      // The status is the whole point of the entry, so it goes in the summary
      // rather than the detail — an auditor scanning the list wants to see
      // "marked paid" without expanding anything.
      summary: `Invoice ${i?.number ?? ''} marked ${i?.status ?? 'changed'}.`,
      entityType: 'invoice',
      detail: { number: i?.number, status: i?.status, amountCents: i?.amountCents },
    };
  },

  'POST /expenses': ({ body }) => {
    const e = (body as { expense?: { description?: string; amountCents?: number; category?: string } }).expense;
    return {
      summary:
        `Recorded an expense — ${e?.description ?? 'unnamed'}` +
        `${typeof e?.amountCents === 'number' ? ` (${(e.amountCents / 100).toFixed(2)})` : ''}.`,
      entityType: 'expense',
      detail: { category: e?.category, amountCents: e?.amountCents },
    };
  },

  'POST /alerts/:id/close': ({ req, body }) => {
    const raw = req.body as Record<string, unknown>;
    const route = String(raw?.['route'] ?? '');
    const note = String(raw?.['note'] ?? '').trim();
    const outcome = body as { patientId?: string };
    return {
      summary:
        route === 'declined'
          ? `Declined a documentation gap for ${nameOf(outcome.patientId)}${note ? ` — “${note}”` : ''}. Nothing was ordered.`
          : `Closed a documentation gap for ${nameOf(outcome.patientId)} as already done${note ? ` — “${note}”` : ''}. Nothing was ordered.`,
      entityType: 'documentation_alert',
      patientId: outcome.patientId ?? null,
      detail: { route, note },
    };
  },

  'POST /flags/:id/dismiss': ({ req, body }) => {
    const raw = req.body as Record<string, unknown>;
    const reason = String(raw?.['reason'] ?? '').replace(/_/g, ' ');
    const note = String(raw?.['note'] ?? '').trim();
    const flag = (body as { flag?: { patientId?: string; reasoning?: string } }).flag;
    return {
      // The clinician's own words go in the summary, not just the detail: the
      // audit trail is read as a list, and a note nobody sees without expanding
      // a row may as well not have been written.
      summary:
        `Dismissed a risk flag for ${nameOf(flag?.patientId)} as “${reason}”` +
        (note ? ` — “${note}”` : '') +
        '. It stays on the record and returns if the picture changes.',
      entityType: 'risk_flag',
      patientId: flag?.patientId ?? null,
      detail: { reason, note, reasoning: flag?.reasoning },
    };
  },

  'POST /orders/:id/complete': ({ body }) => {
    const order = (body as { order?: { patientId?: string; description?: string } }).order;
    return {
      summary: order?.description
        ? `Marked an order complete — ${order.description}`
        : 'Marked an order complete.',
      entityType: 'order',
      patientId: order?.patientId ?? null,
    };
  },

  'POST /population-run': ({ body }) => {
    const result = body as { assessed?: number; failures?: unknown[] };
    return {
      summary: `Ran a population assessment across ${result.assessed ?? 0} patients${
        result.failures?.length ? `, with ${result.failures.length} agent failing` : ''
      }.`,
      entityType: 'population_run',
      detail: { assessed: result.assessed, failures: result.failures?.length ?? 0 },
    };
  },
};

/** Routes that write their own, richer audit rows. Skipped to avoid duplicates. */
const SELF_RECORDING = new Set([
  'PUT /settings',
  'POST /pronunciations',
  'DELETE /pronunciations/:id',
  'PUT /thresholds/:name',
  'DELETE /thresholds/:name',
  'POST /auth/signup',
  'POST /installation/go-live',
  'POST /users',
  'POST /users/:id/active',
  'PUT /users/:id/role',
  'POST /users/:id/reset-password',
  'POST /auth/password',
  // Whether a turn belongs in the trail depends on mode and whether a patient
  // was actually in scope — Research mode must produce zero rows.
  'POST /assistant/chat',
]);

export function auditTrail(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = (payload: unknown) => {
    // Only successful changes are recorded. A rejected request changed nothing,
    // and a failed login must not leave a row implying somebody got in.
    if (res.statusCode >= 400) return originalJson(payload);

    // req.route is only populated once a handler has matched, which is why the
    // key is read here rather than at the top of the middleware.
    const path = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const key = `${req.method} ${path}`;
    if (SELF_RECORDING.has(key)) return originalJson(payload);

    const body = (payload ?? {}) as Record<string, unknown>;
    const params = (req.params ?? {}) as Record<string, string>;
    const clinicianId = (req as { clinicianId?: string }).clinicianId ?? null;

    let described: ReturnType<Describer> = null;
    try {
      described = DESCRIBERS[key]?.({ req, body, params }) ?? null;
    } catch (error) {
      console.error('AUDIT DESCRIBE FAILED', key, error);
    }

    // An unmapped route still gets a row: a change nobody described is exactly
    // the kind the trail needs to show.
    const summary = described?.summary ?? `${req.method} ${path} completed.`;
    const entityType = described?.entityType ?? 'unknown';

    // Sign-in has no session yet, so the actor comes from the response instead
    // of the request — the email typed into the form is not proof of identity.
    const signedIn = (body['clinician'] as { id?: string; name?: string } | undefined) ?? null;
    const actorId = clinicianId ?? signedIn?.id ?? 'anonymous';
    const actorName =
      signedIn?.name ??
      (clinicianId ? clinicians.byId(clinicianId)?.name ?? 'Unknown clinician' : 'Anonymous');

    audit.record({
      actor: actorId,
      actorName,
      action: actionFor(key),
      entityType,
      entityId: params['id'] ?? null,
      patientId: described?.patientId ?? params['id'] ?? null,
      summary,
      detail: described?.detail ?? {},
    });

    return originalJson(payload);
  };

  next();
}

/** noun.verb, derived from the route so filters stay stable as paths change. */
function actionFor(key: string): string {
  const map: Record<string, string> = {
    'POST /auth/login': 'auth.signed_in',
    'POST /auth/logout': 'auth.signed_out',
    'PUT /clinic': 'clinic.updated',
    'POST /patients': 'patient.created',
    'POST /patients/:id/encounters': 'encounter.submitted',
    'POST /encounters/:id/approve': 'encounter.approved',
    'POST /encounters/:id/amend': 'encounter.amended',
    'POST /alerts/:id/resolve': 'alert.resolved',
    'POST /alerts/:id/close': 'alert.closed',
    'POST /products': 'product.created',
    'PUT /products/:id': 'product.updated',
    'POST /invoices': 'invoice.created',
    'PUT /invoices/:id/status': 'invoice.status',
    'POST /expenses': 'expense.created',
    'POST /flags/:id/dismiss': 'flag.dismissed',
    'POST /orders/:id/complete': 'order.completed',
    'POST /population-run': 'population.assessed',
  };
  return map[key] ?? 'other.changed';
}
