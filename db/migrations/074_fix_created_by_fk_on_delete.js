/**
 * Migration 074: Fix ON DELETE behavior for import_jobs.created_by and
 * webhook_subscriptions.created_by. (MINCRM-505)
 *
 * import_jobs.created_by had ON DELETE CASCADE, which silently destroys import
 * history (including error_csv audit trails) when a user is deleted. Every other
 * created_by / owner FK in the schema uses RESTRICT or SET NULL.
 *
 * webhook_subscriptions.created_by had no ON DELETE clause (defaults to RESTRICT /
 * NO ACTION), which produces a cryptic FK violation when deleting a user who owns
 * subscriptions.
 *
 * Both columns are corrected to ON DELETE SET NULL and made nullable so that user
 * deletion preserves the historical record with a NULL owner rather than either
 * cascading the delete or blocking it.
 */

'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // ── import_jobs.created_by ──────────────────────────────────────────────────
  // Drop the NOT NULL constraint and the CASCADE FK, then re-add as SET NULL.
  pgm.sql(`
    ALTER TABLE import_jobs
      DROP CONSTRAINT import_jobs_created_by_fkey,
      ALTER COLUMN created_by DROP NOT NULL,
      ADD CONSTRAINT import_jobs_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  `);

  // ── webhook_subscriptions.created_by ────────────────────────────────────────
  // Drop the NOT NULL constraint and the implicit RESTRICT FK, then re-add as SET NULL.
  pgm.sql(`
    ALTER TABLE webhook_subscriptions
      DROP CONSTRAINT webhook_subscriptions_created_by_fkey,
      ALTER COLUMN created_by DROP NOT NULL,
      ADD CONSTRAINT webhook_subscriptions_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // ── webhook_subscriptions.created_by ────────────────────────────────────────
  // Restore NOT NULL (requires no NULL values; safe because SET NULL only fires
  // when a user is deleted, and restoring NOT NULL means users cannot be deleted
  // while they own subscriptions — matching the original implicit RESTRICT behaviour).
  pgm.sql(`
    ALTER TABLE webhook_subscriptions
      DROP CONSTRAINT webhook_subscriptions_created_by_fkey,
      ALTER COLUMN created_by SET NOT NULL,
      ADD CONSTRAINT webhook_subscriptions_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id)
  `);

  // ── import_jobs.created_by ──────────────────────────────────────────────────
  pgm.sql(`
    ALTER TABLE import_jobs
      DROP CONSTRAINT import_jobs_created_by_fkey,
      ALTER COLUMN created_by SET NOT NULL,
      ADD CONSTRAINT import_jobs_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
  `);
};
