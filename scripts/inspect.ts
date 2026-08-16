/**
 * Phase 1 requires a way to inspect the data.
 *
 *   npm run inspect                 population overview
 *   npm run inspect -- beaupierre   one patient in full
 */
import { closeDb } from '../server/src/db/index.ts';
import {
  patients,
  encounters,
  observations,
  flags,
  alerts,
  orders,
  billing,
  runs,
} from '../server/src/db/repositories.ts';
import { SEED_CLINICIAN, SEED_TODAY } from '../server/src/db/seed-data.ts';
import { assessMonitoring } from '../server/src/clinical/monitoring.ts';

const target = process.argv[2];
const population = patients.forClinician(SEED_CLINICIAN.key);

if (population.length === 0) {
  console.log('\nNo population loaded. Run `npm run seed` first.\n');
  closeDb();
  process.exit(0);
}

function overview(): void {
  console.log(`\nPopulation for ${SEED_CLINICIAN.name} — ${population.length} patients`);
  console.log('='.repeat(104));
  console.log(
    `  ${'Patient'.padEnd(24)} ${'Age'.padEnd(4)} ${'Status'.padEnd(9)} ${'Enc'.padEnd(4)} ${'Obs'.padEnd(4)} ${'Flags'.padEnd(6)} ${'Alerts'.padEnd(7)} Last seen`,
  );
  console.log('-'.repeat(104));

  for (const p of population) {
    const enc = encounters.forPatient(p.id);
    const obs = observations.forPatient(p.id);
    const daysSince = encounters.daysSinceLast(p.id, SEED_TODAY);
    console.log(
      `  ${p.name.padEnd(24)} ${String(p.age).padEnd(4)} ${p.status.padEnd(9)} ` +
        `${String(enc.length).padEnd(4)} ${String(obs.length).padEnd(4)} ` +
        `${String(flags.activeForPatient(p.id).length).padEnd(6)} ` +
        `${String(alerts.openForPatient(p.id).length).padEnd(7)} ` +
        `${daysSince === null ? 'never' : `${daysSince}d ago`}`,
    );
  }

  const totals = {
    encounters: population.reduce((n, p) => n + encounters.forPatient(p.id).length, 0),
    observations: population.reduce((n, p) => n + observations.forPatient(p.id).length, 0),
    flags: population.reduce((n, p) => n + flags.activeForPatient(p.id).length, 0),
    alerts: population.reduce((n, p) => n + alerts.openForPatient(p.id).length, 0),
  };
  console.log('-'.repeat(104));
  console.log(
    `  Totals: ${totals.encounters} encounters, ${totals.observations} observations, ` +
      `${totals.flags} active flags, ${totals.alerts} open alerts`,
  );

  const byStatus = population.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  Status mix: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ')}`);

  const recentRuns = runs.recent(5);
  if (recentRuns.length > 0) {
    console.log('\n  Recent agent runs');
    for (const r of recentRuns) {
      console.log(
        `    ${r.agent.padEnd(30)} ${r.trigger.padEnd(20)} ${r.outcome.padEnd(8)} ${r.durationMs ?? '-'}ms`,
      );
    }
  }
  console.log();
}

function detail(key: string): void {
  const patient = population.find(
    (p) => p.id === `pat_${key}` || p.name.toLowerCase().includes(key.toLowerCase()),
  );
  if (!patient) {
    console.log(`\nNo patient matching "${key}". Names: ${population.map((p) => p.name).join(', ')}\n`);
    return;
  }

  console.log(`\n${patient.name} — ${patient.age}, ${patient.sex}`);
  console.log('='.repeat(80));
  console.log(`  Status        ${patient.status}`);
  console.log(`  Conditions    ${patient.conditions.map((c) => `${c.name} (${c.diagnosedOn})`).join('; ') || 'none'}`);
  console.log(
    `  Medications   ${patient.medications.map((m) => `${m.name} ${m.dose} ${m.frequency}`).join('; ') || 'none'}`,
  );
  console.log(`  Allergies     ${patient.allergies.join(', ') || 'none recorded'}`);

  const obs = observations.forPatient(patient.id);
  const monitoring = assessMonitoring(patient, obs, SEED_TODAY);
  if (monitoring.length > 0) {
    console.log('\n  Monitoring');
    for (const m of monitoring) {
      const state = m.overdue ? 'OVERDUE' : 'current';
      const last = m.latest ? `${m.latest.value} ${m.latest.unit} on ${m.latest.recordedOn} (${m.daysSince}d)` : 'never recorded';
      console.log(`    ${m.requirement.label.padEnd(36)} ${state.padEnd(8)} ${last}`);
    }
  }

  const activeFlags = flags.activeForPatient(patient.id);
  console.log(`\n  Active risk flags (${activeFlags.length})`);
  for (const f of activeFlags) {
    console.log(`    [${f.urgency}] ${f.reasoning}`);
    console.log(`      action: ${f.recommendedAction}`);
    console.log(`      basis:  ${f.referenceIds.join(', ') || 'none'} (confidence ${f.confidence})`);
  }

  const openAlerts = alerts.openForPatient(patient.id);
  console.log(`\n  Open documentation alerts (${openAlerts.length})`);
  for (const a of openAlerts) {
    console.log(`    [${a.gapType}] ${a.description}`);
    console.log(`      one tap will: ${a.resolution.description}`);
  }

  const patientOrders = orders.forPatient(patient.id);
  if (patientOrders.length > 0) {
    console.log(`\n  Orders (${patientOrders.length})`);
    for (const o of patientOrders) {
      console.log(`    ${o.status.padEnd(10)} ${o.orderType}: ${o.what}`);
    }
  }

  const entries = billing.forPatient(patient.id);
  console.log(`\n  Billing entries (${entries.length})`);
  for (const b of entries) {
    console.log(`    ${b.status.padEnd(9)} ${b.code.padEnd(12)} ${b.description}`);
  }

  const history = encounters.forPatient(patient.id);
  console.log(`\n  Encounter history (${history.length}), most recent first`);
  for (const e of history) {
    console.log(`\n    ${e.date}  [${e.status}]  v${e.version}  ${e.id}`);
    console.log(`      raw note: ${e.rawNote.slice(0, 110)}${e.rawNote.length > 110 ? '…' : ''}`);
    console.log(`      S: ${e.structured.subjective.slice(0, 100)}`);
    console.log(`      O: ${e.structured.objective.slice(0, 100)}`);
    console.log(`      A: ${e.structured.assessment.slice(0, 100)}`);
    console.log(`      P: ${e.structured.plan.slice(0, 100)}`);
    const flagged = e.fieldConfidence.filter((f) => f.confidence === 'flagged');
    if (flagged.length > 0) {
      for (const f of flagged) console.log(`      FLAGGED ${f.field}: ${f.ambiguity}`);
    }
  }
  console.log();
}

if (target) detail(target);
else overview();

closeDb();
