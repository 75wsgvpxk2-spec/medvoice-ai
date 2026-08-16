import { seed } from '../server/src/db/seed.ts';
import { closeDb } from '../server/src/db/index.ts';
import { config } from '../server/src/lib/config.ts';
import { InstallationConflict } from '../server/src/lib/installation.ts';

let result: ReturnType<typeof seed>;
try {
  result = seed();
} catch (error) {
  closeDb();
  // A refusal is an expected outcome here, not a crash. A stack trace would
  // bury the one line that says what to do about it.
  if (error instanceof InstallationConflict) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

console.log('\nSeed population loaded');
console.log('-'.repeat(50));
console.log(`  Clinician         ${result.clinicianId} (${config.clinicianEmail})`);
console.log(`  Patients          ${result.patients}`);
console.log(`  Encounters        ${result.encounters}`);
console.log(`  Observations      ${result.observations}`);
console.log(`  Billing entries   ${result.billingEntries}`);
console.log(`  Overdue markers   ${result.overdueObservations}`);
console.log('\n  All patient data is fictional (Section 15).\n');

closeDb();
