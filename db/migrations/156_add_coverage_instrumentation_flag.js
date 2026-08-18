'use strict';

/**
 * Migration 156: Seed the coverage_instrumentation feature flag.
 *
 * Gates the Coverage/TIA control API (/api/v1/admin/coverage/*), which lets
 * an authenticated admin drive the backend V8 coverage agent's
 * reset/snapshot/dump verbs and ingest frontend-collected dumps
 * Off by default — this is CI/dev tooling, not a
 * user-facing feature, and must stay disabled on production deployments
 * unless a shared test environment explicitly opts in.
 *
 * No role_overrides: a role override for 'admin' would make this flag
 * effectively always-on for admins regardless of the `enabled` column
 * (role_overrides wins over the org-wide toggle — see
 * isFlagEnabledForUser/isFlagEnabledForRole in featureFlagService.ts),
 * defeating the "off by default, org-wide kill-switch" intent. The route
 * layer separately enforces requireRole('admin') — that access-control
 * concern is independent of this flag's enabled/disabled state.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'coverage_instrumentation',
        'Coverage Instrumentation',
        'Enables the Coverage/TIA control API for driving the backend coverage agent and ingesting frontend coverage dumps. Developer/CI tooling — leave disabled in production.',
        'Developer Tools',
        false,
        '{}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM feature_flags WHERE flag_key = 'coverage_instrumentation';
  `);
};
