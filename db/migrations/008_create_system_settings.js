/**
 * Migration 008: Create system_settings table
 *
 * Stores key/value pairs for system-wide configuration. The initial row sets
 * the default language to English.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('system_settings', {
    key: {
      type: 'text',
      primaryKey: true,
    },
    value: {
      type: 'text',
      notNull: true,
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.sql(`INSERT INTO system_settings (key, value) VALUES ('default_language', 'en')`);
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('system_settings');
};
