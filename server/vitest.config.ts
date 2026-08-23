/** Vitest configuration for the MiniCRM server test suite. */

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Per-test timeout for the parallel project. 20s, not Vitest's 5s default: the
 * default was never chosen for this project — the serial project set its own and
 * the parallel one silently inherited 5s, which is below the cost of the work
 * these tests do. Measured on an idle machine, bcryptjs.hash at
 * BCRYPT_SALT_ROUNDS=12 takes ~213ms per call and bcryptjs is pure JS, so it
 * blocks the worker's event loop rather than using libuv's threadpool.
 * auth.test (15 hash-path calls), mfaService.test (17) and
 * passwordComplexity.test (9) therefore spend seconds in hashing alone before
 * any DB work. Lowering the cost factor for tests would weaken the thing under
 * test, so the budget is what moves.
 */
const PARALLEL_TEST_TIMEOUT_MS = 20_000;

/**
 * Hook timeout, set explicitly alongside every testTimeout in this file.
 *
 * Vitest resolves hookTimeout INDEPENDENTLY of testTimeout and defaults it to
 * 10s, so raising only testTimeout leaves hooks on the old budget. That gap is
 * not theoretical here: most of the bcrypt cost cited above is in hooks, not
 * test bodies — mfaService.test.ts has 9 beforeAll/beforeEach blocks and its
 * enableMfa beforeEach hashes a whole batch of recovery codes
 * (mfaService.ts:365). A 20s test budget with a 10s hook budget fails as
 * "Hook timed out in 10000ms" while the test budget goes unused.
 */
const HOOK_TIMEOUT_MS = 30_000;

/**
 * Per-test timeout for the serial project. seedDemo() is heavy — notes, custom
 * fields, webhooks, currencies — and the removeDemo tests call
 * seedDemo()+removeDemo() four times in sequence; 60s allows each call ~15s.
 * That work is itself hook work, which is why HOOK_TIMEOUT_MS applies here too.
 */
const SERIAL_TEST_TIMEOUT_MS = 60_000;

/**
 * These test files mutate shared global tables (currencies, pipeline_stages,
 * is_demo rows, system_settings storage keys) or run team-wide aggregate queries
 * that are not owner-scoped. They must run serially to avoid cross-file interference.
 *
 * To be clear about what this list is: it is TEST-DESIGN DEBT, not a property of
 * the runner or the machine. Each entry is a file that writes global state without
 * scoping it to itself, so a sibling file reading that state mid-write sees someone
 * else's data. Vitest parallelizes fine — the other 105 files run at 6 workers with
 * no interference at all. But note the split: 98 serial of 203 total is roughly
 * half the suite, not a handful of exceptions.
 *
 * The durable fix for any entry is to scope its writes (per-test prefixes, its own
 * pipeline/team/settings row) rather than to add another filename here. Quarantining
 * is the cheap fix and it compounds: every addition makes the serial project longer
 * and the suite slower, and the serial project cannot be parallelized later without
 * doing the scoping work anyway. Prefer fixing the file.
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
  // testUtils asserts on the OLDEST active admin across the whole users table and
  // deliberately creates admins that win that ordering; in parallel it would both
  // perturb and be perturbed by any other file's admin fixture.
  'src/__tests__/testUtils.test.ts',
  'src/__tests__/dashboardService.test.ts',
  // storageService writes file_storage_* keys to system_settings; running it
  // in parallel with attachmentController causes a race where the controller
  // test sees a non-null storage config and gets a 500 instead of 503.
  'src/__tests__/storageService.test.ts',
  // smtpSettingsService writes smtp_host/smtp_enabled to system_settings; running
  // it in parallel with emailService or contactController causes those tests to
  // attempt a real SMTP connection to smtp.example.com and fail with ENOTFOUND.
  // Also deletes the smtp_configuration singleton row in one test to exercise
  // null-row defaults; any concurrent reader sees an empty table mid-delete.
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
  // automationController itself must ALSO be serial, not just
  // automationService above: automationController creates its OWN enabled
  // rules and asserts an EMPTY automation_rule_logs list for a rule it just
  // created — any OTHER parallel file that deletes a contact/deal/account
  // (fireAutomationTrigger runs globally against ALL enabled rules, not
  // scoped to the calling test file) can write a log row against
  // automationController's rule in the gap between its rule creation and its
  // "expect(logs).toHaveLength(0)" assertion (reproduced live: a full
  // parallel run failed automationController's logs test with "expected 0
  // to be 1"; the same file passed 23/23 in isolation) — same root cause as
  // automationService/auth-boundaries above, just a different trigger file.
  'src/__tests__/automationController.test.ts',
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
  'src/__tests__/gdprService.test.ts',
  // appEnvGating deletes and reassigns process.env.NODE_ENV and re-imports app.ts
  // to observe its module-eval gates. Vitest's fork isolation contains that today,
  // but the containment is a config default this file should not depend on.
  'src/__tests__/appEnvGating.test.ts',
  // gdprController erases records, and erasure fires the AI cascade, whose
  // UPDATE/DELETE statements carry no ownership predicate — they scan
  // ai_messages, ai_sessions, and user_ai_context instance-wide. In parallel it
  // would both perturb and be perturbed by the aiContext and aiSession suites.
  'src/__tests__/gdprController.test.ts',
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
  // globally — must run serial alongside the other team-mutating files. Also resets the
  // entire org_visibility_settings table wholesale and mutates individual object_type
  // rows directly — same class of race as followUpTimingController et al. below.
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
  // with other settings-touching tests can cause key races.
  'src/__tests__/ssoSettingsService.test.ts',
  // ssoService and ssoController create users (sso-test-* / sso-ctrl-test-*) and write
  // audit log entries; running in parallel with passwordReset.test.ts can cause
  // connection-pool contention that makes the session-invalidation timing assertions flap.
  'src/__tests__/ssoService.test.ts',
  'src/__tests__/ssoController.test.ts',
  // aiConfigService and aiConfigController both write ai_* keys to system_settings.
  // Running them in parallel causes beforeEach deletes to race with mid-test upserts
  // from the sibling file, producing stale model/dpa_acknowledged_by values.
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
  // when the cache reloads after the TTL fires.
  'src/__tests__/featureFlagService.test.ts',
  'src/__tests__/featureFlagController.test.ts',
  // sequenceController's duplicate-enrollment test (expect 409) races with other tests'
  // beforeEach deletes on sequence_enrollments, which can remove the first enrollment
  // between the two POST calls and let the second POST return 201 instead of 409.
  'src/__tests__/sequenceController.test.ts',
  // retentionService and aiRetentionController write ai_configuration.ai_session_retention_days
  // and read global ai_sessions/ai_messages counts; running in parallel with any test that
  // creates AI sessions (e.g. aiConfigController) would make the count/purge assertions flap.
  'src/__tests__/retentionService.test.ts',
  'src/__tests__/aiRetentionController.test.ts',
  // piiFilter deletes and writes ai_field_exclusions (global table, no per-test scoping
  // key) and exercises piiFilter's in-memory admin-exclusion cache; running in parallel
  // with aiFieldExclusionService/aiFieldExclusionController (same table) would race on
  // beforeEach cleanup vs. concurrent inserts.
  'src/__tests__/piiFilter.test.ts',
  'src/__tests__/aiFieldExclusionService.test.ts',
  'src/__tests__/aiFieldExclusionController.test.ts',
  // aiUsageDashboardService writes ai_configuration.ai_input/output_cost_per_million_cents
  // (the same global singleton row aiConfigService/aiConfigController mutate) and reads
  // ai_token_usage_daily; running in parallel with those files or with aiTokenBudgetService
  // (which also writes ai_token_usage_daily now) would race on cost-rate resets and usage
  // aggregation totals.
  'src/__tests__/aiUsageDashboardService.test.ts',
  // dealHealthService toggles ai_configuration.enabled/api_key_encrypted (the same global
  // singleton row aiConfigService/aiConfigController/aiUsageDashboardService mutate); running
  // in parallel would race on the enabled flag and cause spurious 503s in either suite.
  'src/__tests__/dealHealthService.test.ts',
  // stageAdvancementService toggles the same ai_configuration singleton row as
  // dealHealthService AND creates non-default pipelines/stages (same pipelines-table
  // race as pipelineService/pipelineStageService/pipelineController/dealService).
  'src/__tests__/stageAdvancementService.test.ts',
  // winLossAnalysisService toggles ai_configuration.enabled/win_loss_* thresholds (same
  // global singleton row) and truncates the global deal_win_loss_insights cache table on
  // every run — parallel runs would race on both.
  'src/__tests__/winLossAnalysisService.test.ts',
  // winLossInsightController calls the global feature-flag cache-clear (__clearCacheForTest)
  // while toggling the ai_win_loss_insights row — same class of race as featureFlagService/
  // featureFlagController above, since the cache is process-wide, not per-file.
  'src/__tests__/winLossInsightController.test.ts',
  // championBlockerService toggles ai_configuration.enabled/api_key_encrypted (same global
  // singleton row as dealHealthService/stageAdvancementService/winLossAnalysisService).
  'src/__tests__/championBlockerService.test.ts',
  // championBlockerController reads the ai_champion_blocker_detection feature flag directly
  // (no ai_configuration mutation of its own, hence previously safe in the parallel project),
  // but several test files now toggle that same flag off/on around
  // createActivity() calls — must run serial to avoid racing those toggles.
  // Also flips org_visibility_settings.policy for 'contact'/'deal' directly via raw SQL —
  // same class of race as followUpTimingController et al. above.
  'src/__tests__/championBlockerController.test.ts',
  // churnExpansionService toggles the same ai_configuration singleton row as the other
  // nightly-job test suites above.
  'src/__tests__/churnExpansionService.test.ts',
  // objectionMatchingService toggles the same ai_configuration singleton row as the other
  // on-demand AI test suites above.
  'src/__tests__/objectionMatchingService.test.ts',
  // objectionMatchingController toggles the same ai_configuration singleton row.
  // Also flips org_visibility_settings.policy for 'activity' directly via raw SQL — same
  // class of race as followUpTimingController et al. above.
  'src/__tests__/objectionMatchingController.test.ts',
  // proposalDraftService toggles the same ai_configuration singleton row as the other
  // on-demand AI test suites above.
  'src/__tests__/proposalDraftService.test.ts',
  // proposalDraftController toggles the same ai_configuration/ai_features rows.
  'src/__tests__/proposalDraftController.test.ts',
  // activitySummaryService toggles the same ai_configuration singleton row as the other
  // on-demand AI test suites above.
  'src/__tests__/activitySummaryService.test.ts',
  // emailDraftService toggles the same ai_configuration singleton row as the other
  // on-demand AI test suites above.
  'src/__tests__/emailDraftService.test.ts',
  // taskSuggestionService toggles the same ai_configuration singleton row as the other
  // on-demand AI test suites above.
  'src/__tests__/taskSuggestionService.test.ts',
  // contactEnrichmentService toggles the same ai_configuration singleton row as the other
  // on-demand AI test suites above.
  'src/__tests__/contactEnrichmentService.test.ts',
  // duplicateExplanationService toggles the same ai_configuration singleton row as the other
  // on-demand AI test suites above.
  'src/__tests__/duplicateExplanationService.test.ts',
  // leadScoreNarrativeService toggles the same ai_configuration singleton row as the other
  // on-demand AI test suites above.
  'src/__tests__/leadScoreNarrativeService.test.ts',
  // sentimentService toggles the same ai_configuration singleton row as the other
  // background-job AI test suites above, and also flips the ai_sentiment_tracking
  // feature_flags row.
  'src/__tests__/sentimentService.test.ts',
  // meetingBriefService toggles the same ai_configuration singleton row (including
  // web_search_enabled) as the other on-demand AI test suites above, and also flips
  // the ai_sentiment_tracking feature_flags row to avoid the createActivity() hook
  // contamination described above.
  'src/__tests__/meetingBriefService.test.ts',
  // meetingBriefController toggles the same ai_configuration/feature_flags rows via
  // supertest requests exercising the real createActivity() hook chain.
  'src/__tests__/meetingBriefController.test.ts',
  // warmIntroService toggles the same ai_configuration/feature_flags rows as the other
  // on-demand AI test suites above, exercising the real createActivity() hook chain
  // for its rep-engagement fixtures.
  'src/__tests__/warmIntroService.test.ts',
  // dataHygieneService's runDataHygieneScan() and dataHygieneController's endpoints
  // scan ALL contacts/accounts/opportunities org-wide (no owner filter) to build
  // data_hygiene_findings — running either file in parallel with any other test file
  // that creates/deletes contacts/accounts/deals/users causes FK violations when the
  // scan tries to insert a finding row for an owner_id another file just deleted, or
  // races on shared data_hygiene_scoring_config reads.
  'src/__tests__/dataHygieneService.test.ts',
  'src/__tests__/dataHygieneController.test.ts',
  // repCoachingService's generateRepCoachingInsights() and repCoachingController's
  // endpoints likewise aggregate ALL reps'/managers' deals and activities org-wide
  // (no owner filter) to compute team averages — same class of cross-file race as
  // dataHygieneService above.
  'src/__tests__/repCoachingService.test.ts',
  'src/__tests__/repCoachingController.test.ts',
  // leadRoutingService's computeLeadRoutingSuggestion() and createLead's routing-decision
  // recompute query ALL active reps/managers org-wide as routing candidates — running in
  // parallel with any test file creating/deleting users races on the candidate pool.
  'src/__tests__/leadRoutingService.test.ts',
  'src/__tests__/leadRoutingController.test.ts',
  // reportService's getLeadsSummaryReport({ ownerId: null }) runs an unscoped
  // `SELECT status, COUNT(*) FROM leads GROUP BY status` (no owner/FILE_PREFIX
  // filter) — same class of org-wide-aggregate race as dataHygieneService/
  // repCoachingService/leadRoutingService above. Its "owner scoping" test reads a
  // baseline count in a transaction immediately before inserting its own two fixture
  // rows to protect that specific window, but the gap between that transaction's
  // COMMIT and the later getLeadsSummaryReport() call is NOT protected — any of the
  // 16+ other files that insert/delete `leads` rows can land a write in that gap
  // under parallel file execution, shifting the true total the report computes.
  'src/__tests__/reportService.test.ts',
  // The following files all flip the same global org_visibility_settings row
  // (UPDATE ... SET policy = 'private'/'org' WHERE object_type = ...) directly
  // via raw SQL to exercise their "cross-owner request under a private policy
  // gets 403" test, then restore it in a finally block — but with no
  // serialization between files, one file's restore can race another file's
  // still-in-flight assertion window, silently flipping an expected 403 into a
  // 200 (reproduced live: followUpTimingController's private-policy 403 test
  // failed exactly this way under the full parallel suite, passed in
  // isolation). championBlockerController, objectionMatchingController, and
  // visibilityService also mutate org_visibility_settings but were already
  // serial above for other reasons.
  'src/__tests__/followUpTimingController.test.ts',
  'src/__tests__/churnExpansionController.test.ts',
  'src/__tests__/dealHealthController.test.ts',
  'src/__tests__/relationshipHealthController.test.ts',
  // relationshipHealthService mutates the same global account_health_scoring_config
  // singleton row as relationshipHealthController above (min_logged_activities et al.),
  // and its computeAccountHealthScores() scans ALL accounts org-wide (no owner filter)
  // — same class of race as dataHygieneService/repCoachingService above, compounded by
  // the config-row race: a concurrent min_logged_activities write can change which
  // accounts clear the threshold mid-run, flipping a "below threshold" assertion to a
  // real, non-null score (observed on CI: 0 failures across 4 prior runs on the same
  // branch, then failed once under full-suite load with no code change to this file or
  // its service — a timing-dependent race, not a deterministic bug).
  'src/__tests__/relationshipHealthService.test.ts',
  'src/__tests__/sentimentController.test.ts',
  'src/__tests__/accountController.test.ts',
  // migrate.test.ts's runMigrations reserved-char regression test mutates the
  // real process.env.DB_USER/DB_PASSWORD (not a scoped override like
  // COVERAGE_DB_USER/COVERAGE_DB_PASSWORD, since runMigrations() reads the
  // real vars directly) for the duration of the test. Nothing currently
  // re-reads those vars live during a parallel test run (db.ts/coverageDb.ts
  // only read them once at import), so this is a latent risk rather than an
  // observed failure — serializing this file removes the risk entirely rather
  // than relying on that fact staying true.
  'src/__tests__/migrate.test.ts',
  // tagCreationRestriction flips the global tags_restrict_creation
  // system_settings row to true mid-test (resetting to false in beforeEach);
  // tagController.test.ts assumes that flag stays false throughout and asserts
  // 201 on tag creation, so running the two in parallel intermittently turns
  // tagController's assertions into a spurious 403 (reproduced live: a full
  // parallel run failed tagController's idempotent-create test with "expected
  // 403 to be 201"; the same file passed 19/19 in isolation).
  'src/__tests__/tagCreationRestriction.test.ts',
  // tagController.test.ts itself must ALSO be serial, not just
  // tagCreationRestriction above: featureFlagService's isFlagEnabledForUser
  // cache is process-wide, not per-file (see featureFlagService.test.ts's own
  // comment on this), so ANY parallel file that clears that cache via
  // __clearCacheForTest() — not just tagCreationRestriction — can race
  // tagController's read of the 'tags' flag's cached enabled state and turn an
  // expected 201 into a spurious 403 (reproduced live: coverageMappingController.test.ts/
  // coverageReportingController.test.ts, which used to call __clearCacheForTest()
  // while toggling their own unrelated coverage_* flags, triggered this exact
  // failure in tagController — same root cause as tagCreationRestriction, just a
  // different trigger file). Those two files stopped touching the flag cache in
  //, when their routers moved off feature_flags onto boot-time env
  // vars, so they are no longer that trigger — but tagController stays serial:
  // the race is with ANY parallel file clearing the process-wide cache, and the
  // reason it was found here has no bearing on whether another file can do it
  // tomorrow.
  'src/__tests__/tagController.test.ts',
  // coverageMappingController.test.ts and coverageReportingController.test.ts
  // were serialized here because both called featureFlagService.__clearCacheForTest()
  // — a process-wide cache clear — while toggling their own coverage_* flags.
  // moved those routers onto boot-time env vars and deleted the flag
  // rows, so neither file touches the flag cache at all any more and the reason
  // for serializing them is gone. Removed rather than left in place: a stale
  // entry here costs real wall-clock on every run and, worse, reads to the next
  // person as evidence of a race that no longer exists.
  // middleware.test.ts's requireFeatureEnabledOrgWide cases vi.spyOn the
  // featureFlagService MODULE NAMESPACE (isFeatureEnabled/isFlagEnabledForUser).
  // That replacement is process-wide for as long as the spy is installed, so a
  // parallel file reading a real flag through the same service during that
  // window would get the stub's answer instead of the database's — the same
  // class of cross-file interference the two entries above are serialized for,
  // reached by mocking rather than by cache invalidation.
  'src/__tests__/middleware.test.ts',
  // coverageDumpService.test.ts and coverageIngestionService.test.ts both build
  // an agent against COVERAGE_DUMPS_ROOT — a single process-external directory
  // derived from process.cwd(), not a per-test tmpdir — and both recursively
  // delete it in afterEach. Run in parallel, one file's rm races the other's
  // in-progress writes.
  //
  // The loud symptom is `ENOTEMPTY: directory not empty, rmdir
  // server/coverage-dumps`, observed once in a full run. The quiet one is
  // worse: a write can return success and then lose its payload, meta, or
  // index.jsonl to the sibling's delete. DumpIndex.append caches the entry in
  // memory, so findCoverageDump later hits its catch, logs "meta file missing
  // or unparseable", and returns undefined — an assertion fails claiming disk
  // corruption and points the next investigator at a storage bug that does not
  // exist.
  //
  // NodeV8CoverageAgent.test.ts is deliberately NOT listed: it mkdtemp's its
  // own root under os.tmpdir() and cannot collide.
  'src/__tests__/coverageDumpService.test.ts',
  'src/__tests__/coverageIngestionService.test.ts',
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

    /**
     * Caps concurrent test-file workers regardless of CPU count.
     *
     * The constraint is CPU, NOT database connections. Measured peak on a full
     * 6-worker run: 13 connections, sampled once a second from pg_stat_activity,
     * against a max_connections of 200 — pg.Pool's `max` is a lazy ceiling, not a
     * reservation, so 6 workers x DEFAULT_POOL_MAX (10) never materializes.
     *
     * Measured on a 12-core / 24 GB machine, full server suite, otherwise idle:
     *
     *   maxWorkers: 6   ->  153s, 203 files / 4040 tests, 0 failures
     *   maxWorkers: 12  -> 2924s, 203 files / 4040 tests, 3 failures (19x SLOWER)
     *
     * Both rows ran the full 203 files, so that is a like-for-like comparison —
     * worth stating because an oversubscribed run CAN silently under-run files
     * (the client workspace's config documents exactly that failure).
     *
     * Every 12-worker failure was a starvation timeout; grep of that run found
     * ZERO "too many connections" / "remaining connection slots" errors. The
     * suite is CPU-bound (notably bcryptjs, which is pure JS and blocks its
     * worker's event loop — see testTimeout on the parallel project below), so
     * oversubscribing cores past ~half of them collapses throughput.
     *
     * Keep the cap; it is load-bearing. Raise it only with a measured run, and
     * on a machine with more cores rather than on principle. DB_POOL_MAX (db.ts)
     * is the knob if connections ever DO become the limit.
     */
    maxWorkers: 6,

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
          testTimeout: PARALLEL_TEST_TIMEOUT_MS,
          hookTimeout: HOOK_TIMEOUT_MS,
        },
        resolve: sharedResolve,
      },
      {
        extends: true,
        test: {
          name: 'serial',
          include: SERIAL_FILES,
          fileParallelism: false,
          testTimeout: SERIAL_TEST_TIMEOUT_MS,
          hookTimeout: HOOK_TIMEOUT_MS,
        },
        resolve: sharedResolve,
      },
    ],
  },

  resolve: sharedResolve,
});
