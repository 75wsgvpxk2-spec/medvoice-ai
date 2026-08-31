import { createHash } from 'node:crypto';
import { db, id, now, toJson, fromJson, toBool } from './index.ts';
import { pageMeta } from '../lib/paging.ts';
import type {
  Patient,
  PatientStatus,
  Encounter,
  Observation,
  RiskFlag,
  DocumentationAlert,
  Order,
  BillingEntry,
  Clinician,
  AgentRun,
  Condition,
  Medication,
  FieldConfidence,
  ContextBrief,
  ResolutionAction,
  DismissalReason,
  ObservationType,
  ClinicianRole,
  Clinic,
  PatientProfile,
  AuditEvent,
  Pronunciation,
  Product,
  Invoice,
  InvoiceLine,
  Expense,
  InvoiceSummary,
  ExpenseSummary,
  HseReport,
  HseRecipient,
  HseFindings,
  HseRecommendation,
} from '../../../shared/types.ts';
import { EMPTY_PROFILE, DEFAULT_BRAND, HSE_DEFAULTS } from '../../../shared/types.ts';

/* ------------------------------------------------------------------ rows -- */

type Row = Record<string, unknown>;

/**
 * Age comes from the date of birth whenever there is one. A stored age is right
 * on the day it is typed and wrong every birthday after, which for a paediatric
 * dose or a screening interval is not a rounding error.
 */
export function ageFrom(dateOfBirth: string, storedAge: number): number {
  if (!dateOfBirth) return storedAge;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return storedAge;
  const today = new Date();
  let years = today.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < born.getUTCDate())) years -= 1;
  return years >= 0 && years < 130 ? years : storedAge;
}

function toProfile(raw: string | null | undefined): PatientProfile {
  const stored = fromJson<Partial<PatientProfile>>(raw, {});
  // Spread over the empty shape so a record written before a field existed
  // still returns every key, and the form never binds to undefined.
  return {
    ...EMPTY_PROFILE,
    ...stored,
    emergencyContact: { ...EMPTY_PROFILE.emergencyContact, ...stored.emergencyContact },
    insurance: { ...EMPTY_PROFILE.insurance, ...stored.insurance },
  };
}

function toPatient(r: Row): Patient {
  const profile = toProfile(r['profile'] as string);
  return {
    id: r['id'] as string,
    name: r['name'] as string,
    age: ageFrom(profile.dateOfBirth, r['age'] as number),
    sex: r['sex'] as Patient['sex'],
    conditions: fromJson<Condition[]>(r['conditions'] as string, []),
    medications: fromJson<Medication[]>(r['medications'] as string, []),
    allergies: fromJson<string[]>(r['allergies'] as string, []),
    clinicianId: r['clinician_id'] as string,
    status: r['status'] as PatientStatus,
    queuePosition: (r['queue_position'] as number | null) ?? null,
    lastAssessedAt: (r['last_assessed_at'] as string | null) ?? null,
    profile,
  };
}

function toEncounter(r: Row): Encounter {
  return {
    id: r['id'] as string,
    patientId: r['patient_id'] as string,
    clinicianId: r['clinician_id'] as string,
    date: r['date'] as string,
    rawNote: r['raw_note'] as string,
    structured: {
      subjective: r['subjective'] as string,
      objective: r['objective'] as string,
      assessment: r['assessment'] as string,
      plan: r['plan'] as string,
    },
    fieldConfidence: fromJson<FieldConfidence[]>(r['field_confidence'] as string, []),
    status: r['status'] as Encounter['status'],
    approvedBy: (r['approved_by'] as string | null) ?? null,
    approvedAt: (r['approved_at'] as string | null) ?? null,
    version: r['version'] as number,
    amendsEncounterId: (r['amends_encounter_id'] as string | null) ?? null,
    amendedBy: (r['amended_by'] as string | null) ?? null,
    amendedAt: (r['amended_at'] as string | null) ?? null,
    contextBrief: fromJson<ContextBrief | null>(r['context_brief'] as string, null),
  };
}

function toObservation(r: Row): Observation {
  return {
    id: r['id'] as string,
    patientId: r['patient_id'] as string,
    encounterId: (r['encounter_id'] as string | null) ?? null,
    type: r['type'] as ObservationType,
    value: r['value'] as string,
    unit: r['unit'] as string,
    recordedOn: r['recorded_on'] as string,
    overdue: toBool(r['overdue'] as number),
  };
}

function toFlag(r: Row): RiskFlag {
  return {
    id: r['id'] as string,
    patientId: r['patient_id'] as string,
    flagType: r['flag_type'] as string,
    urgency: r['urgency'] as RiskFlag['urgency'],
    reasoning: r['reasoning'] as string,
    recommendedAction: r['recommended_action'] as string,
    triggeringEncounterId: (r['triggering_encounter_id'] as string | null) ?? null,
    triggeringObservationId: (r['triggering_observation_id'] as string | null) ?? null,
    createdAt: r['created_at'] as string,
    status: r['status'] as RiskFlag['status'],
    dismissalReason: (r['dismissal_reason'] as DismissalReason | null) ?? null,
    dismissalNote: (r['dismissal_note'] as string | null) ?? null,
    dismissedBy: (r['dismissed_by'] as string | null) ?? null,
    dismissedAt: (r['dismissed_at'] as string | null) ?? null,
    confidence: r['confidence'] as RiskFlag['confidence'],
    referenceIds: fromJson<string[]>(r['reference_ids'] as string, []),
    dismissedFingerprint: (r['dismissed_fingerprint'] as string | null) ?? null,
    severityScore: (r['severity_score'] as number | null) ?? 0,
  };
}

function toAlert(r: Row): DocumentationAlert {
  return {
    id: r['id'] as string,
    patientId: r['patient_id'] as string,
    encounterId: r['encounter_id'] as string,
    gapType: r['gap_type'] as DocumentationAlert['gapType'],
    description: r['description'] as string,
    resolution: fromJson<ResolutionAction>(r['resolution'] as string, { description: '' }),
    status: r['status'] as DocumentationAlert['status'],
    resolvedBy: (r['resolved_by'] as string | null) ?? null,
    resolvedAt: (r['resolved_at'] as string | null) ?? null,
    createdAt: r['created_at'] as string,
    gapKey: r['gap_key'] as string,
    route: (r['resolution_route'] as DocumentationAlert['route']) ?? null,
    note: (r['resolution_note'] as string | null) ?? null,
  };
}

function toOrder(r: Row): Order {
  return {
    id: r['id'] as string,
    patientId: r['patient_id'] as string,
    encounterId: r['encounter_id'] as string,
    orderType: r['order_type'] as string,
    what: r['what'] as string,
    status: r['status'] as Order['status'],
    orderedBy: r['ordered_by'] as string,
    orderedAt: r['ordered_at'] as string,
    completedAt: (r['completed_at'] as string | null) ?? null,
    fromAlertId: (r['from_alert_id'] as string | null) ?? null,
  };
}

function toBilling(r: Row): BillingEntry {
  return {
    id: r['id'] as string,
    patientId: r['patient_id'] as string,
    encounterId: r['encounter_id'] as string,
    code: r['code'] as string,
    description: r['description'] as string,
    status: r['status'] as BillingEntry['status'],
    fromOrderId: (r['from_order_id'] as string | null) ?? null,
    createdAt: r['created_at'] as string,
  };
}

function toRun(r: Row): AgentRun {
  return {
    id: r['id'] as string,
    agent: r['agent'] as AgentRun['agent'],
    trigger: r['trigger'] as AgentRun['trigger'],
    patientId: (r['patient_id'] as string | null) ?? null,
    encounterId: (r['encounter_id'] as string | null) ?? null,
    correlationId: r['correlation_id'] as string,
    startedAt: r['started_at'] as string,
    completedAt: (r['completed_at'] as string | null) ?? null,
    durationMs: (r['duration_ms'] as number | null) ?? null,
    inputSummary: r['input_summary'] as string,
    outputSummary: (r['output_summary'] as string | null) ?? null,
    outcome: r['outcome'] as AgentRun['outcome'],
    errorMessage: (r['error_message'] as string | null) ?? null,
    concurrencyAtStart: (r['concurrency_at_start'] as number | null) ?? 1,
  };
}

/* ------------------------------------------------------------- clinician -- */

export const clinicians = {
  byEmail(
    email: string,
  ): (Clinician & { passwordHash: string; passwordSalt: string; tokenVersion: number }) | null {
    const r = db().prepare('SELECT * FROM clinician WHERE email = ?').get(email) as Row | undefined;
    if (!r) return null;
    return {
      ...toClinician(r),
      passwordHash: r['password_hash'] as string,
      passwordSalt: r['password_salt'] as string,
      tokenVersion: (r['token_version'] as number) ?? 1,
    };
  },

  count(): number {
    const r = db().prepare('SELECT COUNT(*) AS n FROM clinician').get() as Row;
    return (r['n'] as number) ?? 0;
  },

  /** The version every token for this clinician must carry to still be valid. */
  tokenVersion(clinicianId: string): number | null {
    const r = db()
      .prepare('SELECT token_version FROM clinician WHERE id = ?')
      .get(clinicianId) as Row | undefined;
    return r ? ((r['token_version'] as number) ?? 1) : null;
  },

  /** Invalidates every token already issued to this clinician. */
  revokeSessions(clinicianId: string): void {
    db()
      .prepare('UPDATE clinician SET token_version = token_version + 1 WHERE id = ?')
      .run(clinicianId);
  },

  byId(clinicianId: string): Clinician | null {
    const r = db().prepare('SELECT * FROM clinician WHERE id = ?').get(clinicianId) as Row | undefined;
    return r ? toClinician(r) : null;
  },

  /** Everyone with a sign-in, deactivated included — they still appear in audit. */
  all(): Clinician[] {
    return (
      db().prepare('SELECT * FROM clinician ORDER BY active DESC, name').all() as Row[]
    ).map(toClinician);
  },

  insert(
    // Signature is omitted here as well as the server-set fields: nobody has
    // one when their account is created, and it is set later by its owner.
    c: Omit<
      Clinician,
      'role' | 'active' | 'mustChangePassword' | 'createdAt' | 'lastSignInAt' | 'signature'
    > & {
      passwordHash: string;
      passwordSalt: string;
      role?: ClinicianRole;
      mustChangePassword?: boolean;
    },
  ): void {
    db()
      .prepare(
        `INSERT INTO clinician
           (id, name, credentials, email, password_hash, password_salt,
            role, active, must_change_password, created_at)
         VALUES (?,?,?,?,?,?,?,1,?,?)`,
      )
      .run(
        c.id,
        c.name,
        c.credentials,
        c.email,
        c.passwordHash,
        c.passwordSalt,
        c.role ?? 'clinician',
        c.mustChangePassword ? 1 : 0,
        now(),
      );
  },

  setPassword(clinicianId: string, hash: string, salt: string, mustChange: boolean): void {
    db()
      .prepare(
        `UPDATE clinician
            SET password_hash = ?, password_salt = ?, must_change_password = ?,
                token_version = token_version + 1
          WHERE id = ?`,
      )
      // Changing a password ends every session opened with the old one. If it
      // was changed because it leaked, leaving those alive defeats the point.
      .run(hash, salt, mustChange ? 1 : 0, clinicianId);
  },

  setActive(clinicianId: string, active: boolean): void {
    db()
      .prepare('UPDATE clinician SET active = ?, token_version = token_version + 1 WHERE id = ?')
      // Deactivation takes effect on the next request, not the next sign-in.
      .run(active ? 1 : 0, clinicianId);
  },

  setRole(clinicianId: string, role: ClinicianRole): void {
    db().prepare('UPDATE clinician SET role = ? WHERE id = ?').run(role, clinicianId);
  },

  recordSignIn(clinicianId: string): void {
    db().prepare('UPDATE clinician SET last_sign_in_at = ? WHERE id = ?').run(now(), clinicianId);
  },

  /** How many admins remain active — the last one must not be removed. */
  /** A clinician's own signature. No route lets anybody set another's. */
  setSignature(clinicianId: string, signature: string | null): void {
    db().prepare('UPDATE clinician SET signature = ? WHERE id = ?').run(signature, clinicianId);
  },

  activeAdminCount(): number {
    const r = db()
      .prepare("SELECT COUNT(*) AS n FROM clinician WHERE role = 'admin' AND active = 1")
      .get() as Row;
    return (r['n'] as number) ?? 0;
  },
};

function toClinician(r: Row): Clinician {
  return {
    id: r['id'] as string,
    name: r['name'] as string,
    credentials: r['credentials'] as string,
    email: r['email'] as string,
    role: ((r['role'] as string) ?? 'clinician') as ClinicianRole,
    active: (r['active'] as number) !== 0,
    mustChangePassword: (r['must_change_password'] as number) === 1,
    createdAt: (r['created_at'] as string | null) ?? null,
    lastSignInAt: (r['last_sign_in_at'] as string | null) ?? null,
    signature: (r['signature'] as string | null) ?? null,
  };
}

/* ---------------------------------------------------------------- clinic -- */

const EMPTY_CLINIC: Clinic = {
  name: '',
  legalName: '',
  currency: 'USD',
  registration: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  logo: null,
  letterhead: null,
  ...DEFAULT_BRAND,
  primaryDoctor: '',
  updatedAt: null,
};

export const clinic = {
  get(): Clinic {
    const r = db().prepare("SELECT * FROM clinic WHERE id = 'clinic'").get() as Row | undefined;
    if (!r) return EMPTY_CLINIC;
    return {
      name: (r['name'] as string) ?? '',
      legalName: (r['legal_name'] as string) ?? '',
      currency: (r['currency'] as string) || 'USD',
      registration: (r['registration'] as string) ?? '',
      address: (r['address'] as string) ?? '',
      phone: (r['phone'] as string) ?? '',
      email: (r['email'] as string) ?? '',
      website: (r['website'] as string) ?? '',
      logo: (r['logo'] as string | null) ?? null,
      letterhead: (r['letterhead'] as string | null) ?? null,
      brandDark: (r['brand_dark'] as string) || DEFAULT_BRAND.brandDark,
      brandLight: (r['brand_light'] as string) || DEFAULT_BRAND.brandLight,
      primaryDoctor: (r['primary_doctor'] as string) ?? '',
      updatedAt: (r['updated_at'] as string | null) ?? null,
    };
  },

  save(input: Omit<Clinic, 'updatedAt'>): Clinic {
    db()
      .prepare(
        `INSERT INTO clinic (id, name, legal_name, currency, registration, address, phone, email, website, logo,
                              letterhead, brand_dark, brand_light, primary_doctor, updated_at)
         VALUES ('clinic',?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, legal_name = excluded.legal_name,
           currency = excluded.currency,
           registration = excluded.registration, address = excluded.address,
           phone = excluded.phone, email = excluded.email,
           website = excluded.website, logo = excluded.logo,
           letterhead = excluded.letterhead,
           brand_dark = excluded.brand_dark, brand_light = excluded.brand_light,
           primary_doctor = excluded.primary_doctor,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.name,
        input.legalName,
        input.currency || 'USD',
        input.registration,
        input.address,
        input.phone,
        input.email,
        input.website,
        input.logo,
        input.letterhead,
        input.brandDark,
        input.brandLight,
        input.primaryDoctor,
        now(),
      );
    return clinic.get();
  },
};

/* --------------------------------------------------------------- patient -- */

export const patients = {
  /**
   * Every patient in this installation.
   *
   * The access boundary is the installation, not the clinician. One deployment
   * serves one clinic, and staff at a clinic share a caseload — a nurse who
   * cannot see the patient in front of them because a colleague registered
   * them is a system nobody will use. `clinician_id` remains on the row as
   * attribution: who added them, and who the assessment ran for.
   *
   * This is a deliberate departure from DI-4's per-clinician isolation, which
   * was written for a single-clinician build. See docs/DEVIATIONS.md item 2.
   */
  forClinic(): Patient[] {
    return (
      db().prepare('SELECT * FROM patient ORDER BY name').all() as Row[]
    ).map(toPatient);
  },

  /** Scoped to one clinician. Attribution and agent runs, not access control. */
  forClinician(clinicianId: string): Patient[] {
    return (
      db()
        .prepare('SELECT * FROM patient WHERE clinician_id = ? ORDER BY name')
        .all(clinicianId) as Row[]
    ).map(toPatient);
  },

  byId(patientId: string): Patient | null {
    const r = db().prepare('SELECT * FROM patient WHERE id = ?').get(patientId) as Row | undefined;
    return r ? toPatient(r) : null;
  },

  insert(p: Patient): void {
    db()
      .prepare(
        `INSERT INTO patient
           (id, name, age, sex, conditions, medications, allergies, clinician_id,
            status, queue_position, last_assessed_at, profile, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.id,
        p.name,
        p.age,
        p.sex,
        toJson(p.conditions),
        toJson(p.medications),
        toJson(p.allergies),
        p.clinicianId,
        p.status,
        p.queuePosition,
        p.lastAssessedAt,
        toJson(p.profile ?? EMPTY_PROFILE),
        // When they joined the population, which is not the same question as
        // when they were last assessed.
        now(),
      );
  },

  updateProfile(patientId: string, profile: PatientProfile): void {
    db().prepare('UPDATE patient SET profile = ? WHERE id = ?').run(toJson(profile), patientId);
  },

  setStatus(patientId: string, status: PatientStatus, assessedAt: string): void {
    db()
      .prepare('UPDATE patient SET status = ?, last_assessed_at = ? WHERE id = ?')
      .run(status, assessedAt, patientId);
  },

  setQueuePosition(patientId: string, position: number | null): void {
    db().prepare('UPDATE patient SET queue_position = ? WHERE id = ?').run(position, patientId);
  },

  addCondition(patientId: string, condition: Condition): void {
    const p = patients.byId(patientId);
    if (!p) return;
    if (p.conditions.some((c) => c.name.toLowerCase() === condition.name.toLowerCase())) return;
    db()
      .prepare('UPDATE patient SET conditions = ? WHERE id = ?')
      .run(toJson([...p.conditions, condition]), patientId);
  },
};

/* ------------------------------------------------------------- encounter -- */

export const encounters = {
  forPatient(patientId: string): Encounter[] {
    return (
      db()
        .prepare('SELECT * FROM encounter WHERE patient_id = ? ORDER BY date DESC')
        .all(patientId) as Row[]
    ).map(toEncounter);
  },

  /** Agents 1 and 3 read history; only approved encounters count as history. */
  approvedForPatient(patientId: string): Encounter[] {
    return (
      db()
        .prepare("SELECT * FROM encounter WHERE patient_id = ? AND status = 'approved' ORDER BY date DESC")
        .all(patientId) as Row[]
    ).map(toEncounter);
  },

  byId(encounterId: string): Encounter | null {
    const r = db().prepare('SELECT * FROM encounter WHERE id = ?').get(encounterId) as Row | undefined;
    return r ? toEncounter(r) : null;
  },

  insert(e: Encounter): void {
    db()
      .prepare(
        `INSERT INTO encounter
           (id, patient_id, clinician_id, date, raw_note, subjective, objective,
            assessment, plan, field_confidence, status, approved_by, approved_at,
            version, amends_encounter_id, amended_by, amended_at, context_brief, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.id,
        e.patientId,
        e.clinicianId,
        e.date,
        e.rawNote,
        e.structured.subjective,
        e.structured.objective,
        e.structured.assessment,
        e.structured.plan,
        toJson(e.fieldConfidence),
        e.status,
        e.approvedBy,
        e.approvedAt,
        e.version,
        e.amendsEncounterId,
        e.amendedBy,
        e.amendedAt,
        e.contextBrief ? toJson(e.contextBrief) : null,
        now(),
      );
  },

  updateStructured(
    encounterId: string,
    structured: Encounter['structured'],
    fieldConfidence: FieldConfidence[],
  ): void {
    db()
      .prepare(
        `UPDATE encounter SET subjective = ?, objective = ?, assessment = ?, plan = ?,
           field_confidence = ? WHERE id = ?`,
      )
      .run(
        structured.subjective,
        structured.objective,
        structured.assessment,
        structured.plan,
        toJson(fieldConfidence),
        encounterId,
      );
  },

  /** DI-1: the only path that sets status to approved. */
  approve(encounterId: string, clinicianId: string, at: string): void {
    db()
      .prepare("UPDATE encounter SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?")
      .run(clinicianId, at, encounterId);
  },

  daysSinceLast(patientId: string, asOf: Date = new Date()): number | null {
    const r = db()
      .prepare("SELECT MAX(date) AS last FROM encounter WHERE patient_id = ? AND status = 'approved'")
      .get(patientId) as { last: string | null };
    if (!r.last) return null;
    return Math.floor((asOf.getTime() - new Date(r.last).getTime()) / 86_400_000);
  },
};

/* ----------------------------------------------------------- observation -- */

export const observations = {
  forPatient(patientId: string): Observation[] {
    return (
      db()
        .prepare('SELECT * FROM observation WHERE patient_id = ? ORDER BY recorded_on DESC')
        .all(patientId) as Row[]
    ).map(toObservation);
  },

  latest(patientId: string, type: ObservationType): Observation | null {
    const r = db()
      .prepare('SELECT * FROM observation WHERE patient_id = ? AND type = ? ORDER BY recorded_on DESC LIMIT 1')
      .get(patientId, type) as Row | undefined;
    return r ? toObservation(r) : null;
  },

  /** Trend reasoning (A3-4) needs the series, not just the latest value. */
  series(patientId: string, type: ObservationType): Observation[] {
    return (
      db()
        .prepare('SELECT * FROM observation WHERE patient_id = ? AND type = ? ORDER BY recorded_on ASC')
        .all(patientId, type) as Row[]
    ).map(toObservation);
  },

  insert(o: Observation): void {
    db()
      .prepare(
        `INSERT INTO observation (id, patient_id, encounter_id, type, value, unit, recorded_on, overdue)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(o.id, o.patientId, o.encounterId, o.type, o.value, o.unit, o.recordedOn, o.overdue ? 1 : 0);
  },

  setOverdue(observationId: string, overdue: boolean): void {
    db().prepare('UPDATE observation SET overdue = ? WHERE id = ?').run(overdue ? 1 : 0, observationId);
  },
};

/* ------------------------------------------------------------- risk flag -- */

export const flags = {
  activeForPatient(patientId: string): RiskFlag[] {
    return (
      db()
        .prepare("SELECT * FROM risk_flag WHERE patient_id = ? AND status = 'active' ORDER BY created_at DESC")
        .all(patientId) as Row[]
    ).map(toFlag);
  },

  allForPatient(patientId: string): RiskFlag[] {
    return (
      db()
        .prepare('SELECT * FROM risk_flag WHERE patient_id = ? ORDER BY created_at DESC')
        .all(patientId) as Row[]
    ).map(toFlag);
  },

  byId(flagId: string): RiskFlag | null {
    const r = db().prepare('SELECT * FROM risk_flag WHERE id = ?').get(flagId) as Row | undefined;
    return r ? toFlag(r) : null;
  },

  /** FD-2: a dismissed flag of the same type must not regenerate identically. */
  dismissedForPatient(patientId: string): RiskFlag[] {
    return (
      db()
        .prepare("SELECT * FROM risk_flag WHERE patient_id = ? AND status = 'dismissed'")
        .all(patientId) as Row[]
    ).map(toFlag);
  },

  insert(f: RiskFlag): void {
    db()
      .prepare(
        `INSERT INTO risk_flag
           (id, patient_id, flag_type, urgency, reasoning, recommended_action,
            triggering_encounter_id, triggering_observation_id, created_at, status,
            dismissal_reason, dismissed_by, dismissed_at, confidence, reference_ids,
            dismissed_fingerprint, severity_score)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        f.id,
        f.patientId,
        f.flagType,
        f.urgency,
        f.reasoning,
        f.recommendedAction,
        f.triggeringEncounterId,
        f.triggeringObservationId,
        f.createdAt,
        f.status,
        f.dismissalReason,
        f.dismissedBy,
        f.dismissedAt,
        f.confidence,
        toJson(f.referenceIds),
        f.dismissedFingerprint,
        f.severityScore,
      );
  },

  dismiss(
    flagId: string,
    reason: DismissalReason,
    clinicianId: string,
    fingerprint: string,
    note = '',
  ): void {
    db()
      .prepare(
        `UPDATE risk_flag SET status = 'dismissed', dismissal_reason = ?, dismissal_note = ?,
           dismissed_by = ?, dismissed_at = ?, dismissed_fingerprint = ? WHERE id = ?`,
      )
      .run(reason, note || null, clinicianId, now(), fingerprint, flagId);
  },

  resolve(flagId: string): void {
    db().prepare("UPDATE risk_flag SET status = 'resolved' WHERE id = ?").run(flagId);
  },

  /** Clears active flags before a fresh assessment writes its replacements. */
  /** Every active flag across one clinician's population, worst urgency first. */
  activeForClinician(clinicianId: string): RiskFlag[] {
    return (
      db()
        .prepare(
          `SELECT f.* FROM risk_flag f
             JOIN patient p ON p.id = f.patient_id
            WHERE p.clinician_id = ? AND f.status = 'active'
            ORDER BY f.created_at DESC`,
        )
        .all(clinicianId) as Row[]
    ).map(toFlag);
  },

  clearActiveForPatient(patientId: string): void {
    db().prepare("DELETE FROM risk_flag WHERE patient_id = ? AND status = 'active'").run(patientId);
  },
};

/* --------------------------------------------------- documentation alert -- */

export const alerts = {
  openForPatient(patientId: string): DocumentationAlert[] {
    return (
      db()
        .prepare("SELECT * FROM documentation_alert WHERE patient_id = ? AND status = 'open' ORDER BY created_at DESC")
        .all(patientId) as Row[]
    ).map(toAlert);
  },

  allForPatient(patientId: string): DocumentationAlert[] {
    return (
      db()
        .prepare('SELECT * FROM documentation_alert WHERE patient_id = ? ORDER BY created_at DESC')
        .all(patientId) as Row[]
    ).map(toAlert);
  },

  byId(alertId: string): DocumentationAlert | null {
    const r = db().prepare('SELECT * FROM documentation_alert WHERE id = ?').get(alertId) as Row | undefined;
    return r ? toAlert(r) : null;
  },

  /**
   * A4-4: the unique index on (patient_id, gap_key) means the same gap raised on
   * a later encounter is ignored rather than duplicated.
   */
  insertIfNew(a: DocumentationAlert): boolean {
    const result = db()
      .prepare(
        `INSERT OR IGNORE INTO documentation_alert
           (id, patient_id, encounter_id, gap_type, description, resolution, status,
            resolved_by, resolved_at, created_at, gap_key)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        a.id,
        a.patientId,
        a.encounterId,
        a.gapType,
        a.description,
        toJson(a.resolution),
        a.status,
        a.resolvedBy,
        a.resolvedAt,
        a.createdAt,
        a.gapKey,
      );
    return result.changes > 0;
  },

  /**
   * Close an alert, recording which route closed it.
   *
   * 'automatic' means the system carried out the resolution; 'manual' means the
   * clinician had already done it; 'declined' means they judged it should not be
   * done. All three leave status 'resolved' — the gap is off the working list —
   * but the route is what lets the record show the difference between work done
   * and work refused, which an auditor will want and a clinician will need.
   */
  close(
    alertId: string,
    clinicianId: string,
    route: NonNullable<DocumentationAlert['route']>,
    note: string | null = null,
  ): void {
    db()
      .prepare(
        `UPDATE documentation_alert
            SET status = 'resolved', resolved_by = ?, resolved_at = ?,
                resolution_route = ?, resolution_note = ?
          WHERE id = ?`,
      )
      .run(clinicianId, now(), route, note, alertId);
  },

  /** Closed gaps, newest first — the record of what was done and what was refused. */
  closedForPatient(patientId: string): DocumentationAlert[] {
    return (
      db()
        .prepare(
          "SELECT * FROM documentation_alert WHERE patient_id = ? AND status = 'resolved' ORDER BY resolved_at DESC",
        )
        .all(patientId) as Row[]
    ).map(toAlert);
  },

  openCount(patientId: string): number {
    const r = db()
      .prepare("SELECT COUNT(*) AS n FROM documentation_alert WHERE patient_id = ? AND status = 'open'")
      .get(patientId) as { n: number };
    return r.n;
  },
};

/* --------------------------------------------------------- order/billing -- */

export const orders = {
  forPatient(patientId: string): Order[] {
    return (
      db().prepare('SELECT * FROM "order" WHERE patient_id = ? ORDER BY ordered_at DESC').all(patientId) as Row[]
    ).map(toOrder);
  },

  byId(orderId: string): Order | null {
    const r = db().prepare('SELECT * FROM "order" WHERE id = ?').get(orderId) as Row | undefined;
    return r ? toOrder(r) : null;
  },

  insert(o: Order): void {
    db()
      .prepare(
        `INSERT INTO "order"
           (id, patient_id, encounter_id, order_type, what, status, ordered_by,
            ordered_at, completed_at, from_alert_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        o.id,
        o.patientId,
        o.encounterId,
        o.orderType,
        o.what,
        o.status,
        o.orderedBy,
        o.orderedAt,
        o.completedAt,
        o.fromAlertId,
      );
  },

  complete(orderId: string): void {
    db()
      .prepare("UPDATE \"order\" SET status = 'completed', completed_at = ? WHERE id = ?")
      .run(now(), orderId);
  },
};

export const billing = {
  forPatient(patientId: string): BillingEntry[] {
    return (
      db().prepare('SELECT * FROM billing_entry WHERE patient_id = ? ORDER BY created_at DESC').all(patientId) as Row[]
    ).map(toBilling);
  },

  forEncounter(encounterId: string): BillingEntry[] {
    return (
      db().prepare('SELECT * FROM billing_entry WHERE encounter_id = ?').all(encounterId) as Row[]
    ).map(toBilling);
  },

  insert(b: BillingEntry): void {
    db()
      .prepare(
        `INSERT INTO billing_entry
           (id, patient_id, encounter_id, code, description, status, from_order_id, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(b.id, b.patientId, b.encounterId, b.code, b.description, b.status, b.fromOrderId, b.createdAt);
  },
};

/* ------------------------------------------------------------- agent run -- */

export const runs = {
  start(input: {
    agent: AgentRun['agent'];
    trigger: AgentRun['trigger'];
    patientId?: string | null;
    encounterId?: string | null;
    correlationId: string;
    inputSummary: string;
  }): string {
    const runId = id('run');
    // Counted before this row is inserted, so the value is the number of other
    // agents already in flight, plus this one. See the schema comment on OR-1.
    const inFlight = db()
      .prepare("SELECT COUNT(*) AS n FROM agent_run WHERE outcome = 'running'")
      .get() as { n: number };

    db()
      .prepare(
        `INSERT INTO agent_run
           (id, agent, trigger, patient_id, encounter_id, correlation_id, started_at,
            input_summary, outcome, concurrency_at_start)
         VALUES (?,?,?,?,?,?,?,?,'running',?)`,
      )
      .run(
        runId,
        input.agent,
        input.trigger,
        input.patientId ?? null,
        input.encounterId ?? null,
        input.correlationId,
        new Date().toISOString(),
        input.inputSummary,
        inFlight.n + 1,
      );
    return runId;
  },

  finish(runId: string, outcome: 'success' | 'failure', outputSummary: string, error?: string): void {
    const row = db().prepare('SELECT started_at FROM agent_run WHERE id = ?').get(runId) as
      | { started_at: string }
      | undefined;
    const completedAt = new Date().toISOString();
    const durationMs = row ? new Date(completedAt).getTime() - new Date(row.started_at).getTime() : null;

    db()
      .prepare(
        `UPDATE agent_run SET completed_at = ?, duration_ms = ?, output_summary = ?,
           outcome = ?, error_message = ? WHERE id = ?`,
      )
      .run(completedAt, durationMs, outputSummary, outcome, error ?? null, runId);
  },

  /**
   * One page of the run log, searched across the whole table.
   *
   * Searching in the browser over a fetched slice looks identical to searching
   * properly until the log outgrows the slice — and then it quietly stops
   * finding things, which is worse than not offering search at all. The filter
   * belongs where all the rows are.
   */
  page(options: {
    agent?: string;
    outcome?: string;
    search?: string;
    page: number;
    pageSize: number;
  }): { runs: AgentRun[]; total: number } {
    const where: string[] = [];
    const args: unknown[] = [];

    if (options.agent) {
      where.push('agent = ?');
      args.push(options.agent);
    }
    if (options.outcome) {
      where.push('outcome = ?');
      args.push(options.outcome);
    }
    if (options.search) {
      /*
       * Every column the run detail puts on screen. Searching a narrower set
       * than the screen displays produces the strangest possible result — the
       * clinician is reading the words, typing them in, and being told there
       * are no matches — so the two lists are kept the same on purpose.
       */
      const columns = [
        'agent',
        'trigger',
        'patient_id',
        'outcome',
        'correlation_id',
        'input_summary',
        'output_summary',
        'error_message',
      ];
      where.push(`(${columns.map((column) => `COALESCE(${column}, '') LIKE ?`).join(' OR ')})`);
      const like = `%${options.search}%`;
      args.push(...columns.map(() => like));
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const counted = db().prepare(`SELECT COUNT(*) AS n FROM agent_run ${clause}`).get(...args) as Row;
    const total = (counted['n'] as number) ?? 0;

    // Counted first so the page can be clamped before it reaches OFFSET.
    // Clamping only the number reported back produces the worst of both: the
    // pager says "page 4 of 4" while the query looks past the end and returns
    // nothing, so the screen shows a valid page with no rows on it.
    const { page } = pageMeta(total, options.page, options.pageSize);
    const rows = db()
      .prepare(`SELECT * FROM agent_run ${clause} ORDER BY started_at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...args, options.pageSize, (page - 1) * options.pageSize) as Row[];

    return { runs: rows.map(toRun), total };
  },

  recent(limit = 100, agent?: AgentRun['agent']): AgentRun[] {
    const rows = agent
      ? (db()
          .prepare('SELECT * FROM agent_run WHERE agent = ? ORDER BY started_at DESC LIMIT ?')
          .all(agent, limit) as Row[])
      : (db().prepare('SELECT * FROM agent_run ORDER BY started_at DESC LIMIT ?').all(limit) as Row[]);
    return rows.map(toRun);
  },

  byCorrelation(correlationId: string): AgentRun[] {
    return (
      db().prepare('SELECT * FROM agent_run WHERE correlation_id = ? ORDER BY started_at').all(correlationId) as Row[]
    ).map(toRun);
  },
};

/* -------------------------------------------------------- population run -- */

export const populationRuns = {
  start(clinicianId: string): string {
    const runId = id('poprun');
    db()
      .prepare("INSERT INTO population_run (id, clinician_id, started_at, outcome) VALUES (?,?,?,'running')")
      .run(runId, clinicianId, now());
    return runId;
  },

  finish(runId: string, outcome: 'success' | 'partial' | 'failure', assessed: number, detail?: string): void {
    db()
      .prepare(
        'UPDATE population_run SET completed_at = ?, outcome = ?, patients_assessed = ?, detail = ? WHERE id = ?',
      )
      .run(now(), outcome, assessed, detail ?? null, runId);
  },

  last(clinicianId: string): { completedAt: string; outcome: 'success' | 'partial' | 'failure' } | null {
    const r = db()
      .prepare(
        `SELECT completed_at, outcome FROM population_run
         WHERE clinician_id = ? AND completed_at IS NOT NULL
         ORDER BY completed_at DESC LIMIT 1`,
      )
      .get(clinicianId) as { completed_at: string; outcome: string } | undefined;
    if (!r) return null;
    return { completedAt: r.completed_at, outcome: r.outcome as 'success' | 'partial' | 'failure' };
  },
};

/* ------------------------------------------------------------- settings -- */

export const settings = {
  raw(key: string): unknown {
    const r = db().prepare('SELECT value FROM setting WHERE key = ?').get(key) as Row | undefined;
    return r ? fromJson<unknown>(r['value'] as string, null) : null;
  },

  put(key: string, value: unknown, updatedBy: string): void {
    db()
      .prepare(
        `INSERT INTO setting (key, value, updated_at, updated_by) VALUES (?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                        updated_at = excluded.updated_at,
                                        updated_by = excluded.updated_by`,
      )
      .run(key, toJson(value), now(), updatedBy);
  },

  remove(key: string): void {
    db().prepare('DELETE FROM setting WHERE key = ?').run(key);
  },

  updatedAt(): string | null {
    const r = db()
      .prepare('SELECT MAX(updated_at) AS at FROM setting')
      .get() as Row | undefined;
    return (r?.['at'] as string | null) ?? null;
  },
};

/* ---------------------------------------------------------------- audit -- */

function toAudit(r: Row): AuditEvent {
  return {
    id: r['id'] as string,
    at: r['at'] as string,
    actor: r['actor'] as string,
    actorName: r['actor_name'] as string,
    action: r['action'] as string,
    entityType: r['entity_type'] as string,
    entityId: (r['entity_id'] as string | null) ?? null,
    patientId: (r['patient_id'] as string | null) ?? null,
    summary: r['summary'] as string,
    detail: fromJson<Record<string, unknown>>(r['detail'] as string, {}),
  };
}

export const audit = {
  /**
   * Append one event. Never throws into the caller: an audit write failing must
   * not roll back the clinical action it was describing, but it must be loud in
   * the log so the gap is visible.
   */
  record(event: {
    actor: string;
    actorName: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    patientId?: string | null;
    summary: string;
    detail?: Record<string, unknown>;
  }): void {
    try {
      const conn = db();
      const rowId = id('aud');
      const at = now();
      const detail = toJson(event.detail ?? {});

      const previous = conn
        .prepare('SELECT hash FROM audit_event ORDER BY rowid DESC LIMIT 1')
        .get() as Row | undefined;
      const prevHash = (previous?.['hash'] as string | null) ?? '';

      // Everything that matters is hashed. A field left out of this is a field
      // that can be edited without breaking the chain.
      const hash = createHash('sha256')
        .update(
          [
            prevHash,
            rowId,
            at,
            event.actor,
            event.actorName,
            event.action,
            event.entityType,
            event.entityId ?? '',
            event.patientId ?? '',
            event.summary,
            detail,
          ].join('\u0000'),
        )
        .digest('hex');

      conn
        .prepare(
          `INSERT INTO audit_event
             (id, at, actor, actor_name, action, entity_type, entity_id, patient_id, summary,
              detail, prev_hash, hash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          rowId,
          at,
          event.actor,
          event.actorName,
          event.action,
          event.entityType,
          event.entityId ?? null,
          event.patientId ?? null,
          event.summary,
          detail,
          prevHash,
          hash,
        );
    } catch (error) {
      console.error('AUDIT WRITE FAILED', event.action, error);
    }
  },

  /**
   * Walks the chain and reports the first row whose hash does not follow.
   *
   * Rows written before hashing existed have no hash and are skipped rather
   * than reported — an upgrade is not tampering, and crying wolf about it would
   * teach people to ignore the check.
   */
  verify(): { ok: boolean; checked: number; brokenAt: string | null; brokenSummary: string | null } {
    const rows = db()
      .prepare('SELECT * FROM audit_event ORDER BY rowid ASC')
      .all() as Row[];

    let previousHash = '';
    let checked = 0;

    for (const r of rows) {
      const stored = r['hash'] as string | null;
      if (!stored) {
        // Pre-hash row: adopt whatever it recorded so later rows still verify.
        previousHash = '';
        continue;
      }

      const expected = createHash('sha256')
        .update(
          [
            (r['prev_hash'] as string | null) ?? '',
            r['id'],
            r['at'],
            r['actor'],
            r['actor_name'],
            r['action'],
            r['entity_type'],
            (r['entity_id'] as string | null) ?? '',
            (r['patient_id'] as string | null) ?? '',
            r['summary'],
            r['detail'],
          ].join('\u0000'),
        )
        .digest('hex');

      const linkOk = ((r['prev_hash'] as string | null) ?? '') === previousHash || previousHash === '';
      if (expected !== stored || !linkOk) {
        return {
          ok: false,
          checked,
          brokenAt: r['at'] as string,
          brokenSummary: r['summary'] as string,
        };
      }

      previousHash = stored;
      checked += 1;
    }

    return { ok: true, checked, brokenAt: null, brokenSummary: null };
  },

  recent(limit = 200, filter: { action?: string; patientId?: string } = {}): AuditEvent[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.action) {
      // Prefix match so 'patient' selects patient.created and patient.updated.
      where.push('action LIKE ?');
      args.push(`${filter.action}%`);
    }
    if (filter.patientId) {
      where.push('patient_id = ?');
      args.push(filter.patientId);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    return (
      db()
        .prepare(`SELECT * FROM audit_event ${clause} ORDER BY at DESC LIMIT ?`)
        .all(...args, limit) as Row[]
    ).map(toAudit);
  },

  /** One page of the trail, newest first, with the count it was drawn from. */
  page(options: {
    action?: string;
    patientId?: string;
    search?: string;
    page: number;
    pageSize: number;
  }): { events: AuditEvent[]; total: number } {
    const where: string[] = [];
    const args: unknown[] = [];

    if (options.action) {
      where.push('action LIKE ?');
      args.push(`${options.action}%`);
    }
    if (options.patientId) {
      where.push('patient_id = ?');
      args.push(options.patientId);
    }
    if (options.search) {
      // Same rule as the run log: search what the row shows. The action is a
      // visible tag on every entry, so typing one has to find it, even though
      // the dropdown beside the box filters by it too.
      const columns = ['summary', 'actor_name', 'action'];
      where.push(`(${columns.map((column) => `COALESCE(${column}, '') LIKE ?`).join(' OR ')})`);
      const like = `%${options.search}%`;
      args.push(...columns.map(() => like));
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const counted = db()
      .prepare(`SELECT COUNT(*) AS n FROM audit_event ${clause}`)
      .get(...args) as Row;
    const total = (counted['n'] as number) ?? 0;

    // Clamped against the count before it reaches OFFSET — see runs.page.
    const { page } = pageMeta(total, options.page, options.pageSize);
    const rows = db()
      .prepare(`SELECT * FROM audit_event ${clause} ORDER BY at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...args, options.pageSize, (page - 1) * options.pageSize) as Row[];

    return { events: rows.map(toAudit), total };
  },

  actions(): string[] {
    return (
      db().prepare('SELECT DISTINCT action FROM audit_event ORDER BY action').all() as Row[]
    ).map((r) => r['action'] as string);
  },

  total(): number {
    const r = db().prepare('SELECT COUNT(*) AS n FROM audit_event').get() as Row;
    return (r['n'] as number) ?? 0;
  },
};

/* -------------------------------------------------------- pronunciation -- */

function toPronunciation(r: Row): Pronunciation {
  return {
    id: r['id'] as string,
    clinicianId: r['clinician_id'] as string,
    term: r['term'] as string,
    heardAs: fromJson<string[]>(r['heard_as'] as string, []),
    category: r['category'] as string,
    sampleCount: (r['sample_count'] as number) ?? 0,
    createdAt: r['created_at'] as string,
    updatedAt: r['updated_at'] as string,
  };
}

export const pronunciations = {
  forClinician(clinicianId: string): Pronunciation[] {
    return (
      db()
        .prepare('SELECT * FROM pronunciation WHERE clinician_id = ? ORDER BY term')
        .all(clinicianId) as Row[]
    ).map(toPronunciation);
  },

  byId(pronunciationId: string): Pronunciation | null {
    const r = db()
      .prepare('SELECT * FROM pronunciation WHERE id = ?')
      .get(pronunciationId) as Row | undefined;
    return r ? toPronunciation(r) : null;
  },

  /**
   * Add a term, or fold another mishearing into the one already stored.
   * Recording the same term twice must not create a second row, or the
   * correction pass would have two competing entries for one word.
   */
  upsert(clinicianId: string, term: string, heard: string, category: string): Pronunciation {
    const existing = db()
      .prepare('SELECT * FROM pronunciation WHERE clinician_id = ? AND term = ?')
      .get(clinicianId, term) as Row | undefined;

    if (existing) {
      const heardAs = fromJson<string[]>(existing['heard_as'] as string, []);
      const cleaned = heard.trim().toLowerCase();
      // A sample that came back correct is still a sample, but adds no mapping.
      if (cleaned && cleaned !== term.toLowerCase() && !heardAs.includes(cleaned)) {
        heardAs.push(cleaned);
      }
      db()
        .prepare(
          `UPDATE pronunciation
              SET heard_as = ?, sample_count = sample_count + 1, category = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(toJson(heardAs), category, now(), existing['id']);
      return pronunciations.byId(existing['id'] as string)!;
    }

    const record: Pronunciation = {
      id: id('pron'),
      clinicianId,
      term,
      heardAs:
        heard.trim() && heard.trim().toLowerCase() !== term.toLowerCase()
          ? [heard.trim().toLowerCase()]
          : [],
      category,
      sampleCount: heard.trim() ? 1 : 0,
      createdAt: now(),
      updatedAt: now(),
    };
    db()
      .prepare(
        `INSERT INTO pronunciation
           (id, clinician_id, term, heard_as, category, sample_count, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        record.id,
        record.clinicianId,
        record.term,
        toJson(record.heardAs),
        record.category,
        record.sampleCount,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  },

  remove(pronunciationId: string): void {
    db().prepare('DELETE FROM pronunciation WHERE id = ?').run(pronunciationId);
  },
};

/* ------------------------------------------------------- clinical wipe -- */

/**
 * Removes every clinical record, leaving the installation itself intact.
 *
 * Used when a clinic finishes evaluating on the demo population and starts
 * entering real patients. The fictional records have to go — the alternative is
 * fictional and real patients sitting in one database looking identical, which
 * is the failure this system is built to avoid.
 *
 * Deliberately kept: the clinician account, the clinic profile and branding,
 * settings, voice training, and the audit trail. The audit trail especially —
 * a record of what happened that can be erased by the thing it records is not
 * an audit trail.
 */
export function wipeClinicalData(): { removed: Record<string, number> } {
  const conn = db();
  // Children before parents. A foreign key violation here would abort the
  // transaction and leave the clinic stuck between two modes.
  const tables = [
    'billing_entry',
    '"order"',
    'documentation_alert',
    'risk_flag',
    'observation',
    'encounter',
    'patient',
    'population_run',
    'agent_run',
    'model_call',
    'agent_cache',
  ];

  const removed: Record<string, number> = {};
  const wipe = conn.transaction(() => {
    for (const table of tables) {
      const before = (conn.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Row)['n'] as number;
      conn.prepare(`DELETE FROM ${table}`).run();
      if (before > 0) removed[table.replace(/"/g, '')] = before;
    }
  });
  wipe();

  return { removed };
}

/* ------------------------------------------------------------ operations -- */

/**
 * Today, as an ISO date. Kept here so every operations query agrees on what
 * "this month" and "overdue" mean within a single request.
 */
function today(): string {
  return now().slice(0, 10);
}

function toProduct(r: Row): Product {
  return {
    id: r['id'] as string,
    name: r['name'] as string,
    sku: r['sku'] as string,
    barcode: r['barcode'] as string,
    kind: r['kind'] as Product['kind'],
    category: r['category'] as string,
    priceCents: r['price_cents'] as number,
    stock: r['stock'] as number,
    reorderPoint: r['reorder_point'] as number,
    archived: toBool(r['archived'] as number),
    createdAt: r['created_at'] as string,
    updatedAt: r['updated_at'] as string,
  };
}

export const products = {
  /**
   * Filter and sort the whole catalogue, then take a page from the result.
   *
   * Same rule as every other list in this codebase: paging before filtering
   * gives a search that only ever finds what happened to be on screen.
   */
  page(options: {
    search?: string;
    kind?: string;
    includeArchived?: boolean;
    page: number;
    pageSize: number;
  }): { items: Product[]; total: number } {
    const where: string[] = [];
    const args: unknown[] = [];

    if (!options.includeArchived) where.push('archived = 0');
    if (options.kind) {
      where.push('kind = ?');
      args.push(options.kind);
    }
    if (options.search) {
      // Everything the table displays, so what is readable is searchable.
      const columns = ['name', 'sku', 'barcode', 'category'];
      where.push(`(${columns.map((c) => `COALESCE(${c}, '') LIKE ?`).join(' OR ')})`);
      const like = `%${options.search}%`;
      args.push(...columns.map(() => like));
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const counted = db().prepare(`SELECT COUNT(*) AS n FROM product ${clause}`).get(...args) as Row;
    const total = (counted['n'] as number) ?? 0;

    // Clamped against the count before it reaches OFFSET — a page number the
    // query cannot fill renders as "page 4 of 4" above an empty table.
    const { page } = pageMeta(total, options.page, options.pageSize);
    const rows = db()
      .prepare(`SELECT * FROM product ${clause} ORDER BY archived, name COLLATE NOCASE LIMIT ? OFFSET ?`)
      .all(...args, options.pageSize, (page - 1) * options.pageSize) as Row[];

    return { items: rows.map(toProduct), total };
  },

  byId(productId: string): Product | null {
    const r = db().prepare('SELECT * FROM product WHERE id = ?').get(productId) as Row | undefined;
    return r ? toProduct(r) : null;
  },

  /** Items at or below their reorder point. Services are never low. */
  lowStock(): Product[] {
    return (
      db()
        .prepare(
          `SELECT * FROM product
            WHERE archived = 0 AND kind <> 'service'
              AND reorder_point > 0 AND stock <= reorder_point
            ORDER BY stock - reorder_point`,
        )
        .all() as Row[]
    ).map(toProduct);
  },

  insert(p: Product): void {
    db()
      .prepare(
        `INSERT INTO product
           (id, name, sku, barcode, kind, category, price_cents, stock,
            reorder_point, archived, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.id, p.name, p.sku, p.barcode, p.kind, p.category, p.priceCents,
        p.stock, p.reorderPoint, p.archived ? 1 : 0, p.createdAt, p.updatedAt,
      );
  },

  update(productId: string, patch: Partial<Product>): void {
    const current = products.byId(productId);
    if (!current) return;
    const next = { ...current, ...patch };
    db()
      .prepare(
        `UPDATE product SET name=?, sku=?, barcode=?, kind=?, category=?,
                price_cents=?, stock=?, reorder_point=?, archived=?, updated_at=?
          WHERE id = ?`,
      )
      .run(
        next.name, next.sku, next.barcode, next.kind, next.category,
        next.priceCents, next.stock, next.reorderPoint, next.archived ? 1 : 0,
        now(), productId,
      );
  },
};

function toInvoiceLine(r: Row): InvoiceLine {
  return {
    id: r['id'] as string,
    invoiceId: r['invoice_id'] as string,
    productId: (r['product_id'] as string | null) ?? null,
    billingEntryId: (r['billing_entry_id'] as string | null) ?? null,
    description: r['description'] as string,
    quantity: r['quantity'] as number,
    unitPriceCents: r['unit_price_cents'] as number,
  };
}

function toInvoice(r: Row, asOf: string): Invoice {
  const status = r['status'] as Invoice['status'];
  const dueOn = r['due_on'] as string;
  return {
    id: r['id'] as string,
    number: r['number'] as string,
    kind: r['kind'] as Invoice['kind'],
    contactName: r['contact_name'] as string,
    patientId: (r['patient_id'] as string | null) ?? null,
    issuedOn: r['issued_on'] as string,
    dueOn,
    paidOn: (r['paid_on'] as string | null) ?? null,
    amountCents: r['amount_cents'] as number,
    status,
    // Derived rather than stored: an invoice becomes overdue by the calendar
    // moving, not by anybody opening the screen, so a stored flag would be
    // wrong every night until something happened to refresh it.
    overdue: status === 'sent' && dueOn < asOf,
    notes: r['notes'] as string,
    createdAt: r['created_at'] as string,
    updatedAt: r['updated_at'] as string,
  };
}

export const invoices = {
  page(options: {
    search?: string;
    kind?: string;
    /** Accepts the derived 'overdue' as well as the stored statuses. */
    status?: string;
    page: number;
    pageSize: number;
  }): { items: Invoice[]; total: number } {
    const asOf = today();
    const where: string[] = [];
    const args: unknown[] = [];

    if (options.kind) {
      where.push('kind = ?');
      args.push(options.kind);
    }
    if (options.status === 'overdue') {
      where.push("status = 'sent' AND due_on < ?");
      args.push(asOf);
    } else if (options.status) {
      where.push('status = ?');
      args.push(options.status);
    }
    if (options.search) {
      const columns = ['number', 'contact_name', 'notes'];
      where.push(`(${columns.map((c) => `COALESCE(${c}, '') LIKE ?`).join(' OR ')})`);
      const like = `%${options.search}%`;
      args.push(...columns.map(() => like));
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const counted = db().prepare(`SELECT COUNT(*) AS n FROM invoice ${clause}`).get(...args) as Row;
    const total = (counted['n'] as number) ?? 0;

    const { page } = pageMeta(total, options.page, options.pageSize);
    const rows = db()
      .prepare(`SELECT * FROM invoice ${clause} ORDER BY issued_on DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...args, options.pageSize, (page - 1) * options.pageSize) as Row[];

    return { items: rows.map((r) => toInvoice(r, asOf)), total };
  },

  byId(invoiceId: string): Invoice | null {
    const r = db().prepare('SELECT * FROM invoice WHERE id = ?').get(invoiceId) as Row | undefined;
    if (!r) return null;
    const invoice = toInvoice(r, today());
    invoice.lines = (
      db().prepare('SELECT * FROM invoice_line WHERE invoice_id = ? ORDER BY rowid').all(invoiceId) as Row[]
    ).map(toInvoiceLine);
    return invoice;
  },

  /**
   * The next reference, as INV-0001. Derived from the highest existing number
   * rather than a count, so voiding an invoice never causes a reference to be
   * handed out twice.
   */
  nextNumber(): string {
    const r = db()
      .prepare("SELECT number FROM invoice WHERE number LIKE 'INV-%' ORDER BY number DESC LIMIT 1")
      .get() as Row | undefined;
    const last = r ? Number.parseInt(String(r['number']).slice(4), 10) : 0;
    return `INV-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
  },

  insert(invoice: Invoice, lines: InvoiceLine[]): void {
    const conn = db();
    const write = conn.transaction(() => {
      conn
        .prepare(
          `INSERT INTO invoice
             (id, number, kind, contact_name, patient_id, issued_on, due_on,
              paid_on, amount_cents, status, notes, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          invoice.id, invoice.number, invoice.kind, invoice.contactName,
          invoice.patientId, invoice.issuedOn, invoice.dueOn, invoice.paidOn,
          invoice.amountCents, invoice.status, invoice.notes,
          invoice.createdAt, invoice.updatedAt,
        );
      for (const line of lines) {
        conn
          .prepare(
            `INSERT INTO invoice_line
               (id, invoice_id, product_id, billing_entry_id, description, quantity, unit_price_cents)
             VALUES (?,?,?,?,?,?,?)`,
          )
          .run(
            line.id, invoice.id, line.productId, line.billingEntryId,
            line.description, line.quantity, line.unitPriceCents,
          );
      }
    });
    // One transaction: an invoice whose lines failed to write would show a
    // total that its own detail cannot account for.
    write();
  },

  setStatus(invoiceId: string, status: Invoice['status'], paidOn: string | null): void {
    db()
      .prepare('UPDATE invoice SET status = ?, paid_on = ?, updated_at = ? WHERE id = ?')
      .run(status, paidOn, now(), invoiceId);
  },

  /** The three figures on the Invoice Manager cards. Money owed to the clinic. */
  summary(): InvoiceSummary {
    const asOf = today();
    const month = asOf.slice(0, 7);
    const row = db()
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'sent' THEN amount_cents END), 0) AS outstanding,
           COALESCE(SUM(CASE WHEN status = 'sent' AND due_on < ? THEN 1 END), 0) AS overdueCount,
           COALESCE(SUM(CASE WHEN status = 'sent' AND due_on < ? THEN amount_cents END), 0) AS overdue,
           COALESCE(SUM(CASE WHEN status = 'paid' AND substr(paid_on, 1, 7) = ? THEN amount_cents END), 0) AS collected
         FROM invoice WHERE kind = 'patient'`,
      )
      .get(asOf, asOf, month) as Row;

    return {
      outstandingCents: row['outstanding'] as number,
      overdueCount: row['overdueCount'] as number,
      overdueCents: row['overdue'] as number,
      collectedThisMonthCents: row['collected'] as number,
    };
  },
};

function toExpense(r: Row): Expense {
  return {
    id: r['id'] as string,
    incurredOn: r['incurred_on'] as string,
    description: r['description'] as string,
    category: r['category'] as Expense['category'],
    reference: r['reference'] as string,
    amountCents: r['amount_cents'] as number,
    createdAt: r['created_at'] as string,
    updatedAt: r['updated_at'] as string,
  };
}

export const expenses = {
  page(options: {
    search?: string;
    category?: string;
    page: number;
    pageSize: number;
  }): { items: Expense[]; total: number } {
    const where: string[] = [];
    const args: unknown[] = [];

    if (options.category) {
      where.push('category = ?');
      args.push(options.category);
    }
    if (options.search) {
      const columns = ['description', 'reference', 'category'];
      where.push(`(${columns.map((c) => `COALESCE(${c}, '') LIKE ?`).join(' OR ')})`);
      const like = `%${options.search}%`;
      args.push(...columns.map(() => like));
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const counted = db().prepare(`SELECT COUNT(*) AS n FROM expense ${clause}`).get(...args) as Row;
    const total = (counted['n'] as number) ?? 0;

    const { page } = pageMeta(total, options.page, options.pageSize);
    const rows = db()
      .prepare(`SELECT * FROM expense ${clause} ORDER BY incurred_on DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...args, options.pageSize, (page - 1) * options.pageSize) as Row[];

    return { items: rows.map(toExpense), total };
  },

  byId(expenseId: string): Expense | null {
    const r = db().prepare('SELECT * FROM expense WHERE id = ?').get(expenseId) as Row | undefined;
    return r ? toExpense(r) : null;
  },

  insert(e: Expense): void {
    db()
      .prepare(
        `INSERT INTO expense
           (id, incurred_on, description, category, reference, amount_cents, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(e.id, e.incurredOn, e.description, e.category, e.reference, e.amountCents, e.createdAt, e.updatedAt);
  },

  remove(expenseId: string): void {
    db().prepare('DELETE FROM expense WHERE id = ?').run(expenseId);
  },

  summary(): ExpenseSummary {
    const asOf = today();
    const row = db()
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN substr(incurred_on,1,7) = ? THEN amount_cents END), 0) AS month,
           COALESCE(SUM(CASE WHEN substr(incurred_on,1,7) = ? THEN 1 END), 0) AS monthCount,
           COALESCE(SUM(CASE WHEN substr(incurred_on,1,4) = ? THEN amount_cents END), 0) AS year,
           COUNT(*) AS total
         FROM expense`,
      )
      .get(asOf.slice(0, 7), asOf.slice(0, 7), asOf.slice(0, 4)) as Row;

    return {
      thisMonthCents: row['month'] as number,
      thisMonthCount: row['monthCount'] as number,
      thisYearCents: row['year'] as number,
      totalCount: row['total'] as number,
    };
  },
};

/* ---------------------------------------------------- occupational health -- */

function toHse(r: Row, patientName: string, patientDob: string): HseReport {
  return {
    id: r['id'] as string,
    patientId: r['patient_id'] as string,
    patientName,
    patientDob,
    createdBy: r['created_by'] as string,
    examinedOn: r['examined_on'] as string,
    recipient: fromJson<HseRecipient>(r['recipient'] as string, { attention: '', company: '', addressLines: [] }),
    findings: fromJson<HseFindings>(r['findings'] as string, HSE_DEFAULTS),
    recommendation: fromJson<HseRecommendation>(r['recommendation'] as string, {
      decision: 'fit', restrictions: '', notes: '', reviewIntervalMonths: 12,
    }),
    status: r['status'] as HseReport['status'],
    signedBy: (r['signed_by'] as string | null) ?? null,
    signedAt: (r['signed_at'] as string | null) ?? null,
    signature: (r['signature'] as string | null) ?? null,
    signerName: (r['signer_name'] as string) ?? '',
    signerCredentials: (r['signer_credentials'] as string) ?? '',
    createdAt: r['created_at'] as string,
    updatedAt: r['updated_at'] as string,
  };
}

/** Patient identity is joined in rather than copied, so a corrected name shows. */
function hseWithPatient(r: Row): HseReport {
  const p = db().prepare('SELECT name, profile FROM patient WHERE id = ?').get(r['patient_id']) as Row | undefined;
  const profile = fromJson<PatientProfile>((p?.['profile'] as string) ?? '{}', EMPTY_PROFILE);
  return toHse(r, (p?.['name'] as string) ?? 'Unknown patient', profile.dateOfBirth ?? '');
}

export const hseReports = {
  page(options: { search?: string; status?: string; page: number; pageSize: number }): {
    items: HseReport[];
    total: number;
  } {
    const where: string[] = [];
    const args: unknown[] = [];

    if (options.status) {
      where.push('r.status = ?');
      args.push(options.status);
    }
    if (options.search) {
      where.push('(p.name LIKE ? OR r.examined_on LIKE ? OR r.recipient LIKE ?)');
      const like = `%${options.search}%`;
      args.push(like, like, like);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const counted = db()
      .prepare(`SELECT COUNT(*) AS n FROM hse_report r JOIN patient p ON p.id = r.patient_id ${clause}`)
      .get(...args) as Row;
    const total = (counted['n'] as number) ?? 0;

    const { page } = pageMeta(total, options.page, options.pageSize);
    const rows = db()
      .prepare(
        `SELECT r.* FROM hse_report r JOIN patient p ON p.id = r.patient_id ${clause}
          ORDER BY r.examined_on DESC, r.rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, options.pageSize, (page - 1) * options.pageSize) as Row[];

    return { items: rows.map(hseWithPatient), total };
  },

  byId(reportId: string): HseReport | null {
    const r = db().prepare('SELECT * FROM hse_report WHERE id = ?').get(reportId) as Row | undefined;
    return r ? hseWithPatient(r) : null;
  },

  insert(report: HseReport): void {
    db()
      .prepare(
        `INSERT INTO hse_report
           (id, patient_id, created_by, examined_on, recipient, findings, recommendation,
            status, signed_by, signed_at, signature, signer_name, signer_credentials,
            created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        report.id, report.patientId, report.createdBy, report.examinedOn,
        toJson(report.recipient), toJson(report.findings), toJson(report.recommendation),
        report.status, report.signedBy, report.signedAt, report.signature,
        report.signerName, report.signerCredentials, report.createdAt, report.updatedAt,
      );
  },

  /**
   * Saves a draft. An approved report is immutable: it has been signed and may
   * already be with an employer, so changing it would make the copy on file and
   * the copy in the clinic disagree with nobody able to tell which is current.
   */
  update(reportId: string, patch: Pick<HseReport, 'examinedOn' | 'recipient' | 'findings' | 'recommendation'>): boolean {
    const result = db()
      .prepare(
        `UPDATE hse_report
            SET examined_on = ?, recipient = ?, findings = ?, recommendation = ?, updated_at = ?
          WHERE id = ? AND status = 'draft'`,
      )
      .run(
        patch.examinedOn, toJson(patch.recipient), toJson(patch.findings),
        toJson(patch.recommendation), now(), reportId,
      );
    return result.changes > 0;
  },

  approve(reportId: string, signer: { id: string; name: string; credentials: string; signature: string | null }): boolean {
    const result = db()
      .prepare(
        `UPDATE hse_report
            SET status = 'approved', signed_by = ?, signed_at = ?, signature = ?,
                signer_name = ?, signer_credentials = ?, updated_at = ?
          WHERE id = ? AND status = 'draft'`,
      )
      .run(signer.id, now(), signer.signature, signer.name, signer.credentials, now(), reportId);
    return result.changes > 0;
  },
};
