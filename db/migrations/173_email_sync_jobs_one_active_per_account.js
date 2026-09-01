'use strict';

/**
 * Migration 173 — At most one unfinished email_sync_job per mailbox.
 *
 * Two scheduler ticks can race to open a backfill for the same account. Without this
 * index both inserts succeed and the loser's row is unreachable: the service returns only
 * the newest unfinished job, so nothing can ever move the other to a terminal status, and
 * the retention purge deletes terminal jobs only. The row would outlive every sweep.
 *
 * A partial unique index rather than a constraint, because the rule applies only while a
 * job is unfinished — an account accumulates any number of completed backfills over time.
 * That also makes it the conflict target the service's INSERT ... ON CONFLICT infers,
 * which is what turns the race into an adoption rather than an error.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS email_sync_jobs_one_active_per_account_idx
      ON public.email_sync_jobs (connected_account_id)
      WHERE status IN ('pending', 'running')
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.email_sync_jobs_one_active_per_account_idx`);
};
