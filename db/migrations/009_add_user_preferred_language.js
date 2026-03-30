/**
 * Migration 009: Add preferred_language column to users table.
 *
 * NULL means the user has no personal preference; the app falls back to
 * the system-wide default (stored in system_settings) when the value is NULL.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('users', {
    preferred_language: {
      type: 'varchar(10)',
      notNull: false,
      default: null,
    },
  });
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumn('users', 'preferred_language');
};
