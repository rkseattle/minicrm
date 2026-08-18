/**
 * Migration 100: Add metadata jsonb overflow column to activities
 *
 * Establishes the extension point for new activity types that require type-specific
 * fields without widening the shared table with nullable typed columns.
 *
 * Existing rows are unaffected (nullable, no backfill required).
 * New activity types should store type-specific fields in metadata rather than
 * adding new nullable columns to the shared table. See CLAUDE.md for the full
 * extension strategy and the column boundary definition.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('activities', {
    metadata: {
      type: 'jsonb',
      notNull: false,
    },
  });
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumn('activities', 'metadata');
};
