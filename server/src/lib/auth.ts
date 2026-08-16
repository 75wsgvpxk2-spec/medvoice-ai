import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { config } from './config.ts';

/**
 * Auth for a small clinic. A signed cookie and scrypt-hashed passwords, with no
 * session store — which means a token survives a server restart, and the
 * clinician is not signed out every time the process reloads.
 *
 * Statelessness costs revocation, so the token carries two things that buy it
 * back cheaply:
 *
 * - an issue time, checked against a maximum lifetime, so a cookie captured
 *   from a shared machine stops working rather than lasting forever;
 * - the clinician's token version, so signing out (or changing a password) can
 *   invalidate every token already issued by incrementing one integer.
 *
 * Without those, "sign out" only cleared the browser's own copy of a cookie
 * that remained valid indefinitely.
 */

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): {
  hash: string;
  salt: string;
} {
  return { hash: scryptSync(password, salt, 64).toString('hex'), salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function sign(value: string): string {
  return createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}

/** Absolute session lifetime. A clinical shift, not a browsing session. */
export const DEFAULT_SESSION_HOURS = 12;

export interface SessionClaims {
  clinicianId: string;
  issuedAt: number;
  tokenVersion: number;
}

export function makeSessionToken(clinicianId: string, tokenVersion: number): string {
  const payload = `${clinicianId}.${Date.now()}.${tokenVersion}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Verifies the signature and returns the claims, or null.
 *
 * Expiry and token version are deliberately NOT checked here — this function
 * only answers "did we issue this". Whether the claims are still acceptable
 * needs the clinician record, and belongs with the caller that has it.
 */
export function readSessionToken(token: string | undefined): SessionClaims | null {
  if (!token) return null;

  const index = token.lastIndexOf('.');
  if (index <= 0) return null;

  const payload = token.slice(0, index);
  const signature = token.slice(index + 1);
  const expected = sign(payload);

  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  const parts = payload.split('.');
  if (parts.length !== 3) return null;

  const [clinicianId, issuedAt, tokenVersion] = parts;
  if (!clinicianId) return null;

  const issued = Number(issuedAt);
  const version = Number(tokenVersion);
  if (!Number.isFinite(issued) || !Number.isInteger(version)) return null;

  return { clinicianId, issuedAt: issued, tokenVersion: version };
}

/** True when the token is past its absolute lifetime. */
export function isExpired(claims: SessionClaims, hours = DEFAULT_SESSION_HOURS): boolean {
  return Date.now() - claims.issuedAt > hours * 3_600_000;
}
