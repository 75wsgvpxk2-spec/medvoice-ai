/**
 * First-run setup for a clinic.
 *
 *   npm run setup
 *
 * Creates an empty database with one clinician account and the clinic's own
 * details. No patients: a clinic installation starts empty so that no fictional
 * record can ever be mistaken for a real one.
 *
 * This is the counterpart to `npm run seed`, which loads the fictional demo
 * population. The two are mutually exclusive by design — see
 * server/src/lib/installation.ts for why.
 *
 * Answers can be piped in for an unattended install:
 *
 *   printf 'Bay Street Clinic\\nDr Ada Kwame\\nMBBS\\nada@example.com\\n' | npm run setup
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { clinicians, clinic as clinicRepo, audit } from '../server/src/db/repositories.ts';
import { hashPassword } from '../server/src/lib/auth.ts';
import { DEFAULT_BRAND } from '../shared/types.ts';
import { db, closeDb, id } from '../server/src/db/index.ts';
import { ROOT } from '../server/src/lib/config.ts';
import {
  assertSetupAllowed,
  InstallationConflict,
  record as recordInstallation,
} from '../server/src/lib/installation.ts';

/**
 * Prompts at a terminal, and reads piped answers when there isn't one.
 *
 * readline's promised question never settles once stdin has ended, so a piped
 * install would hang on the second prompt. Non-interactive input is therefore
 * drained up front and consumed line by line.
 */
const interactive = stdin.isTTY === true;
const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;

let piped: string[] = [];
if (!interactive) {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  piped = Buffer.concat(chunks).toString('utf8').split('\n');
}
let pipedIndex = 0;

async function ask(question: string, fallback = ''): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : '';
  if (rl) {
    const answer = (await rl.question(`  ${question}${suffix}: `)).trim();
    return answer || fallback;
  }
  const answer = (piped[pipedIndex++] ?? '').trim();
  console.log(`  ${question}${suffix}: ${answer || fallback}`);
  return answer || fallback;
}

/**
 * Writes a real session secret into .env if there is not one already.
 *
 * The self-serve path must not be able to produce an installation with a
 * guessable signing key. Doing it here rather than asking means nobody has to
 * know why it matters.
 */
function ensureSessionSecret(): 'generated' | 'existing' | 'no-env-file' {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return 'no-env-file';

  const contents = fs.readFileSync(envPath, 'utf8');
  const match = contents.match(/^SESSION_SECRET=(.*)$/m);
  const current = (match?.[1] ?? '').trim();
  if (current.length >= 32 && current !== 'change-me-to-a-long-random-string') return 'existing';

  const secret = randomBytes(32).toString('hex');
  const next = match
    ? contents.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`)
    : `${contents.trimEnd()}\nSESSION_SECRET=${secret}\n`;
  fs.writeFileSync(envPath, next, { mode: 0o600 });
  return 'generated';
}

async function main(): Promise<void> {
  const secretState = ensureSessionSecret();

  // Opening the connection applies the schema and any migrations.
  db();

  const anyPatients = (db().prepare('SELECT COUNT(*) AS n FROM patient').get() as { n: number }).n;
  assertSetupAllowed(anyPatients);

  console.log('\nClinical Intelligence — clinic setup');
  console.log('='.repeat(52));
  console.log('This creates an empty record system with one sign-in.');
  console.log('No patients are created. Nothing here is fictional.\n');

  const clinicName = await ask('Clinic name', 'My Clinic');
  const clinicianName = await ask('Your full name', 'Dr Example');
  const credentials = await ask('Your credentials', 'MBBS');
  const email = await ask('Sign-in email');

  if (!email || !email.includes('@')) {
    console.error('\nA sign-in email is required. Nothing has been changed.\n');
    rl?.close();
    closeDb();
    process.exitCode = 1;
    return;
  }

  // Generated rather than prompted: a password typed at a terminal is echoed to
  // the screen and lands in shell history. This one is shown once, here.
  const password = randomBytes(9).toString('base64url');
  const { hash, salt } = hashPassword(password);
  const clinicianId = id('clin');

  clinicians.insert({
    id: clinicianId,
    name: clinicianName,
    credentials,
    email,
    passwordHash: hash,
    passwordSalt: salt,
    role: 'admin',
  });

  clinicRepo.save({
    name: clinicName,
    legalName: clinicName,
    // Changeable in Clinic profile; USD is only the starting point.
    currency: 'USD',
    registration: '',
    address: '',
    phone: '',
    email,
    website: '',
    logo: null,
    letterhead: null,
    ...DEFAULT_BRAND,
    primaryDoctor: clinicianName,
  });

  recordInstallation('clinic');

  audit.record({
    actor: 'system',
    actorName: 'Setup',
    action: 'installation.created',
    entityType: 'installation',
    summary: `Set up ${clinicName} with one clinician account (${email}). No patient records were created.`,
  });

  console.log(`\n${'='.repeat(52)}`);
  console.log('  Setup complete.\n');
  if (secretState === 'generated') {
    console.log('  A session signing key was generated and written to .env.');
  } else if (secretState === 'no-env-file') {
    console.log('  NOTE: no .env file found. Copy .env.example to .env and set');
    console.log('        SESSION_SECRET before running this in a clinic.');
  }
  console.log(`  Clinic     ${clinicName}`);
  console.log(`  Sign in    ${email}`);
  console.log(`  Password   ${password}`);
  console.log('\n  Write the password down now — it is not stored anywhere in');
  console.log('  readable form and cannot be shown again.\n');
  console.log('  Next:  npm run dev     then sign in and add your first patient.');
  console.log('         Settings holds the model key, units and thresholds.\n');

  rl?.close();
  closeDb();
}

try {
  await main();
} catch (error) {
  rl?.close();
  closeDb();
  if (error instanceof InstallationConflict) {
    console.error(`\n${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
