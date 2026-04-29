/** Vitest configuration for the MiniCRM server test suite (MINCRM-191, MINCRM-277). */

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * These test files mutate shared global tables (currencies, pipeline_stages,
 * is_demo rows, system_settings storage keys) or run team-wide aggregate queries
 * that are not owner-scoped. They must run serially to avoid cross-file interference.
 */
const SERIAL_FILES = [
  'src/__tests__/currencyService.test.ts',
  'src/__tests__/currencyConversion.test.ts',
  'src/__tests__/pipelineStageService.test.ts',
  'src/__tests__/demoService.test.ts',
  'src/__tests__/demoController.test.ts',
  'src/__tests__/demoSeed.test.ts',
  'src/__tests__/dashboardService.test.ts',
  // storageService writes file_storage_* keys to system_settings; running it
  // in parallel with attachmentController causes a race where the controller
  // test sees a non-null storage config and gets a 500 instead of 503.
  'src/__tests__/storageService.test.ts',
  // smtpSettingsService writes smtp_host/smtp_enabled to system_settings; running
  // it in parallel with emailService or contactController causes those tests to
  // attempt a real SMTP connection to smtp.example.com and fail with ENOTFOUND.
  'src/__tests__/smtpSettingsService.test.ts',
  // automationService creates enabled rules and fires global triggers that match
  // ALL enabled rules for the trigger type — parallel runs cause cross-file log
  // entries that break the toHaveLength(1) assertions.
  'src/__tests__/automationService.test.ts',
  // notificationService writes email_notifications_enabled to system_settings;
  // parallel tests resetting this key cause the overdue-digest logic to skip
  // sending and fail the dedup-row assertions.
  'src/__tests__/notificationService.test.ts',
  // importService and importController both call importAccounts(), which queries
  // ALL accounts globally (no owner filter) for duplicate detection. Running them
  // in parallel causes cross-file name collisions (e.g. 'Acme Corp') that flip
  // created/skipped counts and break the duplicate-detection assertions.
  'src/__tests__/importService.test.ts',
  'src/__tests__/importController.test.ts',
  // userService.countActiveNotificationRecipients queries ALL active users globally;
  // parallel tests creating/deleting users between the before/after count snapshots
  // cause the ">= countBefore + 1" assertion to flap.
  'src/__tests__/userService.test.ts',
];

const sharedResolve = {
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
};

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

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

    // Two inline projects: most files run in parallel; global-state files run serially.
    projects: [
      {
        extends: true,
        test: {
          name: 'parallel',
          include: ['src/__tests__/**/*.test.ts'],
          exclude: SERIAL_FILES,
          fileParallelism: true,
        },
        resolve: sharedResolve,
      },
      {
        extends: true,
        test: {
          name: 'serial',
          include: SERIAL_FILES,
          fileParallelism: false,
        },
        resolve: sharedResolve,
      },
    ],
  },

  resolve: sharedResolve,
});
