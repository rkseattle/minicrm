'use strict';

/**
 * Migration 159: Coverage/TIA bidirectional code<->test index. (MINCRM-618)
 *
 * Adds coverage_test_links — the per-test attribution layer coverage_units
 * itself does NOT provide. coverage_units (migration 158) merges hit_count
 * across every dump ever ingested for a commit_sha; it has no notion of
 * which specific test(s) produced those hits, only the aggregate. This
 * table closes that gap: one row per (commit_sha, unit_key, branch_id,
 * test_id) identity, populated at ingestion time by joining the dump being
 * ingested against coverage_session_dumps (migration 157) — the table that
 * already carries per-dump test_id/test_name/attempt attribution — so each
 * unit hit recorded during ingestion is linked to the test(s) whose session
 * dump produced it, not just merged blindly into the commit-wide aggregate.
 *
 * A dump with no session attribution (no coverage_session_dumps row — e.g.
 * a manually-triggered dump/ingest outside any E2E run or recorder session)
 * contributes to coverage_units as before but simply has no
 * coverage_test_links rows of its own; this is a normal, expected case, not
 * an error condition.
 *
 * No feature flag of its own — this table is populated as an internal
 * side effect of the existing coverage_pipeline_ingestion-gated ingestion
 * endpoint (migration 158), not a separately toggle-able surface. The
 * mapping QUERY api added in a later migration (pr-tia-4's MINCRM-621) is
 * what gets its own flag, since that's the actual new externally-callable
 * surface.
 *
 * varchar + CHECK is not needed here (no constrained-string enum column),
 * per repo convention (see CLAUDE.md "varchar + CHECK for new constrained-
 * string columns — never new PG ENUMs") — noted for completeness since
 * every other coverage migration documents this choice.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.coverage_test_links (
      id             uuid NOT NULL DEFAULT gen_random_uuid(),
      commit_sha     text NOT NULL,
      unit_key       text NOT NULL,
      branch_id      text,
      file_path      text NOT NULL,
      test_id        text NOT NULL,
      test_name      text,
      hit_count      bigint NOT NULL DEFAULT 0,
      first_seen_at  timestamptz NOT NULL DEFAULT now(),
      last_seen_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT coverage_test_links_pkey PRIMARY KEY (id),
      CONSTRAINT coverage_test_links_hit_count_check CHECK (hit_count >= 0),
      CONSTRAINT coverage_test_links_branch_id_not_empty_check CHECK (branch_id IS NULL OR branch_id <> '')
    )
  `);

  // Same COALESCE(branch_id, '') dedup pattern as coverage_units_identity_idx
  // (migration 158) and for the identical reason: branch_id is nullable for
  // function-granularity units, and a plain UNIQUE constraint would never
  // treat two NULL-branch_id rows for the same (commit_sha, unit_key,
  // test_id) as duplicates (SQL NULL <> NULL).
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS coverage_test_links_identity_idx
      ON public.coverage_test_links (commit_sha, unit_key, COALESCE(branch_id, ''), test_id)
  `);

  pgm.sql(`
    COMMENT ON TABLE public.coverage_test_links IS
      'Coverage/TIA bidirectional code<->test index (MINCRM-618) — attributes coverage_units hits to the specific test(s) that produced them, joined at ingestion time from coverage_session_dumps (migration 157) test_id/test_name attribution. coverage_units itself only carries a commit-wide aggregate hit_count with no per-test breakdown; this table is the derived per-test layer coverageMappingService queries from. Re-ingesting the same dump for the same test merges into the existing row (hit_count accumulated) rather than duplicating, mirroring coverage_units own dedup/compaction behavior.'
  `);

  // Supports "which tests cover this unit?" (coverageMappingService.findTestsForUnit).
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_test_links_unit_idx
      ON public.coverage_test_links USING btree (commit_sha, unit_key)
  `);

  // Supports "which units does this test cover?" (coverageMappingService.findUnitsForTest).
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_test_links_test_idx
      ON public.coverage_test_links USING btree (commit_sha, test_id)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.coverage_test_links`);
};
