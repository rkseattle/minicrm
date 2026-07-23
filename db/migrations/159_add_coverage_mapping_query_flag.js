'use strict';

/**
 * Migration 159: Seed the coverage_mapping_query feature flag.
 *
 * Gates the Coverage/TIA mapping query API
 * (/api/v1/admin/coverage/mapping/*) — read-only lookups over
 * coverage_test_links (which tests cover a given unit, and vice versa),
 * scoped by commit SHA (MINCRM-621). Independent of
 * coverage_pipeline_ingestion (migration 158): a server can have ingested
 * coverage_test_links data while the query API itself stays off, e.g.
 * during rollout.
 *
 * Lives in the product database (like coverage_instrumentation/
 * coverage_session_management/coverage_pipeline_ingestion before it) even
 * though the data it queries (coverage_test_links) lives in the separate
 * coverage database — this flag gates WHO may call the query endpoint via
 * req.user/role, an authorization concern that belongs with the product's
 * own users/feature_flags tables, not with the coverage data itself. See
 * docs/dev/coverage.md's "Coverage Database" section.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'coverage_mapping_query',
        'Coverage Mapping Query',
        'Enables the Coverage/TIA mapping query API (/api/v1/admin/coverage/mapping/*) for looking up which tests cover a given code unit, and vice versa. Developer/CI tooling — leave disabled in production.',
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
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'coverage_mapping_query'`);
};
