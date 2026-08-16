import express, { type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { config } from '../lib/config.ts';
import {
  hashPassword,
  isExpired,
  isIdle,
  makeSessionToken,
  readSessionToken,
  refreshSessionToken,
  verifyPassword,
} from '../lib/auth.ts';
import {
  clinicians,
  clinic,
  patients,
  encounters,
  observations,
  flags,
  alerts,
  orders,
  billing,
  runs,
  populationRuns,
  ageFrom,
  audit,
  pronunciations,
  wipeClinicalData,
} from '../db/repositories.ts';
import { seed as seedDemoPopulation } from '../db/seed.ts';
import * as runtime from '../lib/settings.ts';
import * as thresholds from '../lib/thresholds.ts';
import * as installation from '../lib/installation.ts';
import { describeThresholds, isThresholdName } from '../lib/thresholds.ts';
import { TH, verifyReference } from '../clinical/reference.ts';
import { auditTrail } from './audit-trail.ts';
import { submitEncounter, approveEncounter, runPopulation, amendEncounter } from '../orchestration/triggers.ts';
import { resolveAlert, previewResolution, completeOrder } from '../agents/resolution.ts';
import { assessPatientRun, fingerprintOf, rerankQueue } from '../agents/clinical-intelligence.ts';
import { evaluate } from '../clinical/rules.ts';
import { toFhirBundle, toMarkdown } from '../clinical/report.ts';
import { assessMonitoring } from '../clinical/monitoring.ts';
import { subscribe } from '../orchestration/events.ts';
import { summariseSpend } from '../model/spend.ts';
import { db, id } from '../db/index.ts';
import type {
  ClinicSettings,
  DismissalReason,
  Patient,
  PatientProfile,
  QueueRow,
  QueueView,
  Sex,
  UnitPreferences,
} from '../../../shared/types.ts';
import { BLOOD_TYPES, DEFAULT_BRAND } from '../../../shared/types.ts';

export const api = express.Router();
api.use(express.json({ limit: '4mb' }));  // headroom for a base64 clinic logo

/**
 * Rate limits.
 *
 * Two tiers, because the risk is not the same. Guessing a password is worth an
 * attacker's time and gets a strict budget; reading the queue is what a busy
 * clinic does all morning and must not be throttled into uselessness.
 *
 * Counted per IP, which on a clinic LAN behind one router means the whole
 * practice shares a budget — hence a limit generous enough for a real morning
 * rather than a textbook one.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Successful sign-ins do not count: a clinic that all arrive at 08:00 should
  // not lock itself out.
  skipSuccessfulRequests: true,
  message: {
    error: 'Too many sign-in attempts. Wait fifteen minutes, or ask your administrator to reset the password.',
  },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down and try again shortly.' },
});

api.use(generalLimiter);
api.use(['/auth/login', '/auth/signup', '/auth/password'], authLimiter);
// Mounted before every route, so no change can be added later that escapes it.
api.use(auditTrail);

/* ------------------------------------------------------------------ auth -- */

interface AuthedRequest extends Request {
  clinicianId?: string;
}

/** Express 5 types a route param as string | string[]; routes here take one. */
function param(req: Request, name: string): string {
  const value = req.params[name as keyof typeof req.params] as string | string[] | undefined;
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** DI-4: every route below this is scoped to the signed-in clinician. */
const ENDED = 'Your session has ended. Sign in again to continue.';

function requireClinician(req: AuthedRequest, res: Response, next: NextFunction): void {
  const claims = readSessionToken(readCookie(req, config.sessionCookieName));
  if (!claims) {
    res.status(401).json({ error: ENDED });
    return;
  }

  // Three separate ways a validly signed token can still be unacceptable: the
  // clinician is gone, the token is past its lifetime, or it was issued before
  // a sign-out. The message is the same for all of them — which one it was is
  // not something an unauthenticated caller should learn.
  const version = clinicians.tokenVersion(claims.clinicianId);
  if (version === null || isExpired(claims, runtime.sessionHours()) || claims.tokenVersion !== version) {
    res.status(401).json({ error: ENDED });
    return;
  }

  // §164.312(a)(2)(iii) — automatic logoff. Distinguished from the absolute
  // expiry above so the message can say which happened; a clinician who
  // stepped out for twenty minutes should not be told their shift ended.
  if (isIdle(claims, runtime.idleMinutes())) {
    res.status(401).json({
      error: 'You were signed out after a period of inactivity. Sign in again to continue.',
    });
    return;
  }

  // Deactivating a user bumps their token version, so this is belt and braces
  // — but an access check that depends on one mechanism is one bug from being
  // no access check at all.
  const clinician = clinicians.byId(claims.clinicianId);
  if (!clinician || !clinician.active) {
    res.status(401).json({ error: 'This account is no longer active. Speak to your administrator.' });
    return;
  }

  req.clinicianId = claims.clinicianId;

  /*
   * Restart the idle clock on activity, but not on every request: the queue
   * polls and the event stream reconnects, and refreshing the cookie on those
   * would mean an unattended screen never goes idle at all. Rewriting it at
   * most once a minute keeps the cost down too.
   */
  if (Date.now() - claims.lastSeenAt > 60_000) {
    res.cookie?.(config.sessionCookieName, refreshSessionToken(claims), {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: runtime.sessionHours() * 60 * 60 * 1000,
    });
  }

  next();
}

/** Admin-only routes. Never infer this from the client. */
function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  const clinician = clinicians.byId(req.clinicianId!);
  if (clinician?.role !== 'admin') {
    res.status(403).json({ error: 'Only an administrator can change staff accounts.' });
    return;
  }
  next();
}

/**
 * A readable temporary password.
 *
 * Given to a colleague verbally or on paper, so it avoids characters that are
 * ambiguous when read aloud or written by hand — no 0/O, no 1/l/I. Long enough
 * that the reduced alphabet costs nothing, and it must be changed at first
 * sign-in anyway.
 */
function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(14);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
/* ----------------------------------------------------------- registration -- */

/**
 * Whether this installation has an account yet. Unauthenticated by necessity —
 * the sign-in screen has to know whether to offer sign-up instead.
 *
 * Says nothing beyond that. Whether an account exists is not sensitive; who it
 * belongs to would be.
 */
api.get('/auth/status', (_req, res) => {
  res.json({ hasAccount: clinicians.count() > 0 });
});

/**
 * Creates the clinic's first and only account, and loads the demo population so
 * there is something to look at.
 *
 * Allowed exactly once. A second call is refused whatever it is given — this is
 * a single-clinician build, so an open sign-up endpoint would be a way to take
 * over an installation rather than a feature.
 */
api.post('/auth/signup', (req, res) => {
  if (clinicians.count() > 0) {
    res.status(409).json({
      error: 'This installation already has an account. Sign in instead.',
    });
    return;
  }

  const body = req.body as {
    clinicName?: string;
    name?: string;
    credentials?: string;
    email?: string;
    password?: string;
  };

  const clinicName = String(body.clinicName ?? '').trim();
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  if (!clinicName) {
    res.status(400).json({ error: 'Enter the name of your clinic.' });
    return;
  }
  if (!name) {
    res.status(400).json({ error: 'Enter your name.' });
    return;
  }
  if (!email.includes('@')) {
    res.status(400).json({ error: 'Enter the email address you will sign in with.' });
    return;
  }
  if (password.length < 10) {
    res.status(400).json({ error: 'Choose a password of at least 10 characters.' });
    return;
  }

  const { hash, salt } = hashPassword(password);
  const clinicianId = id('clin');

  clinicians.insert({
    id: clinicianId,
    name,
    credentials: String(body.credentials ?? '').trim(),
    email,
    passwordHash: hash,
    passwordSalt: salt,
    role: 'admin',
  });

  clinic.save({
    name: clinicName,
    legalName: clinicName,
    registration: '',
    address: '',
    phone: '',
    email,
    website: '',
    logo: null,
    ...DEFAULT_BRAND,
    // Whoever creates the clinic is the doctor it is known by, until changed.
    primaryDoctor: name,
  });

  // Lands in demo mode with the fictional population: an empty system shows a
  // clinician nothing about whether it is worth adopting. Going live wipes it.
  seedDemoPopulation({ clinicianId });
  installation.record('demo');

  const hours = runtime.sessionHours();
  res.cookie?.(config.sessionCookieName, makeSessionToken(clinicianId, 1), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: hours * 60 * 60 * 1000,
  });

  audit.record({
    actor: clinicianId,
    actorName: name,
    action: 'installation.created',
    entityType: 'installation',
    summary: `Created ${clinicName} with the demo population loaded. No real patient records exist yet.`,
  });

  res.json({
    clinician: clinicians.byId(clinicianId),
    installation: { mode: 'demo' },
  });
});

/**
 * Leaves the demo behind and starts real records.
 *
 * Destructive and deliberately so: every fictional patient is deleted. The
 * alternative — letting a clinic keep the demo population and add real patients
 * alongside it — is the exact failure this guards against, because after a week
 * nobody can tell which is which.
 */
api.post('/installation/go-live', requireClinician, (req: AuthedRequest, res) => {
  if (installation.mode() === 'clinic') {
    res.status(409).json({ error: 'This installation is already using real records.' });
    return;
  }

  const { confirm } = req.body as { confirm?: string };
  if (String(confirm ?? '').trim().toUpperCase() !== 'DELETE DEMO DATA') {
    res.status(400).json({
      error: 'Type DELETE DEMO DATA to confirm. Every demo patient will be permanently removed.',
    });
    return;
  }

  const { removed } = wipeClinicalData();
  installation.record('clinic');

  const clinician = clinicians.byId(req.clinicianId!);
  audit.record({
    actor: req.clinicianId!,
    actorName: clinician?.name ?? 'Unknown clinician',
    action: 'installation.went_live',
    entityType: 'installation',
    summary:
      'Switched from the demo to real records. Every demo patient and their history was deleted; ' +
      'the clinic profile, settings and this audit trail were kept.',
    detail: { removed },
  });

  res.json({ mode: 'clinic', removed });
});

/* ---------------------------------------------------------------- health -- */

/**
 * Unauthenticated liveness check, for container orchestration.
 *
 * Deliberately says almost nothing: whether the process is up and whether the
 * clinical reference parsed. Anything more would be describing a clinic's
 * installation to anyone who can reach the port.
 */
api.get('/health', (_req, res) => {
  const reference = verifyReference();
  res.status(reference.ok ? 200 : 503).json({
    status: reference.ok ? 'ok' : 'degraded',
    reference: { ok: reference.ok, checked: reference.checked },
  });
});


api.post('/auth/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  // Errors name what went wrong and are never vague (8.1, UI-7).
  if (!email) {
    res.status(400).json({ error: 'Enter your email address.' });
    return;
  }
  if (!password) {
    res.status(400).json({ error: 'Enter your password.' });
    return;
  }

  const clinician = clinicians.byEmail(String(email).trim().toLowerCase());
  if (!clinician || !verifyPassword(password, clinician.passwordHash, clinician.passwordSalt)) {
    // §164.308(a)(5)(ii)(C) — log-in monitoring. Recorded against the email
    // that was tried, not a clinician, because there may not be one. The same
    // message either way: which half was wrong is not an attacker's business.
    audit.record({
      actor: 'anonymous',
      actorName: String(email).trim().toLowerCase(),
      action: 'auth.failed',
      entityType: 'session',
      summary: `Failed sign-in for ${String(email).trim().toLowerCase()}.`,
    });
    res.status(401).json({ error: 'That email and password do not match an account.' });
    return;
  }

  if (!clinician.active) {
    audit.record({
      actor: clinician.id,
      actorName: clinician.name,
      action: 'auth.failed',
      entityType: 'session',
      summary: `Sign-in refused for ${clinician.name}: the account is deactivated.`,
    });
    res.status(403).json({
      error: 'This account has been deactivated. Speak to your administrator.',
    });
    return;
  }

  clinicians.recordSignIn(clinician.id);

  // The cookie's maxAge and the token's own lifetime are kept in step; the
  // token is the one that is enforced, since a client can ignore the cookie's.
  const hours = runtime.sessionHours();
  res.cookie?.(config.sessionCookieName, makeSessionToken(clinician.id, clinician.tokenVersion), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: hours * 60 * 60 * 1000,
  });
  res.json({
    clinician: clinicians.byId(clinician.id),
    installation: { mode: installation.mode() },
  });
});

api.post('/auth/logout', (req: AuthedRequest, res) => {
  // Clearing the cookie only removes this browser's copy. Bumping the token
  // version is what actually ends the session everywhere it may have been
  // captured — a shared clinic machine is exactly the case this matters for.
  const claims = readSessionToken(readCookie(req, config.sessionCookieName));
  if (claims && clinicians.byId(claims.clinicianId)) {
    clinicians.revokeSessions(claims.clinicianId);
    req.clinicianId = claims.clinicianId;
  }
  res.clearCookie?.(config.sessionCookieName);
  res.json({ ok: true });
});

api.get('/auth/me', requireClinician, (req: AuthedRequest, res) => {
  // The mode rides along with the session: the interface has to label a demo
  // database on every screen, and it learns which it is on the first request.
  res.json({
    clinician: clinicians.byId(req.clinicianId!),
    installation: { mode: installation.mode() },
  });
});

/* ---------------------------------------------------------------- clinic -- */

api.get('/clinic', requireClinician, (_req, res) => {
  res.json({ clinic: clinic.get() });
});

/** Roughly 1.5 MB of base64, which is a generous logo and a poor photograph. */
const MAX_LOGO_CHARS = 2_000_000;

api.put('/clinic', requireClinician, (req, res) => {
  const body = req.body as Partial<Record<string, string | null>>;

  const logo = body['logo'] ?? null;
  if (logo !== null) {
    if (typeof logo !== 'string' || !/^data:image\/(png|jpeg|svg\+xml|webp|gif);base64,/.test(logo)) {
      res.status(400).json({
        error: 'The logo must be a PNG, JPEG, SVG, WebP or GIF image. Choose a different file.',
      });
      return;
    }
    if (logo.length > MAX_LOGO_CHARS) {
      res.status(400).json({ error: 'That image is too large. Use one under about 1.5 MB.' });
      return;
    }
  }

  const text = (key: string): string => String(body[key] ?? '').trim();

  /**
   * Chrome colours only, and only as six-digit hex.
   *
   * Anything else is rejected rather than coerced: these values are written
   * straight into a CSS custom property, so accepting arbitrary text would let
   * a clinic profile inject a style declaration. A bad colour also falls back
   * to the default rather than leaving the interface unreadable.
   */
  const colour = (key: string, fallback: string): string => {
    const value = text(key);
    if (value === '') return fallback;
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
  };

  res.json({
    clinic: clinic.save({
      name: text('name'),
      legalName: text('legalName'),
      registration: text('registration'),
      address: text('address'),
      phone: text('phone'),
      email: text('email'),
      website: text('website'),
      logo,
      brandDark: colour('brandDark', DEFAULT_BRAND.brandDark),
      brandLight: colour('brandLight', DEFAULT_BRAND.brandLight),
      primaryDoctor: text('primaryDoctor'),
    }),
  });
});

/* ----------------------------------------------------------------- queue -- */

function buildQueue(clinicianId: string): QueueView {
  const clinician = clinicians.byId(clinicianId)!;
  const population = patients.forClinic();
  const lastRun = populationRuns.last(clinicianId);

  const rows: QueueRow[] = population.map((patient) => {
    const active = flags.activeForPatient(patient.id);
    // Section 9: the one line of clinical reasoning is the most valuable text
    // on the screen, so the highest-urgency flag's reasoning leads.
    const order = { critical: 0, watch: 1, stable: 2 } as const;
    const lead = [...active].sort((a, b) => order[a.urgency] - order[b.urgency])[0];

    return {
      patient,
      reasoning: lead?.reasoning ?? '',
      daysSinceLastEncounter: encounters.daysSinceLast(patient.id),
      openAlertCount: alerts.openCount(patient.id),
      activeFlagCount: active.length,
      topUrgency: lead?.urgency ?? null,
    };
  });

  // Ranked patients first, in queue order; everyone else by name.
  rows.sort((a, b) => {
    const ap = a.patient.queuePosition;
    const bp = b.patient.queuePosition;
    if (ap !== null && bp !== null) return ap - bp;
    if (ap !== null) return -1;
    if (bp !== null) return 1;
    return a.patient.name.localeCompare(b.patient.name);
  });

  return {
    clinician,
    rows,
    lastPopulationRunAt: lastRun?.completedAt ?? null,
    lastPopulationRunOutcome: lastRun?.outcome ?? null,
    neverRun: lastRun === null,
    attentionCount: rows.filter(
      (r) => r.patient.status === 'critical' || r.patient.status === 'watch',
    ).length,
  };
}

api.get('/queue', requireClinician, (req: AuthedRequest, res) => {
  res.json(buildQueue(req.clinicianId!));
});

api.post('/population-run', requireClinician, async (req: AuthedRequest, res) => {
  try {
    const result = await runPopulation(req.clinicianId!);
    res.json({ ...result, queue: buildQueue(req.clinicianId!) });
  } catch (error) {
    res.status(500).json({
      error: 'The assessment could not be completed. The queue below is the last known result.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

/* ------------------------------------------------------------- dashboard -- */

/**
 * One aggregate rather than a page that fans out into a dozen requests. The
 * figures here are counts of records the agents produced — nothing is computed
 * twice, and nothing is a clinical judgement made in this file.
 */
api.get('/dashboard', requireClinician, (req: AuthedRequest, res) => {
  const clinicianId = req.clinicianId!;
  const population = patients.forClinic();
  const lastRun = populationRuns.last(clinicianId);
  const asOf = new Date();

  const byStatus = { critical: 0, watch: 0, managed: 0, stable: 0 };
  let openAlerts = 0;
  let activeFlags = 0;
  let uncertainFlags = 0;
  let outstandingOrders = 0;
  let neverAssessed = 0;
  let overdueFollowUp = 0;
  let overdueMonitoring = 0;

  const alertsByType: Record<string, number> = {};
  const attention: Array<{
    patientId: string;
    name: string;
    status: string;
    reasoning: string;
    daysSince: number | null;
    openAlerts: number;
  }> = [];

  for (const patient of population) {
    byStatus[patient.status] += 1;
    if (patient.lastAssessedAt === null) neverAssessed += 1;

    const active = flags.activeForPatient(patient.id);
    activeFlags += active.length;
    uncertainFlags += active.filter((f) => f.confidence === 'uncertain').length;
    if (active.some((f) => f.flagType === 'overdue_followup')) overdueFollowUp += 1;

    const open = alerts.openForPatient(patient.id);
    openAlerts += open.length;
    for (const alert of open) {
      alertsByType[alert.gapType] = (alertsByType[alert.gapType] ?? 0) + 1;
    }

    outstandingOrders += orders.forPatient(patient.id).filter((o) => o.status === 'requested').length;

    if (
      assessMonitoring(patient, observations.forPatient(patient.id), asOf).some((m) => m.overdue)
    ) {
      overdueMonitoring += 1;
    }

    if (patient.queuePosition !== null) {
      const order = { critical: 0, watch: 1, stable: 2 } as const;
      const lead = [...active].sort((a, b) => order[a.urgency] - order[b.urgency])[0];
      attention.push({
        patientId: patient.id,
        name: patient.name,
        status: patient.status,
        reasoning: lead?.reasoning ?? '',
        daysSince: encounters.daysSinceLast(patient.id),
        openAlerts: open.length,
      });
    }
  }

  attention.sort(
    (a, b) =>
      (population.find((p) => p.id === a.patientId)?.queuePosition ?? 0) -
      (population.find((p) => p.id === b.patientId)?.queuePosition ?? 0),
  );

  // Agent health over the recent log, so a failing agent is visible here and
  // not only on the activity screen.
  const recent = runs.recent(200);
  const completed = recent.filter((r) => r.outcome !== 'running');
  const failed = completed.filter((r) => r.outcome === 'failure');
  const durations = completed.map((r) => r.durationMs ?? 0).filter((d) => d > 0);

  res.json({
    population: population.length,
    byStatus,
    needingAttention: byStatus.critical + byStatus.watch,
    activeFlags,
    uncertainFlags,
    openAlerts,
    alertsByType,
    outstandingOrders,
    neverAssessed,
    overdueFollowUp,
    overdueMonitoring,
    attention: attention.slice(0, 5),
    lastRun,
    agents: {
      runs: completed.length,
      failed: failed.length,
      medianDurationMs:
        durations.length > 0
          ? durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] ?? 0
          : 0,
    },
    spend: summariseSpend(),
  });
});

/* --------------------------------------------------------------- patient -- */

/**
 * Paged, searched and sorted on the server. Doing this in the client means
 * fetching the whole population to show twenty of them, which is fine at
 * fifteen patients and wrong at five thousand.
 */
const STATUS_RANK: Record<string, number> = { critical: 0, watch: 1, managed: 2, stable: 3 };

api.get('/patients', requireClinician, (req: AuthedRequest, res) => {
  const all = patients.forClinic();

  const search = String(req.query['search'] ?? '').trim().toLowerCase();
  const sort = String(req.query['sort'] ?? 'status');
  const page = Math.max(1, Number(req.query['page'] ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(req.query['pageSize'] ?? 10) || 10));

  const statuses = String(req.query['status'] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s in STATUS_RANK);
  const condition = String(req.query['condition'] ?? '').trim().toLowerCase();
  const neverAssessed = req.query['neverAssessed'] === 'true';

  const bySearch = search
    ? all.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          p.conditions.some((c) => c.name.toLowerCase().includes(search)),
      )
    : all;

  const byStatus = (p: (typeof all)[number]) =>
    statuses.length === 0 || statuses.includes(p.status);
  const byCondition = (p: (typeof all)[number]) =>
    condition === '' || p.conditions.some((c) => c.name.toLowerCase() === condition);
  const byAssessed = (p: (typeof all)[number]) => !neverAssessed || p.lastAssessedAt === null;

  const matched = bySearch.filter((p) => byStatus(p) && byCondition(p) && byAssessed(p));

  /* Facet counts leave out the filter they describe, so the number beside
     "Watch" is how many you would get by clicking it — not how many are
     showing now, which would always read zero for every unselected option. */
  const countStatus = bySearch.filter((p) => byCondition(p) && byAssessed(p));
  const statusFacets: Record<string, number> = { critical: 0, watch: 0, managed: 0, stable: 0 };
  for (const p of countStatus) statusFacets[p.status] = (statusFacets[p.status] ?? 0) + 1;

  const countCondition = bySearch.filter((p) => byStatus(p) && byAssessed(p));
  const conditionCounts = new Map<string, number>();
  for (const p of countCondition) {
    // A patient with the same condition listed twice must still count once.
    for (const name of new Set(p.conditions.map((c) => c.name))) {
      conditionCounts.set(name, (conditionCounts.get(name) ?? 0) + 1);
    }
  }
  const conditionFacets = [...conditionCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const neverAssessedCount = bySearch.filter(
    (p) => byStatus(p) && byCondition(p) && p.lastAssessedAt === null,
  ).length;

  const sorted = [...matched].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'lastSeen') {
      // Never assessed sorts last rather than first, which is what an empty
      // string would do.
      const av = a.lastAssessedAt ?? '';
      const bv = b.lastAssessedAt ?? '';
      if (av === bv) return a.name.localeCompare(b.name);
      if (av === '') return 1;
      if (bv === '') return -1;
      return bv.localeCompare(av);
    }
    return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || a.name.localeCompare(b.name);
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  // A search that shrinks the results below the current page would otherwise
  // show an empty list with no way back.
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  res.json({
    patients: sorted.slice(start, start + pageSize),
    total: sorted.length,
    totalUnfiltered: all.length,
    page: safePage,
    pageSize,
    totalPages,
    facets: {
      status: statusFacets,
      conditions: conditionFacets,
      neverAssessed: neverAssessedCount,
    },
  });
});

/**
 * Trim every field and drop anything the client invented. Administrative detail
 * is free text by nature, so the guarantee here is shape, not content: the
 * record can never carry a key the type does not declare.
 */
function sanitiseProfile(raw: Partial<PatientProfile> | undefined): PatientProfile {
  const text = (v: unknown, max = 200): string => String(v ?? '').trim().slice(0, max);
  return {
    dateOfBirth: text(raw?.dateOfBirth, 10),
    bloodType: text(raw?.bloodType, 3) as PatientProfile['bloodType'],
    phone: text(raw?.phone, 40),
    email: text(raw?.email, 120),
    address: text(raw?.address),
    preferredLanguage: text(raw?.preferredLanguage, 60),
    maritalStatus: text(raw?.maritalStatus, 40),
    occupation: text(raw?.occupation, 80),
    emergencyContact: {
      name: text(raw?.emergencyContact?.name, 120),
      relationship: text(raw?.emergencyContact?.relationship, 60),
      phone: text(raw?.emergencyContact?.phone, 40),
    },
    insurance: {
      provider: text(raw?.insurance?.provider, 120),
      policyNumber: text(raw?.insurance?.policyNumber, 60),
      expiresOn: text(raw?.insurance?.expiresOn, 10),
    },
    notes: text(raw?.notes, 500),
  };
}

/** Add a patient to this clinician's population. */
api.post('/patients', requireClinician, (req: AuthedRequest, res) => {
  const body = req.body as {
    name?: string;
    age?: number;
    sex?: string;
    conditions?: Array<{ name: string; diagnosedOn: string }>;
    medications?: Array<{ name: string; dose: string; frequency: string; startedOn: string }>;
    allergies?: string[];
    profile?: Partial<PatientProfile>;
  };

  // Errors name what is wrong and what to do about it (UI-7).
  const name = body.name?.trim();
  if (!name) {
    res.status(400).json({ error: 'Enter the patient name.' });
    return;
  }

  const profile = sanitiseProfile(body.profile);

  // Date of birth wins when it is given: it is the fact on the record, and an
  // age typed alongside it goes stale on the next birthday.
  let age = Number(body.age);
  if (profile.dateOfBirth) {
    const born = new Date(profile.dateOfBirth);
    if (Number.isNaN(born.getTime()) || born > new Date()) {
      res.status(400).json({ error: 'Enter a date of birth in the past, as YYYY-MM-DD.' });
      return;
    }
    age = ageFrom(profile.dateOfBirth, age);
  }
  if (!Number.isInteger(age) || age < 0 || age > 120) {
    res.status(400).json({
      error: 'Enter a date of birth, or an age between 0 and 120.',
    });
    return;
  }
  if (profile.bloodType && !BLOOD_TYPES.includes(profile.bloodType)) {
    res.status(400).json({ error: 'Choose a blood type from the list, or leave it blank.' });
    return;
  }
  if (body.sex !== 'female' && body.sex !== 'male') {
    res.status(400).json({ error: 'Choose whether the patient is female or male.' });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const conditions = (body.conditions ?? [])
    .filter((c) => c.name?.trim())
    .map((c) => ({ name: c.name.trim(), diagnosedOn: c.diagnosedOn?.trim() || today }));
  const medications = (body.medications ?? [])
    .filter((m) => m.name?.trim())
    .map((m) => ({
      name: m.name.trim(),
      dose: m.dose?.trim() ?? '',
      frequency: m.frequency?.trim() ?? '',
      startedOn: m.startedOn?.trim() || today,
    }));

  const patient: Patient = {
    id: id('pat'),
    name,
    age,
    // Narrowed by the guard above; the union is what the record stores.
    sex: body.sex as Sex,
    conditions,
    medications,
    allergies: (body.allergies ?? []).map((a) => a.trim()).filter(Boolean),
    clinicianId: req.clinicianId!,
    // A new patient has no findings until an agent has looked at them. Stable
    // means no risk was identified; that is only true once something has run.
    status: 'stable' as const,
    queuePosition: null,
    lastAssessedAt: null,
    profile,
  };

  patients.insert(patient);
  res.status(201).json({ patient });
});

api.get('/patients/:id', requireClinician, (req: AuthedRequest, res) => {
  const patient = patients.byId(param(req, 'id'));
  // DI-4: a patient outside this clinician's population is not found.
  if (!patient || patient.clinicianId !== req.clinicianId) {
    res.status(404).json({ error: 'That patient is not in your population.' });
    return;
  }

  res.json({
    patient,
    flags: flags.activeForPatient(patient.id),
    dismissedFlags: flags.dismissedForPatient(patient.id),
    alerts: alerts.openForPatient(patient.id),
    orders: orders.forPatient(patient.id),
    billing: billing.forPatient(patient.id),
    observations: observations.forPatient(patient.id),
    encounters: encounters.forPatient(patient.id),
  });
});

/**
 * A patient summary, in the format the receiving side can use.
 *
 * markdown for a referral or an email, fhir for a system that can import
 * structured data. Both are generated from the same record, so they cannot
 * disagree with each other.
 */
api.get('/patients/:id/report', requireClinician, (req: AuthedRequest, res) => {
  const patient = patients.byId(param(req, 'id'));
  if (!patient || patient.clinicianId !== req.clinicianId) {
    res.status(404).json({ error: 'That patient is not in your population.' });
    return;
  }

  const format = String(req.query['format'] ?? 'markdown');
  const clinician = clinicians.byId(req.clinicianId!);
  const source = {
    patient,
    clinic: clinic.get(),
    clinicianName: clinician?.name ?? 'Unknown clinician',
    encounters: encounters.forPatient(patient.id),
    observations: observations.forPatient(patient.id),
    flags: flags.activeForPatient(patient.id),
    alerts: alerts.openForPatient(patient.id),
    orders: orders.forPatient(patient.id),
  };

  // Exporting a record is a disclosure, so it belongs in the audit trail even
  // though nothing in the database changed.
  audit.record({
    actor: req.clinicianId!,
    actorName: source.clinicianName,
    action: 'report.generated',
    entityType: 'patient',
    entityId: patient.id,
    patientId: patient.id,
    summary: `Generated a ${format} summary for ${patient.name}.`,
    detail: { format },
  });

  if (format === 'fhir') {
    res.json(toFhirBundle(source));
    return;
  }

  res.json({ markdown: toMarkdown(source), patientName: patient.name });
});

/* ------------------------------------------------------------- encounter -- */

api.post('/patients/:id/encounters', requireClinician, async (req: AuthedRequest, res) => {
  const patient = patients.byId(param(req, 'id'));
  if (!patient || patient.clinicianId !== req.clinicianId) {
    res.status(404).json({ error: 'That patient is not in your population.' });
    return;
  }

  const { note } = req.body as { note?: string };
  try {
    const result = await submitEncounter(patient.id, note ?? '', req.clinicianId!);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'The note could not be processed.',
    });
  }
});

api.post('/encounters/:id/approve', requireClinician, async (req: AuthedRequest, res) => {
  const { edits, fieldConfidence } = req.body as {
    edits?: Record<string, string>;
    fieldConfidence?: Array<{ field: string; confidence: 'confident' | 'flagged'; ambiguity?: string }>;
  };

  try {
    const result = await approveEncounter(param(req, 'id'), req.clinicianId!, {
      edits: edits as never,
      fieldConfidence: fieldConfidence as never,
    });
    res.json({ ...result, queue: buildQueue(req.clinicianId!) });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'The encounter could not be approved.',
    });
  }
});

api.post('/encounters/:id/amend', requireClinician, async (req: AuthedRequest, res) => {
  const { edits } = req.body as { edits?: Record<string, string> };
  try {
    const result = await amendEncounter(param(req, 'id'), req.clinicianId!, (edits ?? {}) as never);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'The encounter could not be amended.',
    });
  }
});

/* ------------------------------------------------------- alerts and flags -- */

api.get('/alerts/:id/preview', requireClinician, (req, res) => {
  const preview = previewResolution(param(req, 'id'));
  if (!preview) {
    res.status(404).json({ error: 'That alert no longer exists.' });
    return;
  }
  res.json(preview);
});

api.post('/alerts/:id/resolve', requireClinician, async (req: AuthedRequest, res) => {
  try {
    const outcome = await resolveAlert(param(req, 'id'), req.clinicianId!);
    res.json({ ...outcome, queue: buildQueue(req.clinicianId!) });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'That alert could not be resolved.',
    });
  }
});

const DISMISSAL_REASONS: DismissalReason[] = [
  'not_clinically_relevant',
  'already_addressed',
  'disagree_with_assessment',
];

/** Human decision point three — the only place a clinician tells the system it is wrong. */
/**
 * Every open flag across the population, for the flag management screen.
 *
 * The patient's name and status ride along: a flag read outside a patient
 * record is meaningless without knowing whose it is, and a second request per
 * flag to find out would make the screen slower the more work there is to do.
 */
api.get('/flags', requireClinician, (req: AuthedRequest, res) => {
  const open = flags.activeForClinician(req.clinicianId!);
  const byId = new Map(patients.forClinic().map((p) => [p.id, p]));

  const URGENCY_RANK: Record<string, number> = { critical: 0, watch: 1, stable: 2 };
  const rows = open
    .map((flag) => {
      const patient = byId.get(flag.patientId);
      return {
        flag,
        patientName: patient?.name ?? 'Unknown patient',
        patientStatus: patient?.status ?? 'stable',
        patientAge: patient?.age ?? 0,
        patientSex: patient?.sex ?? 'female',
      };
    })
    .sort(
      (a, b) =>
        (URGENCY_RANK[a.flag.urgency] ?? 9) - (URGENCY_RANK[b.flag.urgency] ?? 9) ||
        b.flag.createdAt.localeCompare(a.flag.createdAt),
    );

  const byUrgency: Record<string, number> = { critical: 0, watch: 0, stable: 0 };
  for (const r of rows) byUrgency[r.flag.urgency] = (byUrgency[r.flag.urgency] ?? 0) + 1;

  res.json({
    flags: rows,
    total: rows.length,
    byUrgency,
    uncertain: rows.filter((r) => r.flag.confidence === 'uncertain').length,
  });
});

api.post('/flags/:id/dismiss', requireClinician, async (req: AuthedRequest, res) => {
  const { reason } = req.body as { reason?: DismissalReason };

  if (!reason || !DISMISSAL_REASONS.includes(reason)) {
    res.status(400).json({
      error: 'Choose a reason for dismissing this flag: not clinically relevant, already addressed, or disagree with the assessment.',
    });
    return;
  }

  const flag = flags.byId(param(req, 'id'));
  if (!flag) {
    res.status(404).json({ error: 'That flag no longer exists.' });
    return;
  }

  const patient = patients.byId(flag.patientId);
  if (!patient || patient.clinicianId !== req.clinicianId) {
    res.status(404).json({ error: 'That patient is not in your population.' });
    return;
  }

  // FD-4: record the clinical picture at dismissal, so the flag returns only
  // when the underlying data moves materially.
  const findings = evaluate(
    {
      patient,
      observations: observations.forPatient(patient.id),
      encounters: encounters.approvedForPatient(patient.id),
      daysSinceLastEncounter: encounters.daysSinceLast(patient.id),
    },
    new Date(),
  );
  const finding = findings.find((f) => f.flagType === flag.flagType);

  flags.dismiss(flag.id, reason, req.clinicianId!, finding ? fingerprintOf(finding) : 'unknown');

  const assessment = await assessPatientRun(patient.id, {
    trigger: 'flag_dismissal',
    correlationId: id('corr'),
  });
  rerankQueue(req.clinicianId!);

  res.json({ dismissed: flag.id, assessment, queue: buildQueue(req.clinicianId!) });
});

api.post('/orders/:id/complete', requireClinician, async (req, res) => {
  try {
    res.json(await completeOrder(param(req, 'id')));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'That order could not be completed.',
    });
  }
});

/* ---------------------------------------------------------- agent activity -- */

api.get('/agent-runs', requireClinician, (req, res) => {
  const agent = req.query['agent'] as string | undefined;

  /**
   * What the AI actually did, in the terms a clinician or an auditor would ask.
   *
   * A run log alone answers "did it work". This answers "what was it, where did
   * it go, and how much of what you are reading came from a model at all" —
   * which for a system that puts model-written sentences in front of clinical
   * decisions is the more important question.
   */
  const models = db()
    .prepare(
      `SELECT model, provider, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS costUsd
         FROM model_call GROUP BY model, provider ORDER BY calls DESC`,
    )
    .all() as Array<{ model: string; provider: string; calls: number; costUsd: number }>;

  // Recorded at the moment of failure rather than inferred from the provider
  // column, so the panel can say what went wrong instead of only that
  // something did.
  const degradedRows = db()
    .prepare(
      `SELECT degraded_reason AS reason, COUNT(*) AS calls, MAX(created_at) AS lastAt
         FROM model_call WHERE degraded_reason IS NOT NULL
        GROUP BY degraded_reason ORDER BY calls DESC`,
    )
    .all() as Array<{ reason: string; calls: number; lastAt: string }>;
  const degraded = degradedRows.reduce((sum, row) => sum + row.calls, 0);

  res.json({
    runs: runs.recent(200, agent as never),
    spend: summariseSpend(),
    transparency: {
      configuredProvider: runtime.activeProvider(),
      configuredModel: runtime.modelId(),
      endpoint: runtime.baseUrl() || 'https://api.anthropic.com',
      keySource: runtime.apiKeySource(),
      transcription: runtime.activeTranscription(),
      models,
      degraded,
      degradedReasons: degradedRows,
    },
  });
});


/* ------------------------------------------------------------- settings -- */

api.get('/settings', requireClinician, (_req, res) => {
  res.json({ settings: runtime.current(), apiKeySource: runtime.apiKeySource() });
});

const ALLOWED_UNITS: Record<keyof UnitPreferences, string[]> = {
  glucose: ['mg/dL', 'mmol/L'],
  weight: ['kg', 'lb'],
  height: ['cm', 'in'],
  temperature: ['°C', '°F'],
};

api.put('/settings', requireClinician, (req: AuthedRequest, res) => {
  const body = req.body as Partial<ClinicSettings> & {
    apiKey?: string | null;
    transcriptionKey?: string | null;
  };
  const clinician = clinicians.byId(req.clinicianId!);
  const actorName = clinician?.name ?? 'Unknown clinician';
  const before = runtime.current();
  const changed: string[] = [];

  if (body.provider !== undefined) {
    if (!['auto', 'anthropic', 'deterministic'].includes(body.provider)) {
      res.status(400).json({ error: 'Choose automatic, live model, or the local engine.' });
      return;
    }
    runtime.settingStore.put(runtime.SETTING_KEYS.provider, body.provider, req.clinicianId!);
    if (body.provider !== before.provider) changed.push(`engine to ${body.provider}`);
  }

  if (body.model !== undefined) {
    const model = String(body.model).trim();
    if (!model) {
      res.status(400).json({ error: 'Enter a model identifier, for example claude-opus-5.' });
      return;
    }
    runtime.settingStore.put(runtime.SETTING_KEYS.model, model, req.clinicianId!);
    if (model !== before.model) changed.push(`model to ${model}`);
  }

  // The key is written, never read back. An empty string clears it and falls
  // back to the environment; undefined leaves whatever is stored alone.
  if (body.apiKey !== undefined) {
    const key = String(body.apiKey ?? '').trim();
    if (key === '') {
      runtime.settingStore.remove(runtime.SETTING_KEYS.apiKey);
      changed.push('cleared the stored API key');
    } else {
      if (key.length < 20) {
        res.status(400).json({ error: 'That does not look like a complete API key.' });
        return;
      }
      runtime.settingStore.put(runtime.SETTING_KEYS.apiKey, key, req.clinicianId!);
      // Only the last four characters are ever recorded, here or anywhere else.
      changed.push(`stored a new API key ending …${key.slice(-4)}`);
    }
  }

  if (body.baseUrl !== undefined) {
    const url = String(body.baseUrl).trim();
    if (url !== '') {
      // A malformed endpoint would fail on every agent call rather than here,
      // where the person who typed it is still looking at the field.
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        res.status(400).json({ error: 'Enter a full URL, for example https://gateway.clinic.example.' });
        return;
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        res.status(400).json({ error: 'The endpoint must be an http or https URL.' });
        return;
      }
    }
    runtime.settingStore.put(runtime.SETTING_KEYS.baseUrl, url, req.clinicianId!);
    if (url !== before.baseUrl) changed.push(url ? `model endpoint to ${url}` : 'model endpoint back to Anthropic');
  }

  if (body.transcription !== undefined) {
    if (!['browser', 'assemblyai'].includes(body.transcription)) {
      res.status(400).json({ error: 'Choose browser transcription or AssemblyAI.' });
      return;
    }
    runtime.settingStore.put(runtime.SETTING_KEYS.transcription, body.transcription, req.clinicianId!);
    if (body.transcription !== before.transcription) changed.push(`transcription to ${body.transcription}`);
  }

  if (body.transcriptionModel !== undefined) {
    const model = String(body.transcriptionModel).trim();
    if (!model) {
      res.status(400).json({ error: 'Enter a speech model, for example universal-3-5-pro.' });
      return;
    }
    runtime.settingStore.put(runtime.SETTING_KEYS.transcriptionModel, model, req.clinicianId!);
    if (model !== before.transcriptionModel) changed.push(`speech model to ${model}`);
  }

  // Same discipline as the model key: written, never read back.
  if (body.transcriptionKey !== undefined) {
    const key = String(body.transcriptionKey ?? '').trim();
    if (key === '') {
      runtime.settingStore.remove(runtime.SETTING_KEYS.transcriptionKey);
      changed.push('cleared the stored AssemblyAI key');
    } else {
      if (key.length < 20) {
        res.status(400).json({ error: 'That does not look like a complete AssemblyAI key.' });
        return;
      }
      runtime.settingStore.put(runtime.SETTING_KEYS.transcriptionKey, key, req.clinicianId!);
      changed.push(`stored an AssemblyAI key ending …${key.slice(-4)}`);
    }
  }

  if (body.units !== undefined) {
    const units: Record<string, string> = {};
    for (const [field, allowed] of Object.entries(ALLOWED_UNITS)) {
      const value = (body.units as unknown as Record<string, string>)[field];
      if (value === undefined) continue;
      if (!allowed.includes(value)) {
        res.status(400).json({ error: `${value} is not a unit this system records ${field} in.` });
        return;
      }
      units[field] = value;
    }
    runtime.settingStore.put(runtime.SETTING_KEYS.units, { ...before.units, ...units }, req.clinicianId!);
    changed.push('display units');
  }

  if (body.keywords !== undefined) {
    const list = (Array.isArray(body.keywords) ? body.keywords : [])
      .map((k) => String(k).trim())
      .filter(Boolean)
      .slice(0, 500);
    runtime.settingStore.put(runtime.SETTING_KEYS.keywords, list, req.clinicianId!);
    changed.push(`${list.length} dictation keyword${list.length === 1 ? '' : 's'}`);
  }

  if (body.followUpIntervalDays !== undefined) {
    const days = Number(body.followUpIntervalDays);
    if (!Number.isInteger(days) || days < 7 || days > 1095) {
      res.status(400).json({ error: 'Set the review interval between 7 and 1095 days.' });
      return;
    }
    runtime.settingStore.put(runtime.SETTING_KEYS.followUp, days, req.clinicianId!);
    changed.push(`review interval to ${days} days`);
  }

  if (body.idleMinutes !== undefined) {
    const minutes = Number(body.idleMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) {
      res.status(400).json({ error: 'Set the inactivity timeout between 1 and 480 minutes.' });
      return;
    }
    runtime.settingStore.put(runtime.SETTING_KEYS.idleMinutes, minutes, req.clinicianId!);
    if (minutes !== before.idleMinutes) changed.push(`inactivity timeout to ${minutes} minutes`);
  }

  if (body.sessionHours !== undefined) {
    const hours = Number(body.sessionHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      res.status(400).json({ error: 'Set the session length between 1 and 720 hours.' });
      return;
    }
    runtime.settingStore.put(runtime.SETTING_KEYS.sessionHours, hours, req.clinicianId!);
    if (hours !== before.sessionHours) changed.push(`session length to ${hours} hours`);
  }

  if (body.showAgentStrip !== undefined) {
    runtime.settingStore.put(runtime.SETTING_KEYS.agentStrip, Boolean(body.showAgentStrip), req.clinicianId!);
    changed.push(`agent strip ${body.showAgentStrip ? 'shown' : 'hidden'}`);
  }

  audit.record({
    actor: req.clinicianId!,
    actorName,
    action: 'settings.updated',
    entityType: 'settings',
    summary: changed.length > 0 ? `Changed ${changed.join(', ')}.` : 'Saved settings with no changes.',
    detail: { changed },
  });

  res.json({ settings: runtime.current(), apiKeySource: runtime.apiKeySource() });
});

/* -------------------------------------------------------- pronunciation -- */

api.get('/pronunciations', requireClinician, (req: AuthedRequest, res) => {
  res.json({ pronunciations: pronunciations.forClinician(req.clinicianId!) });
});

api.post('/pronunciations', requireClinician, (req: AuthedRequest, res) => {
  const { term, heard, category } = req.body as {
    term?: string;
    heard?: string;
    category?: string;
  };
  const cleanTerm = String(term ?? '').trim();
  if (!cleanTerm) {
    res.status(400).json({ error: 'Enter the word or phrase as it should be written.' });
    return;
  }
  const record = pronunciations.upsert(
    req.clinicianId!,
    cleanTerm.slice(0, 120),
    String(heard ?? '').slice(0, 200),
    String(category ?? 'term').slice(0, 40),
  );
  const clinician = clinicians.byId(req.clinicianId!);
  audit.record({
    actor: req.clinicianId!,
    actorName: clinician?.name ?? 'Unknown clinician',
    action: 'pronunciation.recorded',
    entityType: 'pronunciation',
    entityId: record.id,
    summary: `Recorded a voice sample for “${record.term}” (${record.sampleCount} sample${
      record.sampleCount === 1 ? '' : 's'
    }).`,
    detail: { term: record.term, heardAs: record.heardAs },
  });
  res.json({ pronunciation: record });
});

api.delete('/pronunciations/:id', requireClinician, (req: AuthedRequest, res) => {
  const record = pronunciations.byId(param(req, 'id'));
  if (!record || record.clinicianId !== req.clinicianId) {
    res.status(404).json({ error: 'That entry no longer exists.' });
    return;
  }
  pronunciations.remove(record.id);
  const clinician = clinicians.byId(req.clinicianId!);
  audit.record({
    actor: req.clinicianId!,
    actorName: clinician?.name ?? 'Unknown clinician',
    action: 'pronunciation.removed',
    entityType: 'pronunciation',
    entityId: record.id,
    summary: `Removed the voice training entry for “${record.term}”.`,
  });
  res.json({ ok: true });
});

/* --------------------------------------------------- clinical thresholds -- */

api.get('/thresholds', requireClinician, (_req, res) => {
  res.json({ thresholds: describeThresholds() });
});

/**
 * Adjust one threshold for this clinic.
 *
 * Reason and source are mandatory. The published value stays in the reference
 * file untouched — this records a departure from it, and the departure carries
 * the justification a clinician would have to give for it anyway.
 */
api.put('/thresholds/:name', requireClinician, (req: AuthedRequest, res) => {
  const name = param(req, 'name');
  if (!isThresholdName(name)) {
    res.status(404).json({ error: 'That is not a threshold this system uses.' });
    return;
  }

  const body = req.body as { value?: number; reason?: string; source?: string };
  const value = Number(body.value);
  const reason = String(body.reason ?? '').trim();
  const source = String(body.source ?? '').trim();

  if (reason.length < 10) {
    res.status(400).json({
      error: 'Say why this clinic uses a different number. An adjustment with no stated reason cannot be reviewed later.',
    });
    return;
  }
  if (source.length < 3) {
    res.status(400).json({
      error: 'Name the guidance this follows, so the number can be traced the way the published one can.',
    });
    return;
  }

  const problem = thresholds.validate(name, value);
  if (problem) {
    res.status(400).json({ error: problem.message });
    return;
  }

  const clinician = clinicians.byId(req.clinicianId!);
  const clinicianName = clinician?.name ?? 'Unknown clinician';
  const previous = thresholds.overrides()[name];
  const base = TH[name].baseValue;

  thresholds.put(
    name,
    {
      value,
      reason: reason.slice(0, 500),
      source: source.slice(0, 200),
      setBy: req.clinicianId!,
      setByName: clinicianName,
      setAt: new Date().toISOString(),
    },
    req.clinicianId!,
  );

  audit.record({
    actor: req.clinicianId!,
    actorName: clinicianName,
    action: 'threshold.adjusted',
    entityType: 'clinical_threshold',
    entityId: name,
    summary: `Adjusted ${TH[name].label} from ${previous?.value ?? base} to ${value} (published value ${base}, ${TH[name].referenceId}). Reason: ${reason}`,
    detail: { name, from: previous?.value ?? base, to: value, publishedValue: base, reason, source },
  });

  res.json({ thresholds: describeThresholds() });
});

/** Return one threshold to its published value. */
api.delete('/thresholds/:name', requireClinician, (req: AuthedRequest, res) => {
  const name = param(req, 'name');
  if (!isThresholdName(name)) {
    res.status(404).json({ error: 'That is not a threshold this system uses.' });
    return;
  }
  const previous = thresholds.overrides()[name];
  if (!previous) {
    res.json({ thresholds: describeThresholds() });
    return;
  }

  thresholds.remove(name, req.clinicianId!);
  const clinician = clinicians.byId(req.clinicianId!);
  audit.record({
    actor: req.clinicianId!,
    actorName: clinician?.name ?? 'Unknown clinician',
    action: 'threshold.restored',
    entityType: 'clinical_threshold',
    entityId: name,
    summary: `Restored ${TH[name].label} to the published value of ${TH[name].baseValue} (${TH[name].referenceId}), from ${previous.value}.`,
    detail: { name, from: previous.value, to: TH[name].baseValue },
  });

  res.json({ thresholds: describeThresholds() });
});

/* -------------------------------------------------------- transcription -- */

/**
 * Mints a short-lived AssemblyAI streaming token for the browser.
 *
 * The clinic's API key never leaves this process. The browser cannot set
 * headers on a WebSocket, so AssemblyAI's own answer to that is a one-time
 * token passed in the query string — this endpoint is the only thing that
 * holds the key, and it hands out a credential that expires in a minute and
 * works for exactly one session.
 */
api.get('/transcription/token', requireClinician, async (_req, res) => {
  const key = runtime.transcriptionKey();
  if (!key) {
    res.status(400).json({
      error: 'No AssemblyAI key is stored. Add one under Settings to use medical transcription.',
    });
    return;
  }

  try {
    const url = new URL('https://streaming.assemblyai.com/v3/token');
    // Long enough to survive a slow microphone permission prompt, short enough
    // that a token captured from the network log is worthless by the time it is.
    url.searchParams.set('expires_in_seconds', '120');
    url.searchParams.set('max_session_duration_seconds', '3600');

    const response = await fetch(url, { headers: { Authorization: key } });
    if (!response.ok) {
      const detail = await response.text();
      // The clinician can act on the first of these; the rest are for the log.
      const message =
        response.status === 401
          ? 'AssemblyAI rejected the stored key. Check it under Settings.'
          : `AssemblyAI could not issue a transcription token (${response.status}).`;
      console.error('ASSEMBLYAI TOKEN FAILED', response.status, detail.slice(0, 300));
      res.status(502).json({ error: message });
      return;
    }

    const payload = (await response.json()) as { token?: string; expires_in_seconds?: number };
    if (!payload.token) {
      res.status(502).json({ error: 'AssemblyAI returned no token. Dictation will use the browser.' });
      return;
    }

    res.json({
      token: payload.token,
      expiresInSeconds: payload.expires_in_seconds ?? 120,
      model: runtime.transcriptionModel(),
    });
  } catch (error) {
    console.error('ASSEMBLYAI TOKEN ERROR', error);
    res.status(502).json({
      error: 'Could not reach AssemblyAI. Dictation will fall back to the browser.',
    });
  }
});

/* ----------------------------------------------------------------- users -- */

api.get('/users', requireClinician, (req: AuthedRequest, res) => {
  const me = clinicians.byId(req.clinicianId!);
  // Everyone can see who their colleagues are — the audit trail names them, so
  // hiding the list would only make it harder to read. Only an admin can change
  // anything, which is enforced on the routes that change things.
  res.json({ users: clinicians.all(), me });
});

api.post('/users', requireClinician, requireAdmin, (req: AuthedRequest, res) => {
  const body = req.body as { name?: string; credentials?: string; email?: string; role?: string };
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const role = body.role === 'admin' ? 'admin' : 'clinician';

  if (!name) {
    res.status(400).json({ error: 'Enter the name of the person this account is for.' });
    return;
  }
  if (!email.includes('@')) {
    res.status(400).json({ error: 'Enter the email address they will sign in with.' });
    return;
  }
  if (clinicians.byEmail(email)) {
    res.status(409).json({ error: 'Somebody already signs in with that email address.' });
    return;
  }

  const password = temporaryPassword();
  const { hash, salt } = hashPassword(password);
  const newId = id('clin');

  clinicians.insert({
    id: newId,
    name,
    credentials: String(body.credentials ?? '').trim(),
    email,
    passwordHash: hash,
    passwordSalt: salt,
    role,
    mustChangePassword: true,
  });

  const actor = clinicians.byId(req.clinicianId!);
  audit.record({
    actor: req.clinicianId!,
    actorName: actor?.name ?? 'Unknown clinician',
    action: 'user.created',
    entityType: 'clinician',
    entityId: newId,
    summary: `Created a ${role} account for ${name} (${email}). A temporary password was issued.`,
    detail: { role, email },
  });

  // The only time this is ever readable. It is stored as a salted hash.
  res.json({ user: clinicians.byId(newId), temporaryPassword: password });
});

api.post('/users/:id/active', requireClinician, requireAdmin, (req: AuthedRequest, res) => {
  const target = clinicians.byId(param(req, 'id'));
  if (!target) {
    res.status(404).json({ error: 'That account no longer exists.' });
    return;
  }
  const active = Boolean((req.body as { active?: boolean }).active);

  if (!active && target.id === req.clinicianId) {
    res.status(400).json({ error: 'You cannot deactivate your own account.' });
    return;
  }
  // Losing the last admin means nobody can ever manage accounts again, and
  // there is no recovery path short of editing the database by hand.
  if (!active && target.role === 'admin' && clinicians.activeAdminCount() <= 1) {
    res.status(400).json({ error: 'This is the last active administrator. Promote somebody else first.' });
    return;
  }

  clinicians.setActive(target.id, active);
  const actor = clinicians.byId(req.clinicianId!);
  audit.record({
    actor: req.clinicianId!,
    actorName: actor?.name ?? 'Unknown clinician',
    action: active ? 'user.reactivated' : 'user.deactivated',
    entityType: 'clinician',
    entityId: target.id,
    summary: active
      ? `Reactivated ${target.name}'s account.`
      : `Deactivated ${target.name}'s account. Their sessions ended immediately; their history is kept.`,
  });
  res.json({ user: clinicians.byId(target.id) });
});

api.put('/users/:id/role', requireClinician, requireAdmin, (req: AuthedRequest, res) => {
  const target = clinicians.byId(param(req, 'id'));
  if (!target) {
    res.status(404).json({ error: 'That account no longer exists.' });
    return;
  }
  const role = (req.body as { role?: string }).role === 'admin' ? 'admin' : 'clinician';

  if (role === 'clinician' && target.role === 'admin' && clinicians.activeAdminCount() <= 1) {
    res.status(400).json({ error: 'This is the last administrator. Promote somebody else first.' });
    return;
  }

  clinicians.setRole(target.id, role);
  const actor = clinicians.byId(req.clinicianId!);
  audit.record({
    actor: req.clinicianId!,
    actorName: actor?.name ?? 'Unknown clinician',
    action: 'user.role_changed',
    entityType: 'clinician',
    entityId: target.id,
    summary: `Changed ${target.name} from ${target.role} to ${role}.`,
    detail: { from: target.role, to: role },
  });
  res.json({ user: clinicians.byId(target.id) });
});

api.post('/users/:id/reset-password', requireClinician, requireAdmin, (req: AuthedRequest, res) => {
  const target = clinicians.byId(param(req, 'id'));
  if (!target) {
    res.status(404).json({ error: 'That account no longer exists.' });
    return;
  }

  const password = temporaryPassword();
  const { hash, salt } = hashPassword(password);
  clinicians.setPassword(target.id, hash, salt, true);

  const actor = clinicians.byId(req.clinicianId!);
  audit.record({
    actor: req.clinicianId!,
    actorName: actor?.name ?? 'Unknown clinician',
    action: 'user.password_reset',
    entityType: 'clinician',
    entityId: target.id,
    summary: `Reset ${target.name}'s password. Their existing sessions ended and they must set a new one.`,
  });
  res.json({ temporaryPassword: password });
});

/** Anyone can change their own password; nobody else's. */
api.post('/auth/password', requireClinician, (req: AuthedRequest, res) => {
  const { current, next: nextPassword } = req.body as { current?: string; next?: string };
  const me = clinicians.byEmail(clinicians.byId(req.clinicianId!)?.email ?? '');
  if (!me) {
    res.status(401).json({ error: ENDED });
    return;
  }

  if (!verifyPassword(String(current ?? ''), me.passwordHash, me.passwordSalt)) {
    res.status(400).json({ error: 'That is not your current password.' });
    return;
  }
  if (String(nextPassword ?? '').length < 10) {
    res.status(400).json({ error: 'Choose a new password of at least 10 characters.' });
    return;
  }
  if (current === nextPassword) {
    res.status(400).json({ error: 'The new password has to be different from the old one.' });
    return;
  }

  const { hash, salt } = hashPassword(String(nextPassword));
  clinicians.setPassword(me.id, hash, salt, false);

  audit.record({
    actor: me.id,
    actorName: me.name,
    action: 'password.changed',
    entityType: 'clinician',
    entityId: me.id,
    summary: `${me.name} changed their own password. Sessions opened with the old one ended.`,
  });

  // Their own session was just invalidated too, so re-issue one.
  res.cookie?.(config.sessionCookieName, makeSessionToken(me.id, me.tokenVersion + 1), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: runtime.sessionHours() * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------ audit log -- */

api.get('/audit', requireClinician, (req, res) => {
  const action = String(req.query['action'] ?? '').trim() || undefined;
  const patientId = String(req.query['patientId'] ?? '').trim() || undefined;
  const limit = Math.min(500, Math.max(10, Number(req.query['limit'] ?? 200) || 200));
  res.json({
    events: audit.recent(limit, { action, patientId }),
    actions: audit.actions(),
    total: audit.total(),
    integrity: audit.verify(),
  });
});

/* --------------------------------------------------------------- stream -- */


/** Section 6: the dashboard updates when agents complete, with no manual refresh. */
api.get('/stream', requireClinician, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const unsubscribe = subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  // Keeps proxies from closing an idle connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
