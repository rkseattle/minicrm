/**
 * Vitest configuration for the MiniCRM server test suite (MINCRM-191).
 *
 * Replaces Jest (--runInBand --forceExit) with Vitest's native ESM/TS
 * compilation. All test files execute sequentially (fileParallelism: false)
 * because 28 of 33 files use broad `DELETE FROM <table>` statements without
 * per-file owner scoping; true parallel file execution requires scoping those
 * DELETEs and is tracked as follow-up work.
 *
 * Wall-clock improvement comes from dropping ts-jest + --experimental-vm-modules
 * in favour of Vitest's built-in esbuild transform (~15 s vs ~8-10 min locally).
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    /**
     * fileParallelism: false — test files execute sequentially.
     * See header comment for why parallel execution is not yet safe.
     */
    fileParallelism: false,
    include: ['src/__tests__/**/*.test.ts'],

    /**
     * globalSetup runs once in the main Vitest process before any worker is
     * spawned. Creates the test DB if absent and applies all migrations.
     * DB credentials are loaded from .env.test via the DOTENV_CONFIG_PATH env
     * var set in the npm scripts (required for local runs; CI injects real vars).
     */
    globalSetup: './src/__tests__/globalSetup.ts',

    // JUnit XML for dorny/test-reporter in CI; 'default' keeps console output.
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/junit.xml' },

    coverage: {
      provider: 'v8',
      include: ['src/services/**/*.ts', 'src/controllers/**/*.ts'],
      // text: console summary; lcov: for tooling; json-summary: machine-readable
      // totals parsed by the CI coverage-comment step.
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        /**
         * Glob keys are matched by picomatch against relative file paths.
         * Trailing-slash patterns (e.g. 'src/services/') never match file
         * paths — use '**' to cover all files in the directory.
         */
        'src/services/**': {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        'src/controllers/**': {
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
      /**
       * Subsumes both Jest moduleNameMapper patterns:
       *   ^@minicrm/shared/schemas/(.*)\\.js$  (with extension)
       *   ^@minicrm/shared/schemas/(.*)$       (without extension)
       * Vitest's Rollup-based resolver treats this as a prefix substitution
       * so both import forms resolve correctly via the single entry.
       */
      '@minicrm/shared/schemas': resolve(__dirname, '../shared/schemas'),
    },
  },
});
