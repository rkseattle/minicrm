'use strict';

/**
 * Migration 157: Coverage/TIA session management. (MINCRM-609, MINCRM-610,
 * MINCRM-611, MINCRM-612)
 *
 * Adds:
 *   1. coverage_session_management feature flag — gates the new
 *      /api/v1/admin/coverage/sessions/* control API, independent of the
 *      coverage_instrumentation flag added in migration 156 (a session can
 *      be created even if the backend agent itself is off, e.g. a
 *      browser-only manual-testing session).
 *   2. coverage_sessions — one row per manual or automated testing session.
 *      Mutated in place (status active -> ended) rather than append-only,
 *      since a session has genuine open/closed lifecycle state that must be
 *      queried ("what's active right now") not just historical log entries.
 *      version column enables optimistic-locking against double-ending a
 *      session from two concurrent requests (see dealService.ts's pattern).
 *   3. coverage_session_dumps — join table attributing individual coverage
 *      dumps (still file-based per migration 156 era Phase 1 — the dumpId
 *      itself is not FK'd to a DB row, only referenced by UUID) to a
 *      session via a correlation ID. A session can accumulate many dumps
 *      (per-test dumps during an E2E run, or repeated check-in/out cycles
 *      for a manual session); the correlation_id column is what the
 *      coverage agent tags dumps with, decoupling attribution from the
 *      single-process-wide V8 counter set (MINCRM-610's "partition by
 *      correlation ID rather than global reset/dump").
 *
 * varchar + CHECK for status/source, not a PG ENUM, per repo convention
 * (see CLAUDE.md "varchar + CHECK for new constrained-string columns —
 * never new PG ENUMs").
 *
 * coverage_sessions.started_by is nullable with ON DELETE SET NULL, not
 * CASCADE — deleting a user must not silently destroy coverage/testing
 * history, mirroring migration 074's fix (MINCRM-505) for the same
 * anti-pattern on import_jobs.created_by / webhook_subscriptions.created_by.
 * "Every other created_by/owner FK in the schema uses RESTRICT or SET NULL."
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

  // ── 2. coverage_sessions ──────────────────────────────────────────────────
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
      started_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
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
      'Coverage/TIA testing sessions (MINCRM-609..612) — a logical grouping of one or more coverage dumps attributed to a single automated test run or manual-exploratory-testing session. correlation_id is the value propagated via the x-coverage-correlation-id header (see correlationId middleware) and stamped onto dumps in coverage_session_dumps; it is NOT a physically isolated V8 counter scope — the backend coverage agent remains a single process-wide counter set (see NodeV8CoverageAgent), so overlapping sessions on the same server instance still share the same underlying counters. version supports optimistic locking against concurrent end-session requests.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_sessions_status_idx
      ON public.coverage_sessions USING btree (status)
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_sessions_started_by_idx
      ON public.coverage_sessions USING btree (started_by)
  `);

  // ── 3. coverage_session_dumps ─────────────────────────────────────────────
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
      'Attributes a single coverage dump (dump_id — a crypto.randomUUID() minted by NodeV8CoverageAgent/coverageDumpService, not FK''d since dump metadata itself stays file-based per Phase 1) to the coverage_sessions row that produced it. test_id/test_name/attempt support MINCRM-612''s retry-attribution requirement: a Playwright retry re-runs the same test_id with attempt incremented, so retried/flaky tests are distinguishable in the record rather than silently overwriting or double-counting the prior attempt''s dump.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_session_dumps_session_id_idx
      ON public.coverage_session_dumps USING btree (session_id)
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_session_dumps_correlation_id_idx
      ON public.coverage_session_dumps USING btree (correlation_id)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.coverage_session_dumps`);
  pgm.sql(`DROP TABLE IF EXISTS public.coverage_sessions`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'coverage_session_management'`);
};
