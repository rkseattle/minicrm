'use strict';

/**
 * Migration 163: Remove the coverage_mapping_query, coverage_reporting_query,
 * and coverage_pipeline_ingestion feature_flags rows. (MINCRM-685)
 *
 * These three rows (seeded by migrations 158, 159 and 160) gated the
 * Coverage/TIA mapping query API (routes/coverageMapping.ts), reporting query
 * API (routes/coverageReporting.ts) and ingestion pipeline
 * (routes/coveragePipeline.ts) via requireFeatureEnabled — the same mechanism
 * every ordinary, customer-facing feature flag uses. They rendered in the CRM's
 * own admin Settings page under a "Developer Tools" category, identically to a
 * real product toggle; internal CI/dev test infrastructure had no business being
 * discoverable or enable-able through the product's own UI.
 *
 * This finishes what migration 161 (MINCRM-663) started. That migration removed
 * coverage_instrumentation and coverage_session_management on exactly this
 * reasoning but left these three behind — the principle was applied to 2 of 5
 * flags. All three routers now gate their ENTIRE route registration on an env
 * var at process boot instead (COVERAGE_MAPPING_QUERY /
 * COVERAGE_REPORTING_QUERY / COVERAGE_PIPELINE_INGESTION — see
 * coverageAgent/coverageBootGate.ts and each router's own docblock). These rows are
 * therefore now dead weight: nothing reads them anymore, and leaving them seeded
 * would let them go on rendering in FeatureFlagsSettings.tsx as always-inert
 * toggles that look actionable but do nothing.
 *
 * Removing the last rows in the "Developer Tools" category also removes the
 * category's own section heading, which was rendering the raw i18n lookup path
 * `featureFlags.categories.developer_tools` — migration 158 introduced that
 * category but the key was never added to any locale file. Adding the key would
 * have entrenched a section that should not exist; deleting the rows removes it
 * with no i18n change at all. MINCRM-685 additionally dropped 'Developer Tools'
 * from FEATURE_FLAG_CATEGORIES, which is the stronger of the two guards — that
 * page renders one section per entry in that array, so a row re-seeded with
 * this category would now render nowhere rather than in an unlabelled section.
 *
 * down() re-seeds all three rows verbatim (matching migrations 158/159/160's own
 * INSERTs), which only restores the DB rows — it does NOT revert
 * routes/coverageMapping.ts / coverageReporting.ts / coveragePipeline.ts back to
 * reading requireFeatureEnabled, nor restore buildCoverageAccessGate's flagKey
 * parameter. A rollback of this migration alone leaves the routes on the new
 * env-var gates with three inert, unread feature_flags rows re-seeded alongside
 * them; a real revert of this story requires reverting the route-layer commits
 * too. Same caveat migration 161 carries, for the same reason.
 *
 * Note also that rows re-seeded by down() stay invisible in the admin UI until
 * 'Developer Tools' is restored to FEATURE_FLAG_CATEGORIES — the safe direction
 * for a migration-only rollback, but worth knowing before concluding down() did
 * nothing.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    DELETE FROM feature_flags
    WHERE flag_key IN ('coverage_mapping_query', 'coverage_reporting_query', 'coverage_pipeline_ingestion');
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'coverage_pipeline_ingestion',
        'Coverage Pipeline Ingestion',
        'Enables the Coverage/TIA ingestion pipeline (/api/v1/admin/coverage/pipeline/ingest) that normalizes and symbolicates raw coverage dumps into the version-anchored coverage_units model. Developer/CI tooling — leave disabled in production.',
        'Developer Tools',
        false,
        '{}',
        true
      ),
      (
        'coverage_mapping_query',
        'Coverage Mapping Query',
        'Enables the Coverage/TIA mapping query API (/api/v1/admin/coverage/mapping/*) for looking up which tests cover a given code unit, and vice versa. Developer/CI tooling — leave disabled in production.',
        'Developer Tools',
        false,
        '{}',
        true
      ),
      (
        'coverage_reporting_query',
        'Coverage Reporting Query',
        'Enables the Coverage/TIA reporting query API (/api/v1/admin/coverage/reporting/*) — build summaries, coverage trend, gap analysis, per-issue traceability, and TIA value metrics for the standalone coverage-dashboard tool. Developer/CI tooling — leave disabled in production.',
        'Developer Tools',
        false,
        '{}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING;
  `);
};
