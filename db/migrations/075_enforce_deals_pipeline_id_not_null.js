/**
 * Migration 075: Enforce NOT NULL on deals.pipeline_id.
 *
 * Migration 057 added pipeline_id as nullable to avoid requiring a DEFAULT during
 * the initial backfill, with the explicit intent that a follow-up migration would
 * tighten the constraint. That follow-up was never written. Any deal inserted
 * without a pipeline_id is silently accepted by the DB but invisible on the board.
 *
 * This migration:
 *   1. Backfills any remaining NULL pipeline_id rows to the default pipeline
 *      (idempotent; migration 057 already did this for rows that existed at
 *      that time, but intervening code or scripts could have inserted new NULLs).
 *   2. Sets the column NOT NULL at the DB level.
 */

'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // Guard: raise immediately if no default pipeline exists so the error message
  // names the root cause rather than surfacing a cryptic NOT NULL violation.
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pipelines WHERE is_default = true) THEN
        RAISE EXCEPTION
          'Migration 075 aborted: no row in pipelines has is_default = true. '
          'Ensure the default pipeline is seeded before running this migration.';
      END IF;
    END;
    $$
  `);

  // Backfill any rows that somehow still have a NULL pipeline_id.
  pgm.sql(`
    UPDATE deals
    SET pipeline_id = (SELECT id FROM pipelines WHERE is_default = true LIMIT 1)
    WHERE pipeline_id IS NULL
  `);

  pgm.sql(`ALTER TABLE deals ALTER COLUMN pipeline_id SET NOT NULL`);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE deals ALTER COLUMN pipeline_id DROP NOT NULL`);
};
