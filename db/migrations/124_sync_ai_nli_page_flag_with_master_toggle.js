/**
 * Sync ai_nli_page feature flag with the ai_configuration master toggle.
 *
 * The baseline seed enables ai_nli_page by default, but ai_configuration.enabled
 * defaults to false. This causes the "AI Assistant" nav link to appear even when
 * AI features have never been enabled. Align the flag with the actual master-toggle
 * state so the nav link only shows when AI is genuinely enabled.
 *
 * CORRECTION: an earlier version of this comment claimed
 * "the setAiEnabled service function now keeps both values in sync going
 * forward." That is not what the code does, and the claim cost real debugging
 * time. setAiEnabled (server/src/services/aiConfigService.ts) writes
 * ai_configuration.enabled and the `ai_features` flag row — it never touches
 * `ai_nli_page`. The coupling is at READ time instead:
 * featureFlagService.isFlagEnabledForUser gates every `ai_*` sub-flag on
 * `ai_features`, so disabling the master hides the AI page without any write to
 * this row. Nothing restores `ai_nli_page` after this migration except
 * server/src/scripts/reset-e2e-data.ts, which sets every system flag back to
 * true for E2E.
 *
 * Note this migration is index 124, below BASELINE_COVERED_MIGRATION_COUNT
 * (server/src/migrate.ts), so it is fake-marked and never executes on a fresh
 * database — there, `ai_nli_page` keeps the baseline seed's enabled = true.
 * Comment-only edit: no SQL change, so no corrective migration is required.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE feature_flags
    SET enabled = (
      SELECT COALESCE(enabled, false)
      FROM ai_configuration
      LIMIT 1
    )
    WHERE flag_key = 'ai_nli_page'
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  // Restore ai_nli_page to enabled=true (the baseline default)
  pgm.sql(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'ai_nli_page'`);
};
