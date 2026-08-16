import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config, ROOT } from './lib/config.ts';
import * as settings from './lib/settings.ts';
import { installResolver } from './lib/thresholds.ts';
import { db } from './db/index.ts';
import { api } from './routes/api.ts';
import { verifyReference } from './clinical/reference.ts';
import { clinicians } from './db/repositories.ts';

const app = express();

// Express 5 removed res.cookie helpers from the base response in some setups;
// these are the only two cookie operations the API performs.
app.use((_req, res, next) => {
  res.cookie = function cookie(name: string, value: string, options: Record<string, unknown> = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
    if (options['httpOnly']) parts.push('HttpOnly');
    if (options['secure']) parts.push('Secure');
    if (options['sameSite']) parts.push(`SameSite=${String(options['sameSite'])}`);
    if (typeof options['maxAge'] === 'number') parts.push(`Max-Age=${Math.floor(options['maxAge'] / 1000)}`);
    res.append('Set-Cookie', parts.join('; '));
    return res;
  } as typeof res.cookie;

  res.clearCookie = function clearCookie(name: string) {
    res.append('Set-Cookie', `${name}=; Path=/; Max-Age=0`);
    return res;
  } as typeof res.clearCookie;

  next();
});

// Clinic threshold adjustments must be live before the first rule evaluates.
installResolver();

app.use('/api', api);

// In production the built client is served from the same origin.
const clientDist = path.join(ROOT, 'client', 'dist');
if (config.isProd && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

/* --------------------------------------------------------------- startup -- */

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
