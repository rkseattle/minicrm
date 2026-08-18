'use strict';

/**
 * Migration 007: Remove work-item IDs from coverage catalog comments.
 *
 * Per CLAUDE.md's no-work-item-IDs rule, which covers catalog comments as well
 * as source comments: these become live database metadata, and a reader meets
 * them with no way to resolve a Jira key.
 *
 * Corrective rather than an edit to 002 and 003, because migrations are
 * immutable once written — the originals may already have run against a
 * developer's or CI's coverage database, where editing the file changes
 * nothing.
 *
 * The descriptions are otherwise reproduced verbatim. Each carries real domain
 * detail (what backs the reporting query API, why test_file is nullable, why
 * it is not part of the identity target), and none of it may be lost.
 *
 * `down` restores the previous text exactly, IDs included.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    COMMENT ON TABLE public.coverage_build_summary IS
      'Coverage/TIA per-build rollup — one row per commit_sha, incrementally maintained alongside coverage_units writes (see coverageBuildSummaryService.upsertBuildSummaryForCommit). Backs the reporting/dashboard query API: overall + per-tier coverage percentage and automated-vs-manual breakdown for a single build, and the trend-over-time view across many builds, without re-scanning coverage_units (which is also subject to retention pruning) at read time.'
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.coverage_session_dumps.test_file IS
      'Spec file path (relative to repo root, e.g. tests/apps/minicrm/functional/deals/deal-creation.spec.ts — same convention as test-timing-baseline.json''s own keys) that produced this dump''s test_id. Nullable like test_id/test_name — only populated when the E2E fixture layer has a Playwright TestInfo to read testInfo.file from.'
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.coverage_test_links.test_file IS
      'Copied from coverage_session_dumps.test_file at link time (coverageIngestionService''s onUnitsUpserted callback) — lets the mapping query API (coverageMappingService.findTestsForUnitWithConfidence) return a spec file path directly, without a caller having to separately resolve testId back to a file. Not part of this table''s identity/conflict target (coverage_test_links_identity_idx) for the same reason test_name already isn''t: a test''s spec file is metadata describing the test, not part of what makes a (commit_sha, file_path, unit_key, branch_id, test_id) row unique.'
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    COMMENT ON TABLE public.coverage_build_summary IS
      'Coverage/TIA per-build rollup — one row per commit_sha, incrementally maintained alongside coverage_units writes (see coverageBuildSummaryService.upsertBuildSummaryForCommit). Backs the reporting/dashboard query API (MINCRM-629/630/631): overall + per-tier coverage percentage and automated-vs-manual breakdown for a single build, and the trend-over-time view across many builds, without re-scanning coverage_units (which is also subject to retention pruning) at read time.'
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.coverage_session_dumps.test_file IS
      'Spec file path (relative to repo root, e.g. tests/apps/minicrm/functional/deals/deal-creation.spec.ts — same convention as test-timing-baseline.json''s own keys) that produced this dump''s test_id. Nullable like test_id/test_name — only populated when the E2E fixture layer has a Playwright TestInfo to read testInfo.file from. (MINCRM-660 groundwork)'
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.coverage_test_links.test_file IS
      'Copied from coverage_session_dumps.test_file at link time (coverageIngestionService''s onUnitsUpserted callback) — lets the mapping query API (coverageMappingService.findTestsForUnitWithConfidence) return a spec file path directly, without a caller having to separately resolve testId back to a file. Not part of this table''s identity/conflict target (coverage_test_links_identity_idx) for the same reason test_name already isn''t: a test''s spec file is metadata describing the test, not part of what makes a (commit_sha, file_path, unit_key, branch_id, test_id) row unique. (MINCRM-660 groundwork)'
  `);
};
