'use strict';

/**
 * Migration 001: Coverage/TIA schema baseline.
 *
 * Coverage/TIA (Test Impact Analysis) tables live in their OWN database
 * (minicrm_coverage / minicrm_coverage_test / minicrm_coverage_e2e — see
 * server/src/coverageDb.ts), separate from the product database (minicrm /
 * minicrm_test / minicrm_e2e) that db/migrations/ owns. These tables were
 * originally created directly in the product database by migrations 157
 * (coverage_sessions, coverage_session_dumps), 158 (coverage_units,
 * coverage_ingested_dumps), 159 (coverage_test_links), and 160
 * (confidence-scoring columns on coverage_units) — moved here wholesale,
 * since none of this had shipped anywhere yet (all in-flight development on
 * the pr-tia-* branch line). This file consolidates all four into a single
 * baseline for the new database rather than replaying four migrations that
 * were never actually released against a real environment.
 *
 * Why a separate database, not just a separate schema/namespace in the
 * product database: coverage/TIA data is disposable, write-heavy,
 * retention-pruned telemetry consumed by CI tooling and developers — a
 * fundamentally different access pattern, growth rate, and backup/retention
 * policy than product data (contacts/deals/users), which needs strict
 * backups and must never be bulk-deleted. None of the coverage tables carry
 * a foreign key into the product schema (unlike coverage_sessions'
 * originally-FK'd started_by, now a plain uuid column with no cross-database
 * FK — see the column comment below) — a genuinely independent datastore
 * with no referential-integrity reason to share a connection pool, backup
 * schedule, or migration history with product data.
 *
 * What did NOT move, and no longer exists: the coverage_instrumentation,
 * coverage_session_management, and coverage_pipeline_ingestion feature_flags
 * rows lived in the product database because they gated WHO may call the
 * coverage control APIs — an authorization concern belonging with the
 * product's own users/feature_flags tables rather than with coverage data.
 * removed all of them: each coverage router now
 * gates its route registration on a boot-time env var instead, so there is no
 * coverage-related feature_flags row in either database. Access control on the
 * routes that do register is still a product concern (authenticate plus
 * coverageAccessGate, both reading the product database).
 *
 * varchar + CHECK for constrained-string columns, not PG ENUMs — same repo
 * convention as every product-DB migration (see CLAUDE.md).
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ── coverage_sessions ──────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.coverage_sessions (
      id              uuid NOT NULL DEFAULT gen_random_uuid(),
      label           text NOT NULL,
      source          varchar(20) NOT NULL,
      status          varchar(20) NOT NULL DEFAULT 'active',
      correlation_id  uuid NOT NULL DEFAULT gen_random_uuid(),
      build_sha       text NOT NULL,
      environment     text NOT NULL,
      issue_key       text,
      -- Plain uuid, NOT a foreign key: started_by used to reference the
      -- product database's users(id) directly (migration 157, when both
      -- tables lived in the same database). Now that coverage_sessions
      -- lives in its own database, a cross-database FK is impossible in
      -- PostgreSQL — the application layer (coverageSessionService) is
      -- responsible for whatever validation used to be enforced at the DB
      -- level. Deleting a user in the product DB no longer has any
      -- cascading effect here at all (stronger than the original
      -- ON DELETE SET NULL, which at least nulled the column out).
      started_by      uuid,
      started_at      timestamptz NOT NULL DEFAULT now(),
      ended_at        timestamptz,
      version         integer NOT NULL DEFAULT 1,
      CONSTRAINT coverage_sessions_pkey PRIMARY KEY (id),
      CONSTRAINT coverage_sessions_correlation_id_unique UNIQUE (correlation_id),
      CONSTRAINT coverage_sessions_source_check CHECK (source IN ('automated-e2e', 'manual')),
      CONSTRAINT coverage_sessions_status_check CHECK (status IN ('active', 'ended')),
      CONSTRAINT coverage_sessions_ended_at_check CHECK (
        (status = 'active' AND ended_at IS NULL) OR
        (status = 'ended' AND ended_at IS NOT NULL)
      )
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.coverage_sessions IS
      'Coverage/TIA testing sessions — a logical grouping of one or more coverage dumps attributed to a single automated test run or manual-exploratory-testing session. correlation_id is the value propagated via the x-coverage-correlation-id header and stamped onto dumps in coverage_session_dumps; it is NOT a physically isolated V8 counter scope. version supports optimistic locking against concurrent end-session requests. Lives in the coverage database, not the product database — see this migration file''s module docblock.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_sessions_status_idx
      ON public.coverage_sessions USING btree (status)
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_sessions_started_by_idx
      ON public.coverage_sessions USING btree (started_by)
  `);

  // ── coverage_session_dumps ────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.coverage_session_dumps (
      id              uuid NOT NULL DEFAULT gen_random_uuid(),
      session_id      uuid NOT NULL REFERENCES public.coverage_sessions(id) ON DELETE CASCADE,
      dump_id         uuid NOT NULL,
      correlation_id  uuid NOT NULL,
      test_id         text,
      test_name       text,
      attempt         integer NOT NULL DEFAULT 1,
      recorded_at     timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT coverage_session_dumps_pkey PRIMARY KEY (id),
      CONSTRAINT coverage_session_dumps_dump_id_unique UNIQUE (dump_id),
      CONSTRAINT coverage_session_dumps_attempt_check CHECK (attempt >= 1)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.coverage_session_dumps IS
      'Attributes a single coverage dump (dump_id — a crypto.randomUUID() minted by NodeV8CoverageAgent/coverageDumpService, not FK''d since dump metadata itself stays file-based) to the coverage_sessions row that produced it. test_id/test_name/attempt support retry attribution: a Playwright retry re-runs the same test_id with attempt incremented, so retried/flaky tests are distinguishable rather than silently overwriting or double-counting the prior attempt''s dump.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_session_dumps_session_id_idx
      ON public.coverage_session_dumps USING btree (session_id)
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_session_dumps_correlation_id_idx
      ON public.coverage_session_dumps USING btree (correlation_id)
  `);

  // ── coverage_units ────────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.coverage_units (
      id                  uuid NOT NULL DEFAULT gen_random_uuid(),
      commit_sha          text NOT NULL,
      file_path           text NOT NULL,
      unit_key            text NOT NULL,
      branch_id           text,
      granularity         varchar(20) NOT NULL,
      agent               varchar(20) NOT NULL,
      hit_count           bigint NOT NULL DEFAULT 0,
      resolved            boolean NOT NULL DEFAULT true,
      unresolved_reason   text,
      first_seen_at       timestamptz NOT NULL DEFAULT now(),
      last_seen_at        timestamptz NOT NULL DEFAULT now(),
      confidence_score    numeric(4, 3) NOT NULL DEFAULT 1.0,
      last_reconciled_at  timestamptz,
      CONSTRAINT coverage_units_pkey PRIMARY KEY (id),
      CONSTRAINT coverage_units_granularity_check CHECK (granularity IN ('branch', 'function')),
      CONSTRAINT coverage_units_agent_check CHECK (agent IN ('node-v8', 'browser-istanbul')),
      CONSTRAINT coverage_units_hit_count_check CHECK (hit_count >= 0),
      CONSTRAINT coverage_units_resolved_reason_check CHECK (
        (resolved = true AND unresolved_reason IS NULL) OR
        (resolved = false AND unresolved_reason IS NOT NULL)
      ),
      CONSTRAINT coverage_units_branch_id_not_empty_check CHECK (branch_id IS NULL OR branch_id <> ''),
      CONSTRAINT coverage_units_confidence_score_check CHECK (confidence_score >= 0 AND confidence_score <= 1)
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS coverage_units_identity_idx
      ON public.coverage_units (commit_sha, file_path, unit_key, COALESCE(branch_id, ''))
  `);

  pgm.sql(`
    COMMENT ON TABLE public.coverage_units IS
      'Coverage/TIA version-anchored coverage model — the normalized, symbolicated result of ingesting raw coverage dumps (still file-based, see coverageAgent/dumpIndex.ts). One row per (commit_sha, file_path, unit_key, branch_id) identity; re-ingesting the same commit merges into the existing row (hit_count accumulated) rather than duplicating. resolved=false rows carry unresolved_reason instead of being silently dropped. confidence_score/last_reconciled_at are set by coverageReconciliationService.'
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.coverage_units.confidence_score IS
      'Recency-decayed confidence, 0.0-1.0. Computed and persisted by coverageReconciliationService — not recomputed at query time. Defaults to 1.0 for a freshly-ingested unit.'
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.coverage_units.last_reconciled_at IS
      'When build-time reconciliation (coverageReconciliationService.reconcileCoverageUnits) last validated this row against the current symbol table. NULL means never reconciled — only ingested.'
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

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_units_last_reconciled_at_idx
      ON public.coverage_units USING btree (last_reconciled_at)
  `);

  // ── coverage_ingested_dumps ───────────────────────────────────────────────
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
      'Tracks which coverage dumps (dumpId — not FK''d since dump metadata itself stays file-based) have already been normalized into coverage_units, giving coverageIngestionService its idempotency guarantee: re-ingesting a known dump_id is a no-op rather than double-counting hit_count in coverage_units.'
  `);

  // ── coverage_test_links ───────────────────────────────────────────────────
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

  // file_path is part of the identity (not just commit_sha/unit_key/branch_id/
  // test_id) — omitting it would let two DIFFERENT files that happen to
  // share the same structural unit_key (e.g. two trivially-identical
  // one-line functions in different files) at the same commit, covered by
  // the same test, collapse into ONE row. That silently drops one file's
  // coverage relationship from units-for-test and makes tests-for-unit's
  // confidence lookup resolve against whichever file_path happened to win
  // the ON CONFLICT, not necessarily the one the caller queried by.
  // (Found via Greptile PR review — see coverageMappingService.ts's
  // linkCoverageUnitsToTest/insertTestLinkBatch, whose ON CONFLICT target
  // and ON CONFLICT SET clause changed alongside this index.)
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS coverage_test_links_identity_idx
      ON public.coverage_test_links (commit_sha, file_path, unit_key, COALESCE(branch_id, ''), test_id)
  `);

  pgm.sql(`
    COMMENT ON TABLE public.coverage_test_links IS
      'Coverage/TIA bidirectional code<->test index — attributes coverage_units hits to the specific test(s) that produced them, joined at ingestion time from coverage_session_dumps test_id/test_name attribution. coverage_units itself only carries a commit-wide aggregate hit_count with no per-test breakdown; this table is the derived per-test layer coverageMappingService queries from. Re-ingesting the same dump for the same test merges into the existing row (hit_count accumulated) rather than duplicating.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_test_links_unit_idx
      ON public.coverage_test_links USING btree (commit_sha, unit_key)
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_test_links_test_idx
      ON public.coverage_test_links USING btree (commit_sha, test_id)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.coverage_test_links`);
  pgm.sql(`DROP TABLE IF EXISTS public.coverage_ingested_dumps`);
  pgm.sql(`DROP TABLE IF EXISTS public.coverage_units`);
  pgm.sql(`DROP TABLE IF EXISTS public.coverage_session_dumps`);
  pgm.sql(`DROP TABLE IF EXISTS public.coverage_sessions`);
};
