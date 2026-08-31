-- Section 4 data model. Every entity in that section exists here.
-- SQLite: booleans are INTEGER 0/1, lists are JSON TEXT, timestamps are ISO 8601 TEXT.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clinician (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  credentials   TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  -- scrypt hash, never the password itself
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  -- Incremented to invalidate every token already issued to this clinician.
  -- Signing out bumps it, which is what makes a stateless token revocable.
  token_version INTEGER NOT NULL DEFAULT 1,
  /*
   * HIPAA §164.312(a)(2)(i) requires unique user identification: every person
   * who touches the record needs their own sign-in, or the audit trail cannot
   * say who did anything. These columns are what make that real.
   */
  role          TEXT NOT NULL DEFAULT 'clinician'
                  CHECK (role IN ('admin','clinician')),
  -- Deactivated rather than deleted, so audit history keeps resolving to a name.
  active        INTEGER NOT NULL DEFAULT 1,
  -- Set when an admin issues a temporary password. Cleared once changed.
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT,
  last_sign_in_at TEXT
);

/*
 * The clinic this installation belongs to. A single row, so the id is fixed —
 * a settings table rather than an entity, and the record every printed or
 * exported document is headed with.
 */
CREATE TABLE IF NOT EXISTS clinic (
  id            TEXT PRIMARY KEY DEFAULT 'clinic',
  name          TEXT NOT NULL DEFAULT '',
  legal_name    TEXT NOT NULL DEFAULT '',
  currency      TEXT NOT NULL DEFAULT 'USD',
  registration  TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  website       TEXT NOT NULL DEFAULT '',
  -- Data URI. Kept in the database so a clinic install needs no file storage.
  logo          TEXT,
  -- Chrome only. Urgency colours are not clinic-configurable.
  brand_dark    TEXT NOT NULL DEFAULT '',
  brand_light   TEXT NOT NULL DEFAULT '',
  primary_doctor TEXT NOT NULL DEFAULT '',
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS patient (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  age              INTEGER NOT NULL,
  sex              TEXT NOT NULL CHECK (sex IN ('female','male')),
  conditions       TEXT NOT NULL DEFAULT '[]',   -- JSON: [{name, diagnosedOn}]
  medications      TEXT NOT NULL DEFAULT '[]',   -- JSON: [{name, dose, frequency, startedOn}]
  allergies        TEXT NOT NULL DEFAULT '[]',   -- JSON: string[]
  clinician_id     TEXT NOT NULL REFERENCES clinician(id),
  -- Section 4: managed and stable are clinically different and never collapsed.
  status           TEXT NOT NULL DEFAULT 'stable'
                     CHECK (status IN ('critical','watch','stable','managed')),
  queue_position   INTEGER,
  last_assessed_at TEXT,
  created_at       TEXT,
  -- Administrative detail: contact, next of kin, cover. JSON because none of it
  -- is ever queried field by field, matching how conditions are already stored.
  profile          TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_patient_clinician ON patient(clinician_id);

CREATE TABLE IF NOT EXISTS encounter (
  id                  TEXT PRIMARY KEY,
  patient_id          TEXT NOT NULL REFERENCES patient(id),
  clinician_id        TEXT NOT NULL REFERENCES clinician(id),
  date                TEXT NOT NULL,
  -- Agent 1 rule: never modified. A1-4 verifies this byte for byte.
  raw_note            TEXT NOT NULL,
  subjective          TEXT NOT NULL DEFAULT '',
  objective           TEXT NOT NULL DEFAULT '',
  assessment          TEXT NOT NULL DEFAULT '',
  plan                TEXT NOT NULL DEFAULT '',
  field_confidence    TEXT NOT NULL DEFAULT '[]',  -- JSON: FieldConfidence[]
  -- DI-1: an encounter only reaches 'approved' through the approval action.
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','awaiting_approval','approved')),
  approved_by         TEXT REFERENCES clinician(id),
  approved_at         TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  amends_encounter_id TEXT REFERENCES encounter(id),
  amended_by          TEXT REFERENCES clinician(id),
  amended_at          TEXT,
  context_brief       TEXT,                        -- JSON: ContextBrief
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_encounter_patient ON encounter(patient_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_encounter_status ON encounter(status);

CREATE TABLE IF NOT EXISTS observation (
  id           TEXT PRIMARY KEY,
  patient_id   TEXT NOT NULL REFERENCES patient(id),
  encounter_id TEXT REFERENCES encounter(id),
  type         TEXT NOT NULL,
  value        TEXT NOT NULL,
  unit         TEXT NOT NULL,
  recorded_on  TEXT NOT NULL,
  -- Derived from the monitoring intervals in docs/clinical-reference.md.
  overdue      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_observation_patient ON observation(patient_id, recorded_on DESC);

CREATE TABLE IF NOT EXISTS risk_flag (
  id                       TEXT PRIMARY KEY,
  patient_id               TEXT NOT NULL REFERENCES patient(id),
  flag_type                TEXT NOT NULL,
  urgency                  TEXT NOT NULL CHECK (urgency IN ('critical','watch','stable')),
  -- Section 5: a flag with no reasoning is a bug. Enforced at the schema level.
  reasoning                TEXT NOT NULL CHECK (length(trim(reasoning)) > 0),
  recommended_action       TEXT NOT NULL,
  triggering_encounter_id  TEXT REFERENCES encounter(id),
  triggering_observation_id TEXT REFERENCES observation(id),
  created_at               TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','resolved','dismissed')),
  dismissal_reason         TEXT CHECK (dismissal_reason IS NULL OR dismissal_reason IN
                             ('not_clinically_relevant','already_addressed','disagree_with_assessment')),
  dismissed_by             TEXT REFERENCES clinician(id),
  dismissed_at             TEXT,
  confidence               TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high','uncertain')),
  -- CS-1: every threshold traceable to docs/clinical-reference.md.
  reference_ids            TEXT NOT NULL DEFAULT '[]',
  -- FD-4: dismissal is keyed to the clinical picture at the time it was dismissed.
  dismissed_fingerprint    TEXT,
  /*
   * The rules layer's severity for this finding, kept so the queue can be
   * re-ranked from stored flags after a single-patient assessment without
   * re-running the agents across the whole population.
   */
  severity_score           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_flag_patient ON risk_flag(patient_id, status);

CREATE TABLE IF NOT EXISTS documentation_alert (
  id           TEXT PRIMARY KEY,
  patient_id   TEXT NOT NULL REFERENCES patient(id),
  encounter_id TEXT NOT NULL REFERENCES encounter(id),
  gap_type     TEXT NOT NULL CHECK (gap_type IN
                 ('missing_diagnosis','missing_result','incomplete_note','missing_billing_code')),
  description  TEXT NOT NULL,
  resolution   TEXT NOT NULL,                 -- JSON: ResolutionAction
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_by  TEXT REFERENCES clinician(id),
  resolved_at  TEXT,
  created_at   TEXT NOT NULL,
  -- A4-4: the same gap is never raised twice for one patient.
  gap_key      TEXT NOT NULL,
  -- How it was closed: the system acted, the clinician had already acted, or
  -- they said it should not be actioned. Null while open.
  resolution_route TEXT CHECK (resolution_route IN ('automatic','manual','declined')),
  resolution_note  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_gap_unique ON documentation_alert(patient_id, gap_key);
CREATE INDEX IF NOT EXISTS idx_alert_patient ON documentation_alert(patient_id, status);

CREATE TABLE IF NOT EXISTS "order" (
  id            TEXT PRIMARY KEY,
  patient_id    TEXT NOT NULL REFERENCES patient(id),
  encounter_id  TEXT NOT NULL REFERENCES encounter(id),
  order_type    TEXT NOT NULL,
  what          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','completed')),
  ordered_by    TEXT NOT NULL REFERENCES clinician(id),
  ordered_at    TEXT NOT NULL,
  completed_at  TEXT,
  from_alert_id TEXT REFERENCES documentation_alert(id)
);

CREATE INDEX IF NOT EXISTS idx_order_patient ON "order"(patient_id);

CREATE TABLE IF NOT EXISTS billing_entry (
  id            TEXT PRIMARY KEY,
  patient_id    TEXT NOT NULL REFERENCES patient(id),
  encounter_id  TEXT NOT NULL REFERENCES encounter(id),
  code          TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','recorded')),
  -- OB-2: the billing entry created by a one-tap resolution links to its order.
  from_order_id TEXT REFERENCES "order"(id),
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_patient ON billing_entry(patient_id);

-- Section 4: the run log is the evidence that the agents are real and that two
-- of them run in parallel. OR-1 is verified against these timestamps.
CREATE TABLE IF NOT EXISTS agent_run (
  id             TEXT PRIMARY KEY,
  agent          TEXT NOT NULL,
  trigger        TEXT NOT NULL,
  patient_id     TEXT,
  encounter_id   TEXT,
  correlation_id TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  completed_at   TEXT,
  duration_ms    INTEGER,
  input_summary  TEXT NOT NULL,
  output_summary TEXT,
  outcome        TEXT NOT NULL DEFAULT 'running'
                   CHECK (outcome IN ('running','success','failure')),
  error_message  TEXT,
  /*
   * OR-1 [CRITICAL] asks for proof that Agents 3 and 4 overlap, verified in the
   * run log rather than by watching the screen. Wall-clock timestamps cannot
   * show this when a run finishes inside a millisecond, so each run records how
   * many runs were in flight at the moment it started. A value of 2 or more is
   * direct evidence that another agent was still running when this one began;
   * sequential execution can only ever record 1.
   */
  concurrency_at_start INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_run_correlation ON agent_run(correlation_id);
CREATE INDEX IF NOT EXISTS idx_run_started ON agent_run(started_at DESC);

-- Section 11: token spend instrumentation, in place from Phase 0.
CREATE TABLE IF NOT EXISTS model_call (
  id                 TEXT PRIMARY KEY,
  agent              TEXT NOT NULL,
  provider           TEXT NOT NULL,
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL NOT NULL DEFAULT 0,
  duration_ms        INTEGER NOT NULL DEFAULT 0,
  cached             INTEGER NOT NULL DEFAULT 0,
  phase              TEXT,
  -- Set when a live call was configured but could not be made. Lets the AI
  -- usage panel report why the local engine answered rather than infer it.
  degraded_reason    TEXT,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_call_created ON model_call(created_at DESC);

-- Section 11 / PF-6: cached agent output for the seeded population.
CREATE TABLE IF NOT EXISTS agent_cache (
  cache_key  TEXT PRIMARY KEY,
  agent      TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Population run history, so the queue can report when it was last checked
-- (8.2 "empty, nothing flagged" states when it was last checked; PR-2, PR-4).
CREATE TABLE IF NOT EXISTS population_run (
  id            TEXT PRIMARY KEY,
  clinician_id  TEXT NOT NULL REFERENCES clinician(id),
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  outcome       TEXT NOT NULL DEFAULT 'running'
                  CHECK (outcome IN ('running','success','partial','failure')),
  patients_assessed INTEGER NOT NULL DEFAULT 0,
  detail        TEXT
);

/* ---------------------------------------------------------------------------
 * Settings, audit and voice training.
 * ------------------------------------------------------------------------ */

/*
 * Runtime configuration the clinic can change without an environment variable
 * or a restart. Values are JSON so a setting can grow from a string to an
 * object without a migration. Environment variables remain the fallback: a key
 * absent here means "use what config.ts read at boot".
 */
CREATE TABLE IF NOT EXISTS setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

/*
 * Every change anyone makes to the record, in one append-only place.
 *
 * Deliberately never updated or deleted — an audit row that can be edited is
 * not an audit row. The summary is written in plain language at the point of
 * the change, because reconstructing intent from a diff months later is
 * exactly what this table exists to avoid.
 */
CREATE TABLE IF NOT EXISTS audit_event (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  /* The clinician id, or 'system' when an agent or the seeder acted. */
  actor       TEXT NOT NULL,
  actor_name  TEXT NOT NULL,
  /* noun.verb, e.g. patient.created — stable enough to filter on. */
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  patient_id  TEXT,
  summary     TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '{}',
  /*
   * §164.312(c)(1) — integrity. Each row hashes its own contents together with
   * the previous row's hash, so altering or removing history breaks the chain
   * from that point on and the break is visible.
   *
   * This does not prevent tampering: anyone with the database file can rewrite
   * every hash. It makes tampering detectable, which is what an audit trail
   * can honestly offer without a second system to attest to.
   */
  prev_hash   TEXT,
  hash        TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_event(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_patient ON audit_event(patient_id, at DESC);

/*
 * Voice-trained transcription corrections.
 *
 * This is a correction dictionary, not model training: browser speech
 * recognition cannot be fine-tuned from here. The clinician says a term, the
 * recogniser returns whatever it heard, and the mishearing is stored against
 * the correct spelling so later transcripts can be repaired. Honest about what
 * it is — a lookup that gets better the more samples it has.
 */
CREATE TABLE IF NOT EXISTS pronunciation (
  id           TEXT PRIMARY KEY,
  clinician_id TEXT NOT NULL REFERENCES clinician(id),
  /* The correct spelling, as it should appear in the note. */
  term         TEXT NOT NULL,
  /* Comma-free JSON array of the mishearings recorded for this term. */
  heard_as     TEXT NOT NULL DEFAULT '[]',
  category     TEXT NOT NULL DEFAULT 'term',
  sample_count INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pronunciation_term
  ON pronunciation(clinician_id, term);

/* ==========================================================================
 * Operations — running the practice, as opposed to treating the patients.
 *
 * Money is stored in integer minor units (cents) everywhere below, never as a
 * float. Repeated float arithmetic across invoice lines drifts, and a clinic
 * that finds a total off by a cent stops trusting the whole ledger. Formatting
 * happens once, at the edge, against the clinic's configured currency.
 *
 * Nothing financial is ever hard-deleted. Products archive, invoices void; both
 * stay queryable, because a record that can vanish is a record an auditor
 * cannot rely on.
 * ======================================================================== */

CREATE TABLE IF NOT EXISTS product (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  sku            TEXT NOT NULL DEFAULT '',
  barcode        TEXT NOT NULL DEFAULT '',
  /* A consumable, something the clinic does, or something it sells. */
  kind           TEXT NOT NULL DEFAULT 'supply'
                   CHECK (kind IN ('supply','service','retail')),
  category       TEXT NOT NULL DEFAULT '',
  price_cents    INTEGER NOT NULL DEFAULT 0,
  /* Services have no stock; the column stays 0 and the screen hides it. */
  stock          INTEGER NOT NULL DEFAULT 0,
  /* Below this, the item is reported low. 0 disables the warning. */
  reorder_point  INTEGER NOT NULL DEFAULT 0,
  archived       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_kind ON product(kind, archived);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_sku ON product(sku) WHERE sku <> '';

CREATE TABLE IF NOT EXISTS invoice (
  id            TEXT PRIMARY KEY,
  /* Human-facing reference, unique and never reused. */
  number        TEXT NOT NULL,
  /* Money owed to the clinic, or money the clinic owes. */
  kind          TEXT NOT NULL CHECK (kind IN ('patient','vendor')),
  contact_name  TEXT NOT NULL,
  /* Set for patient invoices so the record links back to the person. */
  patient_id    TEXT REFERENCES patient(id),
  issued_on     TEXT NOT NULL,
  due_on        TEXT NOT NULL,
  paid_on       TEXT,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  /* Overdue is derived from due_on rather than stored, so it cannot go stale
     the moment the date passes without anybody opening the screen. */
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','paid','void')),
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_number ON invoice(number);
CREATE INDEX IF NOT EXISTS idx_invoice_status ON invoice(kind, status, due_on);

CREATE TABLE IF NOT EXISTS invoice_line (
  id               TEXT PRIMARY KEY,
  invoice_id       TEXT NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  /* Optional: a line may describe something not in the catalogue. */
  product_id       TEXT REFERENCES product(id),
  /* Set when the line came from clinical work already recorded. */
  billing_entry_id TEXT REFERENCES billing_entry(id),
  description      TEXT NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_invoice ON invoice_line(invoice_id);

CREATE TABLE IF NOT EXISTS expense (
  id           TEXT PRIMARY KEY,
  incurred_on  TEXT NOT NULL,
  description  TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'other',
  /* Receipt number, cheque number, whatever the clinic files it under. */
  reference    TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expense_date ON expense(incurred_on);

/* ==========================================================================
 * Occupational health reports.
 *
 * An HSE medical is a fixed-shape document a doctor fills in after an
 * examination and signs. Filling it by hand in a word processor takes a long
 * time and re-types facts the clinical record already holds — the patient's
 * name and date of birth, their blood pressure, their pulse.
 *
 * The findings are stored as one JSON document rather than sixty columns. The
 * shape belongs to the template, and a template that gains a field should not
 * require a migration; what must not drift is the identity of the report, who
 * signed it and when, so those are columns.
 * ======================================================================== */

CREATE TABLE IF NOT EXISTS hse_report (
  id            TEXT PRIMARY KEY,
  patient_id    TEXT NOT NULL REFERENCES patient(id),
  /* Who created it. The signer is recorded separately: the doctor who signs is
     not always the one who started the draft. */
  created_by    TEXT NOT NULL REFERENCES clinician(id),
  examined_on   TEXT NOT NULL,
  /* Who the report is addressed to — employer, occupational health unit. */
  recipient     TEXT NOT NULL DEFAULT '{}',
  /* Every measurement and system finding. JSON: HseFindings. */
  findings      TEXT NOT NULL DEFAULT '{}',
  /* Fitness decision and the narrative around it. JSON: HseRecommendation. */
  recommendation TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  signed_by     TEXT REFERENCES clinician(id),
  signed_at     TEXT,
  /* The signature image as it was at the moment of signing, copied rather than
     referenced. A doctor who later replaces their signature must not silently
     restyle every report they have already put their name to. */
  signature     TEXT,
  signer_name   TEXT NOT NULL DEFAULT '',
  signer_credentials TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hse_patient ON hse_report(patient_id, examined_on);
CREATE INDEX IF NOT EXISTS idx_hse_status ON hse_report(status, examined_on);
