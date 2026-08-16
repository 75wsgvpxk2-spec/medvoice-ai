import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    // Tests run against their own database file so a run never disturbs the
    // development population.
    env: {
      DB_PATH: path.resolve(import.meta.dirname, 'data', 'test.db'),
      SESSION_SECRET: 'test-secret-not-used-outside-tests',
    },
    include: ['tests/**/*.test.ts'],
    // The agents write to a shared SQLite file, so suites run one at a time.
    fileParallelism: false,
    testTimeout: 300_000,   // live model calls take seconds, not milliseconds
    globals: true,
  },
});
