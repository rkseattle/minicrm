'use strict';

/**
 * Migration 178 — Index email_messages by (connected_account_id, thread_id).
 *
 * The read API selects a page of threads and then joins their messages back on both
 * columns. Migration 172's indexes serve neither shape: the bare thread_id index makes the
 * planner recheck the account as a filter, and the (connected_account_id, sent_at) index
 * cannot answer a thread lookup at all. EXPLAIN on `WHERE connected_account_id = $1 AND
 * thread_id = $2` over 100k rows: a bitmap scan plus recheck without this index, a direct
 * index scan with it.
 *
 * A thread id is unique only within a mailbox, so the account column leads.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX email_messages_account_thread_idx
      ON public.email_messages (connected_account_id, thread_id)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.email_messages_account_thread_idx`);
};
