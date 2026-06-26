/**
 * Sync ai_nli_page feature flag with the ai_configuration master toggle.
 *
 * The baseline seed enables ai_nli_page by default, but ai_configuration.enabled
 * defaults to false. This causes the "AI Assistant" nav link to appear even when
 * AI features have never been enabled. Align the flag with the actual master-toggle
 * state so the nav link only shows when AI is genuinely enabled.
 *
 * The setAiEnabled service function now keeps both values in sync going forward.
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
