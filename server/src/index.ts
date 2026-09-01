import { checkTestDouble, checkSessionSecret, config } from './lib/config.ts';
import { createApp } from './app.ts';
import * as settings from './lib/settings.ts';
import { installResolver } from './lib/thresholds.ts';
import { startScheduler } from './orchestration/automations.ts';
import { db } from './db/index.ts';
import { api } from './routes/api.ts';
import { verifyReference } from './clinical/reference.ts';
import { clinicians } from './db/repositories.ts';

// Before anything can issue a cookie signed with it.
checkSessionSecret();
checkTestDouble();

// The scheduler is boot work: importing the app must not start timers.
startScheduler();

const app = createApp();

db();

// CS-1 runs at startup as well as in the test suite: if the reference file and
// the code have drifted apart, that is a clinical safety problem and the server
// says so loudly rather than starting with unsourced numbers.
const reference = verifyReference();
if (!reference.ok) {
  console.error('\nClinical reference check FAILED. The server will not start.\n');
  for (const problem of reference.problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const clinicianCount = (db().prepare('SELECT COUNT(*) AS n FROM clinician').get() as { n: number }).n;

app.listen(config.port, () => {
  console.log(`\nCaribbean Clinical Intelligence Platform`);
  console.log(`  API            http://localhost:${config.port}/api`);
  console.log(`  Clinical rules ${reference.checked} thresholds verified against docs/clinical-reference.md`);
  // Read through settings, so the banner reflects a key entered in the
  // interface and not only one present in the environment at boot.
  const provider = settings.activeProvider();
  console.log(
    `  Model          ${
      provider === 'anthropic'
        ? `live (${settings.modelId()}, key from ${settings.apiKeySource()})`
        : 'deterministic engine — no API key set'
    }`,
  );
  if (clinicianCount === 0) {
    console.log(`\n  No population loaded. Run: npm run seed\n`);
  } else {
    const clinician = clinicians.byEmail(config.clinicianEmail);
    console.log(`  Sign in as     ${config.clinicianEmail}${clinician ? '' : '  (not found — run npm run seed)'}\n`);
  }
});
