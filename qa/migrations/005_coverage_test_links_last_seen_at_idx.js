'use strict';

/**
 * Migration 005: index on coverage_test_links.last_seen_at. (MINCRM-637)
 *
 * pruneCoverageUnits' orphan-link cleanup (coverageModelService.ts) filters
 * coverage_test_links on `l.last_seen_at < now() - (retentionDays * interval
 * '1 day')`, run daily by coverageRetentionScheduler.ts. No prior phase
 * queried coverage_test_links by last_seen_at at all — existing indexes
 * cover (commit_sha, file_path, unit_key, branch_id, test_id),
 * (commit_sha, unit_key), (commit_sha, test_id), and test_file, none of
 * which can serve a last_seen_at range predicate — so this scheduled query
 * would otherwise sequential-scan the entire table every day. Mirrors
 * coverage_units_last_seen_at_idx (001_coverage_baseline.js), the same
 * index this table's sibling prune query already relies on (found via
 * Greptile branch review).
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_test_links_last_seen_at_idx
      ON public.coverage_test_links USING btree (last_seen_at)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.coverage_test_links_last_seen_at_idx`);
};
