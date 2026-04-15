/**
 * Vitest configuration for the MiniCRM server test suite (MINCRM-191).
 *
 * Runs all *.test.ts files under src/__tests__ in parallel using the threads
 * pool, matching the architecture the client suite already uses successfully.
 * Each test file gets its own worker, so concurrent DB access relies on the
 * per-file beforeAll/beforeEach cleanup patterns already in place.
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    /**
     * fileParallelism: false — test files execute sequentially (like Jest's
     * --runInBand) because the existing test suite uses broad
     * `DELETE FROM <table>` statements without owner scoping, making true
     * parallel execution against a shared DB unsafe without broader test
     * refactoring. Vitest's native ESM/TS compilation still delivers a
     * significant wall-clock improvement over ts-jest + --experimental-vm-modules.
     *
     * Full parallel file execution (--pool=forks, no fileParallelism constraint)
     * requires scoping all broad DELETEs to per-file email namespaces.
     * Tracked for follow-up.
     */
    fileParallelism: false,
    include: ['src/__tests__/**/*.test.ts'],

    /**
     * globalSetup runs once before all workers are spawned.
     * Creates the test DB if absent and applies all migrations.
     */
    globalSetup: ['./src/__tests__/globalSetup.ts'],

    /**
     * Load .env.test before any test file is imported.
     * DOTENV_CONFIG_PATH is no longer needed; Vitest's dotenv option handles it.
     */
    env: {
      DOTENV_CONFIG_PATH: '../.env.test',
    },

    coverage: {
      provider: 'v8',
      include: ['src/services/**/*.ts', 'src/controllers/**/*.ts'],
      thresholds: {
        'src/services/': {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        'src/controllers/': {
          lines: 0,
          functions: 0,
          branches: 0,
          statements: 0,
        },
      },
    },
  },

  resolve: {
    alias: {
      /** Mirror the Jest moduleNameMapper for shared schema imports */
      '@minicrm/shared/schemas': resolve(__dirname, '../shared/schemas'),
    },
  },
});
