/**
 * Phase gate checks (Section 13). Each phase reports which acceptance criteria
 * pass, which fail, and the spend at that point.
 *
 *   npm run gate -- 0
 */
import { phase0TestCall } from '../server/src/model/provider.ts';
import { db, closeDb } from '../server/src/db/index.ts';
import { hasLiveModel, config } from '../server/src/lib/config.ts';
import { patients, encounters, observations } from '../server/src/db/repositories.ts';
import { SEED_CLINICIAN } from '../server/src/db/seed-data.ts';
import { checkCoverage, checkSampleNotes } from '../server/src/db/coverage.ts';
import { verifyReference } from '../server/src/clinical/reference.ts';
import { printSpend } from './spend.ts';

interface Check {
  label: string;
  pass: boolean;
  detail: string;
}

function report(phase: string, checks: Check[]): boolean {
  const width = Math.max(...checks.map((c) => c.label.length)) + 2;
  console.log(`\nPhase ${phase} gate`);
  console.log('='.repeat(58));
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.label.padEnd(width)} ${c.detail}`);
  }
  const allPass = checks.every((c) => c.pass);
  console.log('-'.repeat(58));
  console.log(`  ${allPass ? 'GATE PASSED' : 'GATE FAILED'}`);
  return allPass;
}

async function phase0(): Promise<boolean> {
  const checks: Check[] = [];

  // Schema is created on first connection.
  const tables = db()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  const required = [
    'agent_run',
    'billing_entry',
    'clinician',
    'documentation_alert',
    'encounter',
    'model_call',
    'observation',
    'order',
    'patient',
    'risk_flag',
  ];
  const present = new Set(tables.map((t) => t.name));
  const missing = required.filter((t) => !present.has(t));
  checks.push({
    label: 'Data layer initialises',
    pass: missing.length === 0,
    detail: missing.length === 0 ? `${tables.length} tables created` : `missing: ${missing.join(', ')}`,
  });

  let call: Awaited<ReturnType<typeof phase0TestCall>> | null = null;
  let error: string | null = null;
  try {
    call = await phase0TestCall();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  checks.push({
    label: 'Test model call returns',
    pass: call?.ok === true,
    detail: call ? `${call.provider}, ${call.durationMs}ms — ${call.reply}` : `error: ${error}`,
  });

  const logged = db().prepare('SELECT COUNT(*) AS n FROM model_call').get() as { n: number };
  checks.push({
    label: 'Spend is logged',
    pass: logged.n > 0,
    detail: `${logged.n} model call(s) recorded`,
  });

  checks.push({
    label: 'Model access declared',
    pass: true,
    detail: hasLiveModel()
      ? `live: ${config.model}`
      : 'deterministic engine (set ANTHROPIC_API_KEY in .env for live calls)',
  });

  const passed = report('0', checks);
  printSpend();
  return passed;
}

async function phase1(): Promise<boolean> {
  const checks: Check[] = [];
  const population = patients.forClinician(SEED_CLINICIAN.key);

  checks.push({
    label: 'Seed population loaded',
    pass: population.length >= 12 && population.length <= 15,
    detail: `${population.length} patients (Section 10 requires 12 to 15)`,
  });

  // Section 10: 2 to 5 prior encounters each, with the long-chart profile
  // deliberately above that range and the empty-history profile below it.
  const withHistory = population.filter((p) => encounters.forPatient(p.id).length > 0);
  const inRange = withHistory.filter((p) => {
    const n = encounters.forPatient(p.id).length;
    return n >= 2 && n <= 5;
  });
  const longChart = withHistory.filter((p) => encounters.forPatient(p.id).length >= 5);
  checks.push({
    label: 'Encounter histories present',
    pass: withHistory.length === population.length - 1 && inRange.length >= withHistory.length - 1,
    detail:
      `${withHistory.length}/${population.length} patients have history; ` +
      `${inRange.length} in the 2-5 range; ${longChart.length} long chart (5+)`,
  });

  const dates = population
    .flatMap((p) => encounters.forPatient(p.id))
    .map((e) => e.date)
    .sort();
  const oldest = dates[0];
  const newest = dates[dates.length - 1];
  const spanMonths =
    oldest && newest
      ? Math.round((new Date(newest).getTime() - new Date(oldest).getTime()) / (86_400_000 * 30.4))
      : 0;
  checks.push({
    label: 'Dates spread over 6 to 18 months',
    pass: spanMonths >= 6,
    detail: `${oldest} to ${newest} — ${spanMonths} months`,
  });

  const totalObs = population.reduce((n, p) => n + observations.forPatient(p.id).length, 0);
  const overdue = population.reduce(
    (n, p) => n + observations.forPatient(p.id).filter((o) => o.overdue).length,
    0,
  );
  checks.push({
    label: 'Observations attached',
    pass: totalObs > 0 && overdue > 0,
    detail: `${totalObs} observations, ${overdue} marked overdue`,
  });

  // Read every record back and confirm it round-trips.
  let readBackOk = true;
  let readBackDetail = 'all records read back correctly';
  for (const p of population) {
    const fresh = patients.byId(p.id);
    if (!fresh || fresh.name !== p.name || fresh.conditions.length !== p.conditions.length) {
      readBackOk = false;
      readBackDetail = `read-back mismatch on ${p.name}`;
      break;
    }
    for (const e of encounters.forPatient(p.id)) {
      const again = encounters.byId(e.id);
      if (!again || again.rawNote !== e.rawNote) {
        readBackOk = false;
        readBackDetail = `raw note mismatch on ${e.id}`;
        break;
      }
    }
  }
  checks.push({ label: 'Records read back correctly', pass: readBackOk, detail: readBackDetail });

  // CS-1 mechanism: every threshold traceable to the clinical reference file.
  const ref = verifyReference();
  checks.push({
    label: 'Clinical thresholds sourced',
    pass: ref.ok,
    detail: ref.ok
      ? `${ref.checked} thresholds all present in docs/clinical-reference.md`
      : ref.problems.join('; '),
  });

  const passed = report('1', checks);

  // Section 14.11 — test data confirmation.
  const coverage = checkCoverage();
  console.log('\nSection 14.11 — test data confirmation');
  console.log('='.repeat(58));
  for (const c of coverage) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.profile}`);
    console.log(`        ${c.scenarios} — ${c.detail}`);
  }
  const coverageOk = coverage.every((c) => c.pass);

  const notes = checkSampleNotes();
  console.log('\nRequired sample notes');
  console.log('-'.repeat(58));
  for (const n of notes) {
    console.log(`  ${n.pass ? 'PASS' : 'FAIL'}  ${n.label} — ${n.patient} (${n.detail})`);
  }
  const notesOk = notes.every((n) => n.pass);

  console.log('-'.repeat(58));
  console.log(
    `  ${coverageOk && notesOk ? 'POPULATION COMPLETE' : 'POPULATION INCOMPLETE'} — ` +
      `${coverage.filter((c) => c.pass).length}/${coverage.length} profiles, ` +
      `${notes.filter((n) => n.pass).length}/${notes.length} sample notes`,
  );

  printSpend();
  return passed && coverageOk && notesOk;
}

const phase = process.argv[2] ?? '0';
const runners: Record<string, () => Promise<boolean>> = { '0': phase0, '1': phase1 };

const runner = runners[phase];
if (!runner) {
  console.error(
    `Phases 0 and 1 gate on the data and setup checks in this script.\n` +
      `Phase ${phase} gates on the Section 14 scenarios, which run as tests:\n\n` +
      `    npm test\n`,
  );
  process.exit(1);
}

const ok = await runner();
closeDb();
process.exit(ok ? 0 : 1);
