'use strict';

/**
 * Migration 160: Seed the coverage_reporting_query feature flag.
 *
 * Gates the Coverage/TIA reporting/dashboard query API
 * (/api/v1/admin/coverage/reporting/*) — read-only summary, trend, gap
 * analysis, per-issue traceability, and TIA value-metrics lookups over
 * coverage_build_summary and coverage_units/coverage_test_links
 * (MINCRM-629/630/631). Independent of coverage_mapping_query (migration
 * 159): the standalone coverage-dashboard app (MINCRM-628) is the only
 * intended caller of this API, but the query API itself stays gated the
 * same way every other coverage/TIA control surface is — see
 * docs/dev/coverage.md's "Coverage Database" section.
 *
 * Lives in the product database (like every other coverage/TIA feature
 * flag before it) even though the data it queries lives in the separate
 * coverage database — this flag gates WHO may call the reporting endpoint
 * via req.user/role, an authorization concern that belongs with the
 * product's own users/feature_flags tables, not with the coverage data
 * itself.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'coverage_reporting_query',
        'Coverage Reporting Query',
        'Enables the Coverage/TIA reporting query API (/api/v1/admin/coverage/reporting/*) — build summaries, coverage trend, gap analysis, per-issue traceability, and TIA value metrics for the standalone coverage-dashboard tool. Developer/CI tooling — leave disabled in production.',
        'Developer Tools',
        false,
        '{}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'coverage_reporting_query'`);
};
