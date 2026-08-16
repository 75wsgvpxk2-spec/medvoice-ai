import fs from 'node:fs';
import { config } from '../server/src/lib/config.ts';
import { closeDb } from '../server/src/db/index.ts';
import { seed } from '../server/src/db/seed.ts';
import { SEED_CLINICIAN, SEED_TODAY, SAMPLE_NOTES } from '../server/src/db/seed-data.ts';
import { patients } from '../server/src/db/repositories.ts';
import type { Patient } from '../shared/types.ts';

export const CLINICIAN_ID = SEED_CLINICIAN.key;
export const AS_OF = SEED_TODAY;

/** Fresh database with the seed population. Call in beforeAll. */
export function freshPopulation(): void {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${config.dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  seed();
}

export function patientNamed(fragment: string): Patient {
  const match = patients
    .forClinician(CLINICIAN_ID)
    .find((p) => p.name.toLowerCase().includes(fragment.toLowerCase()));
  if (!match) throw new Error(`No seeded patient matching "${fragment}"`);
  return match;
}

export function sampleNote(key: string): string {
  const note = SAMPLE_NOTES.find((n) => n.key === key);
  if (!note) throw new Error(`No sample note "${key}"`);
  return note.text;
}

/** The patients each Section 10 profile refers to, by name fragment. */
export const PROFILE = {
  comorbidity: 'Beaupierre',
  dengue: 'Alleyne',
  sickleCell: 'Charlerie',
  stableDocumented: 'Sinclair',
  billingGap: 'Boisrond',
  overdueFollowUp: 'Fontenelle',
  longChart: 'Étienne',
  noHistory: 'Blenman',
  worseningTrend: 'Osei-Bonsu',
  outsideLogic: 'Ferdinand',
  managed: 'Marchand',
  wellControlled: 'Grandison',
} as const;
