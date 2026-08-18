'use strict';

/**
 * Migration 078: Add missing indexes for sequence scheduler, notes soft-delete,
 * and lead conversion queries.
 *
 * 1. sequence_enrollments_status_next_action_idx — partial index on next_action_at
 *    covering only active enrollments (WHERE status = 'active'). Every row inside
 *    this index already satisfies status = 'active' via the predicate, so including
 *    status as an index column would be redundant. The scheduler's query filters
 *    next_action_at <= now() against the smaller active-only index instead of
 *    scanning all statuses.
 *
 * 2. notes_entity_active_idx — partial index on (entity_type, entity_id) excluding
 *    soft-deleted notes. The existing notes_entity_idx covers all rows including
 *    deleted ones. Every production read in noteService.ts filters deleted_at IS NULL,
 *    so covering those rows in the index is wasteful.
 *
 * 3. leads_converted_at_idx — partial index on converted_at for reporting queries
 *    on recently converted leads. Excludes unconverted rows (converted_at IS NULL)
 *    which are the majority and never appear in conversion reports.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX sequence_enrollments_status_next_action_idx
      ON sequence_enrollments (next_action_at)
      WHERE status = 'active';
  `);

  pgm.sql(`
    CREATE INDEX notes_entity_active_idx
      ON notes (entity_type, entity_id)
      WHERE deleted_at IS NULL;
  `);

  pgm.sql(`
    CREATE INDEX leads_converted_at_idx
      ON leads (converted_at)
      WHERE converted_at IS NOT NULL;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS leads_converted_at_idx;');
  pgm.sql('DROP INDEX IF EXISTS notes_entity_active_idx;');
  pgm.sql('DROP INDEX IF EXISTS sequence_enrollments_status_next_action_idx;');
};
