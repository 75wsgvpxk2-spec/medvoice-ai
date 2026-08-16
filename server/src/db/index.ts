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
  ];
  for (const [table, column, definition] of added) {
    const columns = conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((c) => c.name === column)) continue;
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
