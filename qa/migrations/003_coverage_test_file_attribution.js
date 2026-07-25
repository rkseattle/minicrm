'use strict';

/**
 * Migration 003: test_file column on coverage_session_dumps and
 * coverage_test_links. (MINCRM-660 groundwork, pr-tia-8)
 *
 * testSelectionService.selectTestsForChangedUnits (MINCRM-624) resolves a
 * diff to a SelectedTest[] keyed by testId — but the testId actually
 * recorded end-to-end today is Playwright's own opaque testInfo.testId (a
 * hash), stamped via qa/e2e/apps/minicrm/fixtures.ts's
 * recordCoverageSessionDump call. Neither coverage_session_dumps nor its
 * derived coverage_test_links row has ever carried the one thing MINCRM-660
 * actually needs — the relative spec file path — so there was no way to go
 * from a selected testId back to "which .spec.ts file do I run" before this
 * migration. test_file closes that gap, captured the same way
 * test-timing-baseline.json's own file paths are: relative to repo root
 * (see qa/e2e/framework/reporting/timing-utils.ts's discoverSpecFiles), so
 * gen-shards.ts/gen-shard-config.ts can consume it directly with no path
 * translation.
 *
 * Nullable on both tables, exactly like test_id/test_name already are —
 * plenty of dumps have no test attribution at all (manual sessions, a dump
 * outside any session), and this migration must not retroactively fail
 * ingestion for historical rows that predate it.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.coverage_session_dumps
      ADD COLUMN IF NOT EXISTS test_file text
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.coverage_session_dumps.test_file IS
      'Spec file path (relative to repo root, e.g. tests/apps/minicrm/functional/deals/deal-creation.spec.ts — same convention as test-timing-baseline.json''s own keys) that produced this dump''s test_id. Nullable like test_id/test_name — only populated when the E2E fixture layer has a Playwright TestInfo to read testInfo.file from. (MINCRM-660 groundwork)'
  `);

  pgm.sql(`
    ALTER TABLE public.coverage_test_links
      ADD COLUMN IF NOT EXISTS test_file text
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.coverage_test_links.test_file IS
      'Copied from coverage_session_dumps.test_file at link time (coverageIngestionService''s onUnitsUpserted callback) — lets the mapping query API (coverageMappingService.findTestsForUnitWithConfidence) return a spec file path directly, without a caller having to separately resolve testId back to a file. Not part of this table''s identity/conflict target (coverage_test_links_identity_idx) for the same reason test_name already isn''t: a test''s spec file is metadata describing the test, not part of what makes a (commit_sha, file_path, unit_key, branch_id, test_id) row unique. (MINCRM-660 groundwork)'
  `);

  // Mirrors coverage_test_links_test_idx's own (commit_sha, test_id) shape —
  // the mapping query API's units-for-test lookup is the read path that
  // benefits from test_file being available without a second round-trip,
  // and this index keeps that lookup index-only for the new column too.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_test_links_test_file_idx
      ON public.coverage_test_links USING btree (commit_sha, test_file)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.coverage_test_links_test_file_idx`);
  pgm.sql(`ALTER TABLE public.coverage_test_links DROP COLUMN IF EXISTS test_file`);
  pgm.sql(`ALTER TABLE public.coverage_session_dumps DROP COLUMN IF EXISTS test_file`);
};
