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
  /**
   * How many reverse proxies sit in front of this server.
   *
   * Off by default, and deliberately not "true". Rate limiting counts requests
   * per client address; with a proxy in front and no trust configured, every
   * request appears to come from the proxy and the whole internet shares one
   * budget. Trusting blindly is the opposite failure — any client can then send
   * an X-Forwarded-For header and be counted as somebody else, which bypasses
   * the limiter entirely. So: an explicit hop count, set by whoever knows the
   * deployment.
   */
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  isProd: process.env.NODE_ENV === 'production',

  dbPath: process.env.DB_PATH ?? path.join(ROOT, 'data', 'clinic.db'),

  /**
   * Live model access. Absent by default; the deterministic engine covers the
   * whole application when it is unset. See docs/STACK.md.
   */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,

  /*
   * Lets the scenario suite run the agents with encoded stand-ins instead of a
   * live model, so 145 clinical tests need no key, no network and no bill.
   *
   * Set only by `npm test`. The platform itself runs on live models and has no
   * local engine behind them: a fallback that answers with encoded rules puts
   * clinical text on screen attributed to an agent that never ran, which a
   * clinician has no way to see or audit. Never set this in a deployment.
   */
  useTestDouble: process.env.MODEL_TEST_DOUBLE === '1',

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

  /**
   * Signing key for the session cookie.
   *
   * Absent means a fresh random key per boot: safe, but everyone is signed out
   * on restart. That is the right default — a weak known key is far worse than
   * an inconvenient one, because the token is `id.issuedAt.version.seen.HMAC`
   * and knowing the key is enough to forge a session for any clinician.
   */
  sessionSecret: process.env.SESSION_SECRET?.trim() || randomBytes(32).toString('hex'),
  /** True when the operator supplied one, as opposed to it being generated. */
  sessionSecretProvided: Boolean(process.env.SESSION_SECRET?.trim()),
  sessionCookieName: 'cci_session',

  clinicianEmail: process.env.CLINICIAN_EMAIL ?? 'a.thomas@clinic.example',
  clinicianPassword: process.env.CLINICIAN_PASSWORD ?? 'clinic-demo',
} as const;

export const hasLiveModel = (): boolean => config.anthropicApiKey !== null;

/**
 * Refuses to run a production deployment with a session key anyone could guess.
 *
 * A weak signing key is not a degraded security posture, it is none: the token
 * carries the clinician id in plain sight and is trusted because of its HMAC,
 * so a known key means anybody can mint a session for anybody.
 *
 * In development this warns rather than exits, loudly enough to be seen. The
 * cost of that choice is that the guard depends on NODE_ENV being set — the
 * same assumption that once let stack traces reach clients — so the warning is
 * deliberately hard to scroll past.
 */
const WEAK_SECRETS = new Set([
  'change-me-to-a-long-random-string',
  'change-me',
  'secret',
  'test-secret-not-used-outside-tests',
]);

export function checkSessionSecret(): void {
  const provided = process.env.SESSION_SECRET?.trim() ?? '';

  // Nothing supplied: a random key was generated. Correct, but it signs
  // everyone out on restart, which an operator should know is happening.
  if (!provided) {
    if (config.isProd) {
      console.error(
        [
          '',
          '='.repeat(72),
          '  SESSION_SECRET is not set.',
          '',
          '  A random key was generated, so every restart will sign out every',
          '  clinician. Set one in .env before running a clinic on this:',
          '',
          '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
          '='.repeat(72),
          '',
        ].join('\n'),
      );
    }
    return;
  }

  const weak = WEAK_SECRETS.has(provided) || provided.length < 32;
  if (!weak) return;

  const reason = WEAK_SECRETS.has(provided)
    ? 'It is the example value from .env.example, which is public.'
    : `It is ${provided.length} characters; 32 is the minimum.`;

  const message = [
    '',
    '='.repeat(72),
    '  SESSION_SECRET IS NOT SAFE TO USE.',
    '',
    `  ${reason}`,
    '',
    '  Session cookies are signed with this key. Anyone who knows it can forge',
    '  a session for any clinician and read every patient record, without a',
    '  password.',
    '',
    '  Generate one:',
    '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    '='.repeat(72),
    '',
  ].join('\n');

  if (config.isProd) {
    console.error(message);
    console.error('  Refusing to start.\n');
    process.exit(1);
  }

  // Development: repeated so it survives a scrolling dev-server log.
  console.warn(message);
  console.warn('  Continuing because this is not a production build.\n');
}
