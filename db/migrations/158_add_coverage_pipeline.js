'use strict';

/**
 * Migration 158: Seed the coverage_pipeline_ingestion feature flag.
 *
 * Gates the new /api/v1/admin/coverage/pipeline/ingest control endpoint,
 * independent of coverage_instrumentation (migration 156) and
 * coverage_session_management (migration 157): a server can have raw dump
 * collection and session attribution on while the normalization pipeline
 * itself stays off (e.g. during rollout, or on a server that only produces
 * dumps for a separate ingestion worker to consume).
 *
 * This migration originally also created coverage_units and
 * coverage_ingested_dumps directly in the product database. Those tables
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
        'coverage_pipeline_ingestion',
        'Coverage Pipeline Ingestion',
        'Enables the Coverage/TIA ingestion pipeline (/api/v1/admin/coverage/pipeline/ingest) that normalizes and symbolicates raw coverage dumps into the version-anchored coverage_units model. Developer/CI tooling — leave disabled in production.',
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
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'coverage_pipeline_ingestion'`);
};
