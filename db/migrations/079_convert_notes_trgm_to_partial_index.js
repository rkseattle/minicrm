'use strict';

/**
 * Migration 079: Convert notes_body_text_trgm_idx to a partial GIN index
 * excluding soft-deleted rows. (MINCRM-515)
 *
 * Migration 049 created a full GIN trigram index on notes.body_text covering
 * all rows including soft-deleted ones (deleted_at IS NOT NULL). Every
 * production search query in noteService.ts filters WHERE deleted_at IS NULL,
 * so deleted rows consume index space and are never reached through this path.
 *
 * Replacing the full index with a partial index reduces index size in proportion
 * to the fraction of deleted notes, and keeps the index focused on the rows
 * that queries actually touch.
 *
 * The index name is preserved so existing query plans and monitoring that
 * reference the index by name continue to work without changes.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS notes_body_text_trgm_idx;');

  pgm.sql(`
    CREATE INDEX notes_body_text_trgm_idx
      ON notes USING gin (body_text gin_trgm_ops)
      WHERE deleted_at IS NULL;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS notes_body_text_trgm_idx;');

  pgm.sql(`
    CREATE INDEX notes_body_text_trgm_idx
      ON notes USING gin (body_text gin_trgm_ops);
  `);
};
