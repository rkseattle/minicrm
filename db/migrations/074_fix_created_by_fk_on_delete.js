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
  // Restoring NOT NULL requires no existing NULL values. If any user was deleted
  // after the up migration ran, SET NULL will have produced NULL rows and this
  // statement will fail. A manual UPDATE ... SET created_by = <fallback_id>
  // WHERE created_by IS NULL is required before rolling back in that case.
  pgm.sql(`
    UPDATE webhook_subscriptions
    SET created_by = (SELECT id FROM users ORDER BY created_at LIMIT 1)
    WHERE created_by IS NULL
  `);
  pgm.sql(`
    ALTER TABLE webhook_subscriptions
      DROP CONSTRAINT webhook_subscriptions_created_by_fkey,
      ALTER COLUMN created_by SET NOT NULL,
      ADD CONSTRAINT webhook_subscriptions_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id)
  `);

  // ── import_jobs.created_by ──────────────────────────────────────────────────
  pgm.sql(`
    UPDATE import_jobs
    SET created_by = (SELECT id FROM users ORDER BY created_at LIMIT 1)
    WHERE created_by IS NULL
  `);
  pgm.sql(`
    ALTER TABLE import_jobs
      DROP CONSTRAINT import_jobs_created_by_fkey,
      ALTER COLUMN created_by SET NOT NULL,
      ADD CONSTRAINT import_jobs_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
  `);
};
