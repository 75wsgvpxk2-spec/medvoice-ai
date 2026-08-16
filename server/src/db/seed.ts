import { db, id, now } from './index.ts';
import { clinicians, patients, encounters, observations, billing } from './repositories.ts';
import { hashPassword } from '../lib/auth.ts';
import { config } from '../lib/config.ts';
import { assessMonitoring } from '../clinical/monitoring.ts';
import {
  SEED_CLINICIAN,
  SEED_PATIENTS,
  SEED_PROFILES,
  SEED_TODAY,
  daysAgo,
} from './seed-data.ts';
import { EMPTY_PROFILE } from '../../../shared/types.ts';
import { assertDemoSeedAllowed, record as recordInstallation } from '../lib/installation.ts';

export interface SeedResult {
  clinicianId: string;
  patients: number;
  encounters: number;
  observations: number;
  billingEntries: number;
  overdueObservations: number;
}

/** Wipes and reloads the seed population. Safe to run repeatedly. */
/**
 * Loads the fictional demo population.
 *
 * With no arguments it also creates the demo clinician from the environment,
 * which is what `npm run seed:demo` wants. Passing an existing clinician id
 * attaches the population to that account instead and leaves the clinician
 * table alone — which is what sign-up needs, since the account was created a
 * moment earlier and must survive.
 */
export function seed(options: { clinicianId?: string } = {}): SeedResult {
  // Refuses outright if this database belongs to a clinic. Placed before the
  // first write so running the script directly cannot bypass it.
  assertDemoSeedAllowed();

  const conn = db();
  const attachToExisting = Boolean(options.clinicianId);

  // Child rows before parents. population_run references clinician, so the
  // clinician cannot go first — on a database that has had a population run,
  // deleting it first fails the foreign key.
  conn.exec(`
    DELETE FROM billing_entry;
    DELETE FROM "order";
    DELETE FROM documentation_alert;
    DELETE FROM risk_flag;
    DELETE FROM observation;
    DELETE FROM encounter;
    DELETE FROM population_run;
    DELETE FROM patient;
    DELETE FROM agent_run;
    DELETE FROM agent_cache;
  `);

  let clinicianId: string;
  if (attachToExisting) {
    clinicianId = options.clinicianId!;
  } else {
    // Only the standalone seed replaces the clinician; sign-up's account has
    // already been created and deleting it here would sign the clinic out of
    // the installation it just made.
    conn.exec('DELETE FROM clinician');
    clinicianId = SEED_CLINICIAN.key;
    const { hash, salt } = hashPassword(config.clinicianPassword);
    clinicians.insert({
      id: clinicianId,
      name: SEED_CLINICIAN.name,
      credentials: SEED_CLINICIAN.credentials,
      email: config.clinicianEmail,
      passwordHash: hash,
      passwordSalt: salt,
    });
  }

  let encounterCount = 0;
  let observationCount = 0;
  let billingCount = 0;

  const load = conn.transaction(() => {
    for (const p of SEED_PATIENTS) {
      const patientId = `pat_${p.key}`;

      patients.insert({
        id: patientId,
        name: p.name,
        age: p.age,
        sex: p.sex,
        conditions: p.conditions,
        medications: p.medications,
        allergies: p.allergies,
        profile: SEED_PROFILES[p.key] ?? EMPTY_PROFILE,
        clinicianId,
        status: p.initialStatus,
        queuePosition: null,
        lastAssessedAt: null,
      });

      p.encounters.forEach((e, index) => {
        const encounterId = `enc_${p.key}_${index + 1}`;
        const date = daysAgo(e.daysAgo);
        // Seeded encounters are history: already reviewed and approved.
        const approvedAt = new Date(SEED_TODAY.getTime() - e.daysAgo * 86_400_000).toISOString();

        encounters.insert({
          id: encounterId,
          patientId,
          clinicianId,
          date,
          rawNote: e.rawNote,
          structured: {
            subjective: e.subjective,
            objective: e.objective,
            assessment: e.assessment,
            plan: e.plan,
          },
          fieldConfidence: [],
          status: 'approved',
          approvedBy: clinicianId,
          approvedAt,
          version: 1,
          amendsEncounterId: null,
          amendedBy: null,
          amendedAt: null,
          contextBrief: null,
        });
        encounterCount += 1;

        for (const o of e.observations ?? []) {
          observations.insert({
            id: id('obs'),
            patientId,
            encounterId,
            type: o.type,
            value: o.value,
            unit: o.unit,
            recordedOn: daysAgo(o.daysAgo),
            overdue: false,
          });
          observationCount += 1;
        }

        for (const b of e.billing ?? []) {
          billing.insert({
            id: id('bill'),
            patientId,
            encounterId,
            code: b.code,
            description: b.description,
            status: 'recorded',
            fromOrderId: null,
            createdAt: approvedAt,
          });
          billingCount += 1;
        }
      });

      for (const o of p.standaloneObservations ?? []) {
        observations.insert({
          id: id('obs'),
          patientId,
          encounterId: null,
          type: o.type,
          value: o.value,
          unit: o.unit,
          recordedOn: daysAgo(o.daysAgo),
          overdue: false,
        });
        observationCount += 1;
      }
    }
  });

  load();
  recordInstallation('demo');

  // Section 4: an observation records whether it is overdue relative to the
  // patient's conditions. Derived from the monitoring intervals in the clinical
  // reference file rather than authored into the seed.
  let overdueCount = 0;
  for (const patient of patients.forClinician(clinicianId)) {
    const obs = observations.forPatient(patient.id);
    for (const finding of assessMonitoring(patient, obs, SEED_TODAY)) {
      if (finding.overdue && finding.latest) {
        observations.setOverdue(finding.latest.id, true);
        overdueCount += 1;
      }
    }
  }

  return {
    clinicianId,
    patients: SEED_PATIENTS.length,
    encounters: encounterCount,
    observations: observationCount,
    billingEntries: billingCount,
    overdueObservations: overdueCount,
  };
}

export { SEED_TODAY, now };
