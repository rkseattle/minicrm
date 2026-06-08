'use strict';

/**
 * Migration 078: Add missing indexes for sequence scheduler, notes soft-delete,
 * and lead conversion queries. (MINCRM-508)
 *
 * 1. sequence_enrollments_status_next_action_idx — partial composite index covering
 *    the scheduler's hot poll: WHERE status = 'active' AND next_action_at <= now().
 *    The existing next_action_at index covers all statuses; this partial index lets
 *    the planner skip completed/unenrolled rows entirely.
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
      ON sequence_enrollments (status, next_action_at)
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
