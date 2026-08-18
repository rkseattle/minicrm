'use strict';

/**
 * Migration 006: index supporting the keyset-paginated coverage-map export.
 *
 * The map export streams coverage_test_links in pages, seeking on
 * (unit_key, COALESCE(branch_id,''), file_path, test_id) — the grouping key of
 * the commit-agnostic collapse, and therefore the only ordering that can page
 * through the collapsed result set without re-sorting it.
 *
 * No existing index serves that seek. coverage_test_links_identity_idx is
 * (commit_sha, file_path, unit_key, COALESCE(branch_id,''), test_id): it leads
 * with commit_sha, which the export deliberately spans, and orders file_path
 * ahead of unit_key. coverage_test_links_unit_idx and _test_idx likewise lead
 * with commit_sha. Without this index every page would sort the whole table,
 * against coverageDb.ts's 30s statement_timeout — so the streaming rewrite that
 * exists to stop the export dying on a 512MB string would instead have made it
 * die on a timeout.
 *
 * Deliberately NOT keyed on commit_sha: this is the one query in the codebase
 * that reads across every commit rather than within one.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_test_links_export_idx
      ON public.coverage_test_links
      USING btree (unit_key, (COALESCE(branch_id, '')), file_path, test_id)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.coverage_test_links_export_idx`);
};
