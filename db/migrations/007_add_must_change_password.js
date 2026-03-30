/**
 * Migration 007: Add must_change_password column to users
 *
 * When an admin sets a user's password directly, this flag is set to true.
 * The user is then prompted to change their password on next login.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('users', {
    must_change_password: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
  });
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumn('users', 'must_change_password');
};
