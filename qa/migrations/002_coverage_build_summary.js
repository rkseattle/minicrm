'use strict';

/**
 * Migration 002: Coverage/TIA build summary rollup table. (MINCRM-629/630/631)
 *
 * One row per commit_sha, maintained incrementally by
 * coverageModelService.upsertCoverageUnits' onUnitsUpserted callback
 * (coverageIngestionService) in the SAME transaction as the coverage_units
 * writes it summarizes — never a separate scheduled rollup job, since no
 * job-scheduling infrastructure exists yet for coverage/TIA (see
 * docs/dev/coverage.md's "Deferred to later phases": automatic/scheduled
 * retention pruning is likewise out of scope for this epic). Keeping the
 * write inside the existing ingestion transaction means this table can
 * never drift out of sync with coverage_units the way a periodic batch
 * job reading a stale snapshot could.
 *
 * Exists because coverage_units only carries the LATEST state per
 * commit_sha (see qa/migrations/001_coverage_baseline.js) — there is no
 * time-series storage anywhere in the coverage database. A dashboard/trend
 * view computing "coverage % across the last N builds" by re-scanning
 * coverage_units for each of N commit_shas at read time would be O(N) full
 * table scans per page load, and coverage_units rows are also subject to
 * pruneCoverageUnits' retention deletion — a query-time approach would
 * silently lose older builds from a trend chart as soon as their
 * coverage_units rows age out, even though this rollup logically should
 * survive past the underlying units' own retention window (a build's
 * historical coverage percentage remains meaningful long after we've
 * stopped caring about that build's individual unit-level detail).
 *
 * varchar + CHECK for constrained-string columns, not PG ENUMs — same
 * repo convention as every other coverage/product migration.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.coverage_build_summary (
      id                        uuid NOT NULL DEFAULT gen_random_uuid(),
      commit_sha                text NOT NULL,
      -- Total distinct (file_path, unit_key, branch_id) units seen at this
      -- commit, split by agent tier (node-v8 = API/backend, browser-istanbul
      -- = frontend) — see coverage_units.agent's own CHECK constraint for
      -- the same two literal values.
      api_unit_count            integer NOT NULL DEFAULT 0,
      api_covered_unit_count    integer NOT NULL DEFAULT 0,
      frontend_unit_count       integer NOT NULL DEFAULT 0,
      frontend_covered_unit_count integer NOT NULL DEFAULT 0,
      -- Split of covered units by the coverage_sessions.source that
      -- produced the hit (automated-e2e vs manual) — see
      -- coverage_sessions_source_check in 001_coverage_baseline.js for the
      -- same two literal values. A unit hit by both an automated and a
      -- manual session in the same commit counts toward both counters
      -- (this is a coverage-BY-test-type breakdown, not a partition).
      automated_covered_unit_count integer NOT NULL DEFAULT 0,
      manual_covered_unit_count integer NOT NULL DEFAULT 0,
      first_ingested_at         timestamptz NOT NULL DEFAULT now(),
      last_updated_at           timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT coverage_build_summary_pkey PRIMARY KEY (id),
      CONSTRAINT coverage_build_summary_commit_sha_unique UNIQUE (commit_sha),
      CONSTRAINT coverage_build_summary_api_unit_count_check CHECK (api_unit_count >= 0),
      CONSTRAINT coverage_build_summary_api_covered_check CHECK (
        api_covered_unit_count >= 0 AND api_covered_unit_count <= api_unit_count
      ),
      CONSTRAINT coverage_build_summary_frontend_unit_count_check CHECK (frontend_unit_count >= 0),
      CONSTRAINT coverage_build_summary_frontend_covered_check CHECK (
        frontend_covered_unit_count >= 0 AND frontend_covered_unit_count <= frontend_unit_count
      ),
      CONSTRAINT coverage_build_summary_automated_covered_check CHECK (automated_covered_unit_count >= 0),
      CONSTRAINT coverage_build_summary_manual_covered_check CHECK (manual_covered_unit_count >= 0)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.coverage_build_summary IS
      'Coverage/TIA per-build rollup — one row per commit_sha, incrementally maintained alongside coverage_units writes (see coverageBuildSummaryService.upsertBuildSummaryForCommit). Backs the reporting/dashboard query API (MINCRM-629/630/631): overall + per-tier coverage percentage and automated-vs-manual breakdown for a single build, and the trend-over-time view across many builds, without re-scanning coverage_units (which is also subject to retention pruning) at read time.'
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.coverage_build_summary.api_covered_unit_count IS
      'Count of API-tier (agent=node-v8) units at this commit with hit_count > 0. api_unit_count is the total regardless of hit_count, so api_covered_unit_count / api_unit_count is the API-tier coverage percentage.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_build_summary_last_updated_at_idx
      ON public.coverage_build_summary USING btree (last_updated_at)
  `);

  // findRecentBuildSummaries orders by first_ingested_at, and
  // getTiaValueMetrics filters by a first_ingested_at range — both are the
  // trend view's primary query path, so this index (not last_updated_at
  // above, which nothing currently queries by) is the one that matters for
  // read performance as this table grows.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_build_summary_first_ingested_at_idx
      ON public.coverage_build_summary USING btree (first_ingested_at)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.coverage_build_summary`);
};
