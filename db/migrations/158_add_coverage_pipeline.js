'use strict';

/**
 * Migration 158: Coverage/TIA data pipeline & storage. (MINCRM-614, MINCRM-615, MINCRM-616)
 *
 * Adds:
 *   1. coverage_pipeline_ingestion feature flag — gates the new
 *      /api/v1/admin/coverage/pipeline/ingest control endpoint, independent
 *      of coverage_instrumentation (migration 156) and
 *      coverage_session_management (migration 157): a server can have raw
 *      dump collection and session attribution on while the normalization
 *      pipeline itself stays off (e.g. during rollout, or on a server that
 *      only produces dumps for a separate ingestion worker to consume).
 *   2. coverage_units — the version-anchored, symbolicated coverage model
 *      (MINCRM-616). One row per (commit_sha, file_path, unit_key,
 *      branch_id) triple, populated by ingesting + symbolicating raw dumps
 *      (still file-based per migration 156/157 era Phase 1 — this table is
 *      the derived, queryable layer on top, not a replacement for raw dump
 *      storage). unit_key is a qualified function/method signature, not a
 *      line number, since the mapping-engine phase (pr-tia-4) that consumes
 *      this table needs identity stable across in-line edits — see
 *      MINCRM-619's stable-structural-key requirement, which this table's
 *      shape is built to support even though key derivation itself lands in
 *      that later phase. branch_id is null for function-level-only entries
 *      (COVERAGE_GRANULARITY=function, see coverageConfig.ts).
 *   3. coverage_ingested_dumps — tracks which dumpIds have already been
 *      normalized into coverage_units, giving ingestion its required
 *      idempotency (MINCRM-614's "idempotent ingest" AC) without needing to
 *      diff coverage_units rows themselves to detect a re-ingested dump.
 *
 * varchar + CHECK for granularity, not a PG ENUM, per repo convention (see
 * CLAUDE.md "varchar + CHECK for new constrained-string columns — never new
 * PG ENUMs").
 *
 * Dedup/compaction (MINCRM-616's "Dedup and compaction of repeated
 * coverage" AC): the unique constraint on
 * (commit_sha, file_path, unit_key, branch_id) means re-ingesting the same
 * commit's coverage merges into the existing row (hit_count accumulated,
 * not duplicated — see coverageModelService.upsertCoverageUnits) rather
 * than growing one row per ingestion call.
 *
 * Retention (MINCRM-616's "Configurable retention policy" AC): no
 * scheduled job is added here (that's CI/CD orchestration, pr-tia-7's
 * concern) — only the schema plus a callable
 * coverageModelService.pruneCoverageUnits(olderThanDays) function, keeping
 * this migration's scope to the storage model itself.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ── 1. Feature flag ──────────────────────────────────────────────────────
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

  // ── 2. coverage_units ─────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.coverage_units (
      id                 uuid NOT NULL DEFAULT gen_random_uuid(),
      commit_sha         text NOT NULL,
      file_path          text NOT NULL,
      unit_key           text NOT NULL,
      branch_id          text,
      granularity        varchar(20) NOT NULL,
      agent              varchar(20) NOT NULL,
      hit_count          bigint NOT NULL DEFAULT 0,
      resolved           boolean NOT NULL DEFAULT true,
      unresolved_reason  text,
      first_seen_at      timestamptz NOT NULL DEFAULT now(),
      last_seen_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT coverage_units_pkey PRIMARY KEY (id),
      CONSTRAINT coverage_units_granularity_check CHECK (granularity IN ('branch', 'function')),
      CONSTRAINT coverage_units_agent_check CHECK (agent IN ('node-v8', 'browser-istanbul')),
      CONSTRAINT coverage_units_hit_count_check CHECK (hit_count >= 0),
      CONSTRAINT coverage_units_resolved_reason_check CHECK (
        (resolved = true AND unresolved_reason IS NULL) OR
        (resolved = false AND unresolved_reason IS NOT NULL)
      ),
      -- The identity index below dedups on COALESCE(branch_id, ''), treating
      -- NULL and '' as the same identity slot for a given
      -- (commit_sha, file_path, unit_key). A real empty-string branch_id
      -- would therefore silently collide with — and get merged into — a
      -- genuinely branch-less (NULL) row's hit_count. No code path
      -- currently produces '' (coverageSymbolicationService always emits
      -- either a real "branchKey:branchIndex" string or null), but this
      -- constraint closes the gap at the schema level rather than relying
      -- on that invariant holding forever in application code.
      CONSTRAINT coverage_units_branch_id_not_empty_check CHECK (branch_id IS NULL OR branch_id <> '')
    )
  `);

  // branch_id is nullable (function-granularity rows have none), so a plain
  // UNIQUE constraint would not treat two NULL branch_id rows for the same
  // (commit_sha, file_path, unit_key) as duplicates (SQL NULL <> NULL) —
  // a unique index over COALESCE(branch_id, '') is used instead so
  // dedup/compaction works identically for both granularities.
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS coverage_units_identity_idx
      ON public.coverage_units (commit_sha, file_path, unit_key, COALESCE(branch_id, ''))
  `);

  pgm.sql(`
    COMMENT ON TABLE public.coverage_units IS
      'Coverage/TIA version-anchored coverage model (MINCRM-616) — the normalized, symbolicated result of ingesting raw coverage dumps (still file-based, see coverage_dumps era Phase 1/coverageAgent/dumpIndex.ts). One row per (commit_sha, file_path, unit_key, branch_id) identity; re-ingesting the same commit merges into the existing row (hit_count accumulated) rather than duplicating. resolved=false rows carry unresolved_reason instead of being silently dropped (MINCRM-615''s "unresolvable regions flagged" AC) — e.g. a frontend dump whose sourcemap could not be loaded, or a V8 script offset outside any known function range.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_units_commit_sha_idx
      ON public.coverage_units USING btree (commit_sha)
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_units_file_path_idx
      ON public.coverage_units USING btree (file_path)
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_units_last_seen_at_idx
      ON public.coverage_units USING btree (last_seen_at)
  `);

  // ── 3. coverage_ingested_dumps ────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.coverage_ingested_dumps (
      dump_id       uuid NOT NULL,
      commit_sha    text NOT NULL,
      unit_count    integer NOT NULL DEFAULT 0,
      ingested_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT coverage_ingested_dumps_pkey PRIMARY KEY (dump_id),
      CONSTRAINT coverage_ingested_dumps_unit_count_check CHECK (unit_count >= 0)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.coverage_ingested_dumps IS
      'Tracks which coverage dumps (dumpId — see coverageAgent/CoverageDump, not FK''d since dump metadata itself stays file-based) have already been normalized into coverage_units, giving coverageIngestionService its idempotency guarantee (MINCRM-614): re-ingesting a known dump_id is a no-op rather than double-counting hit_count in coverage_units.'
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.coverage_ingested_dumps`);
  pgm.sql(`DROP TABLE IF EXISTS public.coverage_units`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'coverage_pipeline_ingestion'`);
};
