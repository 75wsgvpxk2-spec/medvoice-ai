import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../lib/config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

let instance: Database.Database | null = null;

/**
 * Single connection, opened lazily. better-sqlite3 is synchronous, which suits
 * a single-process application and keeps the repository layer free of await.
 */
export function db(): Database.Database {
  if (instance) return instance;

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const conn = new Database(config.dbPath);

  // WAL keeps reads unblocked while an agent run writes flags.
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  migrate(conn);

  instance = conn;
  return conn;
}

/**
 * CREATE TABLE IF NOT EXISTS leaves an existing table alone, so columns added
 * after a database was first created have to be applied separately. Adding a
 * column is the only migration shape used here, and it is safe to re-run.
 */
function migrate(conn: Database.Database): void {
  const added: Array<[string, string, string]> = [
    ['patient', 'profile', "TEXT NOT NULL DEFAULT '{}'"],
    ['clinician', 'token_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['clinic', 'brand_dark', "TEXT NOT NULL DEFAULT ''"],
    ['clinic', 'brand_light', "TEXT NOT NULL DEFAULT ''"],
    ['clinic', 'primary_doctor', "TEXT NOT NULL DEFAULT ''"],
    ['model_call', 'degraded_reason', 'TEXT'],
    // The first account on an existing install becomes the admin; see migrate().
    ['clinician', 'role', "TEXT NOT NULL DEFAULT 'clinician'"],
    ['clinician', 'active', 'INTEGER NOT NULL DEFAULT 1'],
    ['clinician', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0'],
    ['clinician', 'created_at', 'TEXT'],
    ['clinician', 'last_sign_in_at', 'TEXT'],
    ['risk_flag', 'dismissal_note', 'TEXT'],
    ['audit_event', 'prev_hash', 'TEXT'],
    ['audit_event', 'hash', 'TEXT'],
    // Added with the manual close routes. No CHECK here: ALTER TABLE ADD COLUMN
    // cannot carry one in SQLite, and the route is written only by code that
    // already constrains it.
    // 'New patients this period' needs to know when somebody joined.
    // last_assessed_at is when they were last looked at, which is a
    // different question and answers this one wrongly.
    ['patient', 'created_at', 'TEXT'],
    ['clinic', 'currency', "TEXT NOT NULL DEFAULT 'USD'"],
    // A doctor's signature image, stored once and applied to what they sign.
    ['clinician', 'signature', 'TEXT'],
    // Letterhead for printed documents, separate from the interface logo:
    // one is a 40px mark in a sidebar, the other is a page-width banner.
    ['clinic', 'letterhead', 'TEXT'],
    ['documentation_alert', 'resolution_route', 'TEXT'],
    ['documentation_alert', 'resolution_note', 'TEXT'],
  ];
  for (const [table, column, definition] of added) {
    const columns = conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((c) => c.name === column)) continue;
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  // An installation that predates roles has one account, and it is the person
  // who set the clinic up. Leaving them a plain clinician would lock everyone
  // out of user management on the very upgrade that introduces it.
  // Rows that predate the column get the earliest date the record can evidence,
  // rather than today — which would report the whole population as new.
  conn.exec(
    `UPDATE patient SET created_at = COALESCE(
       (SELECT MIN(date) FROM encounter e WHERE e.patient_id = patient.id),
       last_assessed_at,
       '1970-01-01'
     ) WHERE created_at IS NULL`,
  );

  const admins = conn.prepare("SELECT COUNT(*) AS n FROM clinician WHERE role = 'admin'").get() as {
    n: number;
  };
  if (admins.n === 0) {
    conn.exec("UPDATE clinician SET role = 'admin' WHERE id = (SELECT id FROM clinician LIMIT 1)");
  }
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/** ISO 8601 timestamp, the only time format stored anywhere. */
export const now = (): string => new Date().toISOString();

/** Short, sortable, human-readable identifiers — easier to trace in the run log. */
export function id(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}${rand}`;
}

export const toJson = (value: unknown): string => JSON.stringify(value);

export function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const toBool = (value: number | null | undefined): boolean => value === 1;
export const fromBool = (value: boolean): number => (value ? 1 : 0);
