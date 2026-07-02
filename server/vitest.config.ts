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
  // pipelineService mutates the pipelines table globally (creates non-default pipelines,
  // renames the default pipeline); running in parallel with pipelineStageService or
  // dealService causes cross-file pipeline-id collisions and constraint violations.
  'src/__tests__/pipelineService.test.ts',
  // pipelineController creates non-default pipelines; running it in parallel with
  // pipelineService (which also creates/deletes pipelines) causes race conditions
  // on the pipelines table that produce spurious name-conflict or NOT_FOUND errors.
  'src/__tests__/pipelineController.test.ts',
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
  // Also deletes the smtp_configuration singleton row in one test to exercise
  // null-row defaults; any concurrent reader sees an empty table mid-delete. (MINCRM-502)
  'src/__tests__/smtpSettingsService.test.ts',
  // smtpController mutates the same system_settings SMTP keys as smtpSettingsService
  // above (via PUT /api/settings/smtp) and resets them in beforeEach; running in
  // parallel with any other SMTP-writing test causes the GET assertion to see
  // leftover smtp_host/smtp_enabled values from a concurrent write.
  'src/__tests__/smtpController.test.ts',
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
  // dealService relies on pipeline_stages being fully populated (probability JOINs,
  // excludeClosedStages subquery). pipelineStageService.test.ts deletes and re-seeds
  // stages in beforeEach, causing race conditions with parallel dealService queries.
  'src/__tests__/dealService.test.ts',
  // dealController creates deals that are not owner-scoped in exportDealsForCsv();
  // running in parallel with dealService causes the "returns an empty array" assertion
  // to see leaked rows from the controller tests.
  'src/__tests__/dealController.test.ts',
  // teamController and teamService both truncate teams/team_memberships in beforeEach;
  // running them in parallel causes cross-file row-delete races and FK violations.
  // visibilityService creates teams in beforeAll that teamService's beforeEach deletes
  // globally — must run serial alongside the other team-mutating files.
  'src/__tests__/teamController.test.ts',
  'src/__tests__/teamService.test.ts',
  'src/__tests__/visibilityService.test.ts',
  // bulkService and bulkController validate stage names via getStageNames(); pipelineStageService
  // deletes/re-seeds stages in beforeEach, causing stage-not-found errors in parallel runs.
  'src/__tests__/bulkService.test.ts',
  'src/__tests__/bulkController.test.ts',
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
  // ssoSettingsService writes sso_* keys to system_settings; running in parallel
  // with other settings-touching tests can cause key races. (MINCRM-399)
  'src/__tests__/ssoSettingsService.test.ts',
  // ssoService and ssoController create users (sso-test-* / sso-ctrl-test-*) and write
  // audit log entries; running in parallel with passwordReset.test.ts can cause
  // connection-pool contention that makes the session-invalidation timing assertions flap.
  'src/__tests__/ssoService.test.ts',
  'src/__tests__/ssoController.test.ts',
  // aiConfigService and aiConfigController both write ai_* keys to system_settings.
  // Running them in parallel causes beforeEach deletes to race with mid-test upserts
  // from the sibling file, producing stale model/dpa_acknowledged_by values.
  // (MINCRM-457)
  'src/__tests__/aiConfigService.test.ts',
  'src/__tests__/aiConfigController.test.ts',
  // aiTokenBudgetService uses fire-and-forget recordTokenUsage() that writes via
  // pool.query() without await. The 100ms settle wait is not sufficient under
  // parallel load — connection-pool contention delays the second upsert past the
  // assertion window.
  'src/__tests__/aiTokenBudgetService.test.ts',
  // rlsEnforcement creates/tears down a `minicrm_app` connection pool and inserts
  // fixture rows into RLS-protected tables. Running it in serial prevents races
  // between its cleanup queries and concurrent tests that also create contacts/deals/etc.
  // (MINCRM-518)
  'src/__tests__/rlsEnforcement.test.ts',
  // scimService creates SCIM teams and members; running in parallel with teamService
  // or teamController causes cross-file teams/team_memberships races.
  'src/__tests__/scimService.test.ts',
  // scimController uses the Express app to test /scim/v2/* endpoints with a real bearer
  // token; running in parallel with scimService or teamService causes FK races.
  'src/__tests__/scimController.test.ts',
  // featureFlagService contains a 6-second TTL cap test that mutates feature_flags directly.
  // featureFlagController resets feature_flags in beforeEach. Running both in parallel causes
  // the TTL test's DB state to be clobbered mid-sleep, making mobile_access appear un-scheduled
  // when the cache reloads after the TTL fires. (MINCRM-488, MINCRM-489)
  'src/__tests__/featureFlagService.test.ts',
  'src/__tests__/featureFlagController.test.ts',
  // sequenceController's duplicate-enrollment test (expect 409) races with other tests'
  // beforeEach deletes on sequence_enrollments, which can remove the first enrollment
  // between the two POST calls and let the second POST return 201 instead of 409.
  'src/__tests__/sequenceController.test.ts',
  // retentionService and aiRetentionController write ai_configuration.ai_session_retention_days
  // and read global ai_sessions/ai_messages counts; running in parallel with any test that
  // creates AI sessions (e.g. aiConfigController) would make the count/purge assertions flap.
  // (MINCRM-462)
  'src/__tests__/retentionService.test.ts',
  'src/__tests__/aiRetentionController.test.ts',
  // piiFilter deletes and writes ai_field_exclusions (global table, no per-test scoping
  // key) and exercises piiFilter's in-memory admin-exclusion cache; running in parallel
  // with aiFieldExclusionService/aiFieldExclusionController (same table) would race on
  // beforeEach cleanup vs. concurrent inserts. (MINCRM-461)
  'src/__tests__/piiFilter.test.ts',
  'src/__tests__/aiFieldExclusionService.test.ts',
  'src/__tests__/aiFieldExclusionController.test.ts',
  // aiUsageDashboardService writes ai_configuration.ai_input/output_cost_per_million_cents
  // (the same global singleton row aiConfigService/aiConfigController mutate) and reads
  // ai_token_usage_daily; running in parallel with those files or with aiTokenBudgetService
  // (which also writes ai_token_usage_daily now) would race on cost-rate resets and usage
  // aggregation totals. (MINCRM-459)
  'src/__tests__/aiUsageDashboardService.test.ts',
  // dealHealthService toggles ai_configuration.enabled/api_key_encrypted (the same global
  // singleton row aiConfigService/aiConfigController/aiUsageDashboardService mutate); running
  // in parallel would race on the enabled flag and cause spurious 503s in either suite. (MINCRM-442)
  'src/__tests__/dealHealthService.test.ts',
  // stageAdvancementService toggles the same ai_configuration singleton row as
  // dealHealthService AND creates non-default pipelines/stages (same pipelines-table
  // race as pipelineService/pipelineStageService/pipelineController/dealService). (MINCRM-443)
  'src/__tests__/stageAdvancementService.test.ts',
  // winLossAnalysisService toggles ai_configuration.enabled/win_loss_* thresholds (same
  // global singleton row) and truncates the global deal_win_loss_insights cache table on
  // every run — parallel runs would race on both. (MINCRM-464)
  'src/__tests__/winLossAnalysisService.test.ts',
  // winLossInsightController calls the global feature-flag cache-clear (__clearCacheForTest)
  // while toggling the ai_win_loss_insights row — same class of race as featureFlagService/
  // featureFlagController above, since the cache is process-wide, not per-file. (MINCRM-464)
  'src/__tests__/winLossInsightController.test.ts',
  // championBlockerService toggles ai_configuration.enabled/api_key_encrypted (same global
  // singleton row as dealHealthService/stageAdvancementService/winLossAnalysisService). (MINCRM-466)
  'src/__tests__/championBlockerService.test.ts',
  // churnExpansionService toggles the same ai_configuration singleton row as the other
  // nightly-job test suites above. (MINCRM-469)
  'src/__tests__/churnExpansionService.test.ts',
  // objectionMatchingService toggles the same ai_configuration singleton row as the other
  // on-demand AI test suites above. (MINCRM-471)
  'src/__tests__/objectionMatchingService.test.ts',
  // objectionMatchingController toggles the same ai_configuration singleton row. (MINCRM-471)
  'src/__tests__/objectionMatchingController.test.ts',
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
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
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
          // seedDemo() is heavier now — notes, custom fields, webhooks, currencies.
          // removeDemo tests call seedDemo()+removeDemo() four times in sequence; 60s
          // allows each call up to ~15s on a loaded machine.
          testTimeout: 60000,
        },
        resolve: sharedResolve,
      },
    ],
  },

  resolve: sharedResolve,
});
