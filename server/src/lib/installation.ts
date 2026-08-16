import { settings as store } from '../db/repositories.ts';

/**
 * What this database is for.
 *
 * The hazard this exists to prevent is quiet and serious: a clinic runs the
 * demo to try the system, likes it, and starts entering real patients into the
 * same database. Fifteen fictional people are then indistinguishable from real
 * ones three screens in, and Section 15's "all patient data is fictional" stops
 * being true without anything having gone visibly wrong.
 *
 * So the mode is recorded once, at install, and the two directions are treated
 * very differently:
 *
 * - demo → clinic is a real decision, and requires wiping the database. There
 *   is no in-place upgrade, because the point is that the fictional records go.
 * - clinic → demo is refused outright. Loading fictional patients into a
 *   database holding real ones is the more dangerous direction and has no
 *   legitimate use.
 *
 * While a database is in demo mode the interface says so on every screen. An
 * unlabelled demo is how fictional data gets mistaken for real data.
 */

const KEY = 'installation';

export type InstallationMode = 'demo' | 'clinic';

export interface Installation {
  mode: InstallationMode;
  createdAt: string;
}

export function current(): Installation | null {
  return (store.raw(KEY) as Installation | null) ?? null;
}

/** Demo until proven otherwise: an unmarked database is not a clinic's. */
export function mode(): InstallationMode {
  return current()?.mode ?? 'demo';
}


export function record(next: InstallationMode): Installation {
  const installation: Installation = { mode: next, createdAt: new Date().toISOString() };
  store.put(KEY, installation, 'system');
  return installation;
}

/** Thrown by the seeder and the setup script rather than handled in a route. */
export class InstallationConflict extends Error {}

/**
 * Refuses to load fictional patients into a clinic's database.
 *
 * Called by the seeder before it writes anything, so the check cannot be
 * bypassed by running the script directly rather than through npm.
 */
export function assertDemoSeedAllowed(): void {
  const installed = current();
  if (installed && installed.mode === 'clinic') {
    throw new InstallationConflict(
      'This database was set up for a clinic and may hold real patient records.\n' +
        'Loading the fictional demo population into it is refused.\n\n' +
        'If this really is a scratch database, wipe it first:  npm run db:reset',
    );
  }
}

/** Refuses to set up a clinic on top of a database already holding demo data. */
export function assertSetupAllowed(patientCount: number): void {
  const installed = current();
  if (installed?.mode === 'clinic') {
    throw new InstallationConflict(
      'This database is already set up for a clinic. Nothing has been changed.',
    );
  }
  if (patientCount > 0) {
    throw new InstallationConflict(
      `This database holds ${patientCount} patient record${patientCount === 1 ? '' : 's'} from the demo population.\n` +
        'A clinic installation starts empty, so that no fictional patient can ever be\n' +
        'mistaken for a real one.\n\n' +
        'Wipe it and run setup again:  npm run db:reset && npm run setup',
    );
  }
}
