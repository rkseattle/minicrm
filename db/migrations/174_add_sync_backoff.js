'use strict';

/**
 * Migration 174 — Per-mailbox sync backoff state.
 *
 * A scheduler that retries every failing mailbox on every tick turns one unreachable
 * server into a tight loop against it. These two columns hold the retry decision:
 * `sync_failure_count` drives the exponential delay and the ceiling past which a mailbox
 * stops being claimed at all, and `sync_next_attempt_at` is the gate the claim query
 * reads. The timestamp rather than the status is what gates a retry, so an account can be
 * marked `error` for the UI's benefit while still being retried on schedule.
 *
 * The index matches the claim query's shape. 169 indexes `user_id` alone, which no
 * scheduler query can use — it selects across all users — so without this every tick
 * seq-scans the table.
 *
 * Additive, so a rolling deploy is safe forward: a server running the previous build
 * ignores both columns. `down` drops them, discarding in-flight backoff state, which
 * costs one immediate retry per failed mailbox and nothing else.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumns('connected_accounts', {
    sync_failure_count: {
      type: 'integer',
      notNull: true,
      default: 0,
      comment:
        'Consecutive failed sync attempts. Drives the retry delay and the ceiling past which a mailbox is no longer claimed; reset when a connection test succeeds.',
    },
    sync_next_attempt_at: {
      type: 'timestamptz',
      notNull: false,
      comment:
        'Earliest time this mailbox may be synced again. Null means due now. This, not status, is what gates a retry.',
    },
  });

  // The claim query filters on status and provider, orders by the due time, and takes a
  // bounded batch, so the due timestamp leads. Nulls sort first under ASC, which is what
  // puts a never-attempted mailbox ahead of a backed-off one.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS connected_accounts_sync_due_idx
      ON public.connected_accounts (sync_next_attempt_at ASC NULLS FIRST)
      WHERE status IN ('active', 'error')
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.connected_accounts_sync_due_idx`);
  pgm.dropColumns('connected_accounts', ['sync_failure_count', 'sync_next_attempt_at']);
};
