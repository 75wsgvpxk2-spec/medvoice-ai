import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../..');

/**
 * Section 0 / Phase 0. Every configurable value lands here so nothing is read
 * from process.env at a call site.
 */
export const config = {
  /**
   * API_PORT, not PORT. Dev harnesses and hosting platforms commonly inject
   * PORT for the process they think is the web server — which here is Vite, not
   * this API — and dotenv will not override an already-set variable. Reading a
   * dedicated name keeps the API off the client's port.
   */
  port: Number(process.env.API_PORT ?? 5174),
  isProd: process.env.NODE_ENV === 'production',

  dbPath: process.env.DB_PATH ?? path.join(ROOT, 'data', 'clinic.db'),

  /**
   * Live model access. Absent by default; the deterministic engine covers the
   * whole application when it is unset. See docs/STACK.md.
   */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,

  /**
   * Claude Opus 5. Thinking is on by default on this model and counts toward
   * max_tokens, so every agent call below sets max_tokens with headroom.
   */
  model: process.env.MODEL ?? 'claude-opus-5',

  /**
   * Section 11: reserve at least 20 percent of the pool for the final phase.
   * Expressed in US dollars so the spend report is readable.
   */
  budgetUsd: Number(process.env.BUDGET_USD ?? 50),
  finalPhaseReserveFraction: 0.2,

  sessionSecret: process.env.SESSION_SECRET ?? randomBytes(32).toString('hex'),
  sessionCookieName: 'cci_session',

  clinicianEmail: process.env.CLINICIAN_EMAIL ?? 'a.thomas@clinic.example',
  clinicianPassword: process.env.CLINICIAN_PASSWORD ?? 'clinic-demo',
} as const;

export const hasLiveModel = (): boolean => config.anthropicApiKey !== null;
