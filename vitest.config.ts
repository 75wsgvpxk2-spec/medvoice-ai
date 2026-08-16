import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    // Tests run against their own database file so a run never disturbs the
    // development population.
    env: {
      DB_PATH: path.resolve(import.meta.dirname, 'data', 'test.db'),
      SESSION_SECRET: 'test-secret-not-used-outside-tests',
      /*
       * The suite runs on the deterministic engine unless LIVE_MODEL is set.
       *
       * A contributor without an API key — or a maintainer whose account has
       * run out of credit — must still be able to run the tests, or the tests
       * stop being the thing that tells you whether a change is safe. Blanking
       * the key is enough: activeProvider() falls back to the local engine
       * exactly as it does for a clinic that has not configured one.
       *
       * The clinical assertions are about thresholds and rules, which the
       * encoded engine implements. Only tests asserting how the model *words*
       * something need the live path, and those declare it with itLive().
       */
      ...(process.env['LIVE_MODEL'] === '1' ? {} : { ANTHROPIC_API_KEY: '' }),
    },
    include: ['tests/**/*.test.ts'],
    // The agents write to a shared SQLite file, so suites run one at a time.
    fileParallelism: false,
    testTimeout: 300_000,   // live model calls take seconds, not milliseconds
    globals: true,
  },
});
