'use strict';

/**
 * Migration 157: Seed the coverage_session_management feature flag.
 *
 * Gates the Coverage/TIA session control API
 * (/api/v1/admin/coverage/sessions/*) — start/end sessions, correlation-ID
 * attribution — for automated E2E runs and manual-testing recording.
 * Independent of coverage_instrumentation (migration 156): a session can be
 * created even if the backend V8 agent itself is off, e.g. a browser-only
 * manual-testing session.
 *
 * This migration originally also created coverage_sessions and
 * coverage_session_dumps directly in the product database. Those tables
 * have since moved to their own dedicated coverage database (see
 * qa/migrations/001_coverage_baseline.js and server/src/coverageDb.ts) —
 * nothing had shipped against the product-DB versions of these tables, so
 * they were removed here rather than left as dead objects alongside a
 * "moved" migration in the new location. Only the feature-flag seed, which
 * genuinely belongs in the product database (it gates access via
 * req.user/role, not coverage data itself), remains.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'coverage_session_management',
        'Coverage Session Management',
        'Enables the Coverage/TIA session control API (start/end sessions, correlation-ID attribution) for automated E2E runs and manual-testing recording. Developer/CI tooling — leave disabled in production.',
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
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'coverage_session_management'`);
};
