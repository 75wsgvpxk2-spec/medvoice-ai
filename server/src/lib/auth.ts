import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { config } from './config.ts';

/**
 * Auth for a single-clinician local application. A signed cookie carrying the
 * clinician id, and scrypt-hashed passwords. No session store, no dependency.
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

export function makeSessionToken(clinicianId: string): string {
  return `${clinicianId}.${sign(clinicianId)}`;
}

export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const index = token.lastIndexOf('.');
  if (index <= 0) return null;

  const clinicianId = token.slice(0, index);
  const signature = token.slice(index + 1);
  const expected = sign(clinicianId);

  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  return clinicianId;
}
