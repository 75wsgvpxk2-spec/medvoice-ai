/**
 * One-off: fill in administrative detail for patients created before the
 * profile fields existed.
 *
 * This is a development utility, not application behaviour. Nothing in the
 * running system ever invents patient detail — a blank field stays blank until
 * somebody types into it. It exists only so the fictional demo population
 * (Section 15, DI-5) is complete after the schema gained new columns, without
 * re-seeding and losing the encounters and flags already recorded.
 *
 * Safe to re-run: a patient whose profile already has a date of birth is left
 * alone, so nothing typed by hand is ever overwritten.
 *
 *   npx tsx server/src/db/backfill-profiles.ts
 */

import { db } from './index.ts';
import { patients } from './repositories.ts';
import { SEED_PATIENTS, SEED_PROFILES } from './seed-data.ts';
import { EMPTY_PROFILE, type PatientProfile } from '../../../shared/types.ts';

/** Patients added through the interface during testing, so absent from the seed. */
const EXTRA: Record<string, PatientProfile> = {
  'Nadine Rocheford': {
    dateOfBirth: '1980-02-26',
    bloodType: 'O-',
    phone: '+1 246 555 0231',
    email: 'n.rocheford@example.com',
    address: '11 Prior Park Terrace, St James',
    preferredLanguage: 'English',
    maritalStatus: 'Married',
    occupation: 'Bank teller',
    emergencyContact: { name: 'Curtis Rocheford', relationship: 'Husband', phone: '+1 246 555 0232' },
    insurance: {
      provider: 'Caribbean Family Health Plan',
      policyNumber: 'CFHP-8802517',
      expiresOn: '2027-09-30',
    },
    notes: 'Sulfa allergy — flagged at registration.',
  },
};

function run(): void {
  const conn = db();
  const byName = new Map<string, PatientProfile>(Object.entries(EXTRA));
  for (const seed of SEED_PATIENTS) {
    const profile = SEED_PROFILES[seed.key];
    if (profile) byName.set(seed.name, profile);
  }

  const rows = conn.prepare('SELECT id, name, profile FROM patient').all() as Array<{
    id: string;
    name: string;
    profile: string;
  }>;

  let filled = 0;
  let skipped = 0;
  let missing = 0;

  for (const row of rows) {
    let existing: Partial<PatientProfile> = {};
    try {
      existing = JSON.parse(row.profile || '{}') as Partial<PatientProfile>;
    } catch {
      existing = {};
    }
    if (existing.dateOfBirth) {
      skipped += 1;
      continue;
    }
    const profile = byName.get(row.name);
    if (!profile) {
      // The id, not the name: a development script's output ends up in
      // terminal scrollback, CI logs and screenshots.
      console.log(`  no profile authored for ${row.id} — left blank`);
      missing += 1;
      continue;
    }
    patients.updateProfile(row.id, { ...EMPTY_PROFILE, ...profile });
    filled += 1;
  }

  console.log(
    `Backfill complete: ${filled} filled, ${skipped} already had detail, ${missing} left blank ` +
      `(${rows.length} patients).`,
  );
}

run();
