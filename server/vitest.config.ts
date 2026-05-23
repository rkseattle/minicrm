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
  // auth-boundaries deletes deals/contacts/accounts which fires fireAutomationTrigger
  // globally. When automationService runs in parallel it leaves enabled rules alive
  // mid-test; the trigger finds them, tries to write automation_rule_logs, then the
  // rule is deleted by automationService beforeEach — causing an FK violation that
  // Vitest surfaces as an unhandled error and exits non-zero.
  'src/__tests__/auth-boundaries.test.ts',
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
  // settingsService writes default_currency to system_settings; parallel runs cause
  // duplicate-key races on the INSERT in getDefaultCurrency tests.
  'src/__tests__/settingsService.test.ts',
  // noteService uses ALTER TABLE audit_log DISABLE TRIGGER in beforeAll/afterAll;
  // running in parallel with auditService races on the trigger's enabled/disabled state.
  'src/__tests__/noteService.test.ts',
  // gdprService uses ALTER TABLE audit_log DISABLE TRIGGER in beforeEach/afterAll;
  // running in parallel with auditService races on the trigger's enabled/disabled state.
  // (MINCRM-364)
  'src/__tests__/gdprService.test.ts',
  // activityService, auditService, and leadsService write to audit_log; when
  // noteService/gdprService disable the audit_log_no_modify trigger mid-run,
  // the immutability check fires P0001 on concurrent INSERT attempts.
  'src/__tests__/activityService.test.ts',
  'src/__tests__/auditService.test.ts',
  'src/__tests__/leadsService.test.ts',
  // customFieldService and customFieldController query global custom_field_definitions;
  // demoService/demoController (serial) create definitions that pollute the table when
  // running simultaneously with the parallel project.
  'src/__tests__/customFieldService.test.ts',
  'src/__tests__/customFieldController.test.ts',
  // contactController's send-email tests check that an Email activity is created;
  // smtpSettingsService running in parallel can set smtp_host mid-test which causes
  // the activity query to return 0 results if the write races with the read.
  'src/__tests__/contactController.test.ts',
  // pipelineStageController creates and deletes pipeline_stages rows; running in
  // parallel with other tests that read the live stage list (e.g. dealController)
  // can cause unexpected stage counts or name conflicts.
  'src/__tests__/pipelineStageController.test.ts',
  // dealController creates deals that are not owner-scoped in exportDealsForCsv();
  // running in parallel with dealService causes the "returns an empty array" assertion
  // to see leaked rows from the controller tests.
  'src/__tests__/dealController.test.ts',
  // webhookController creates active webhook subscriptions that fire real async
  // deliveries on any contact/deal creation. Parallel tests creating contacts cause
  // delivery attempts against subscriptions being deleted by webhookController's
  // afterAll, producing FK violations on webhook_delivery_logs.
  'src/__tests__/webhookController.test.ts',
  // webhookService.dispatchWebhookEvent fires async deliveries that race with vi.spyOn
  // DNS mocks in parallel workers; the delivery picks up ALL active subscriptions in the
  // shared test DB, so cross-file subscription state causes status_code: null failures.
  'src/__tests__/webhookService.test.ts',
  // loginLockoutService uses a module-level in-memory Map. _resetStoreForTesting() clears
  // it in beforeEach, but parallel workers share the same Node process and can fire
  // concurrent login requests that pollute the counter mid-test.
  'src/__tests__/loginLockout.test.ts',
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
      include: [
        'src/services/**/*.ts',
        'src/controllers/**/*.ts',
        'src/middleware/**/*.ts',
        'src/utils/**/*.ts',
      ],
      // text: console summary; lcov: for tooling; json-summary: machine-readable
      // totals parsed by the CI coverage-comment step.
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 80,
        functions: 80,
        // Branch coverage sits at 74.7% today — many controller error paths and
        // service edge cases are not yet exercised. Set the floor at the current
        // measured value so CI fails if coverage drops, not at an aspirational
        // number the codebase does not yet reach.
        branches: 74,
        statements: 80,
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
          // seedDemo() is heavier now — notes, custom fields, webhooks, currencies
          testTimeout: 30000,
        },
        resolve: sharedResolve,
      },
    ],
  },

  resolve: sharedResolve,
});
