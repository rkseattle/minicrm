'use strict';

/**
 * Migration 004: index on coverage_sessions.build_sha. (MINCRM-642)
 *
 * findCoverageSessionDumpsByBuildSha (coverageSessionService.ts) joins
 * coverage_sessions to coverage_session_dumps filtered on
 * coverage_sessions.build_sha — the attestation gate's "which tests ran
 * against this SHA" reconciliation query. No prior phase queried
 * coverage_sessions by build_sha at all (every existing lookup is by id,
 * correlation_id, or status='active'), so no index covered this access
 * pattern before now.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS coverage_sessions_build_sha_idx
      ON public.coverage_sessions USING btree (build_sha)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.coverage_sessions_build_sha_idx`);
};
