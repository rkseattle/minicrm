/**
 * Migration 038 — add tags_restrict_creation to system_settings (MINCRM-263).
 * Inserts the setting row with a default of 'false' if it does not already exist.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('tags_restrict_creation', 'false', now())
    ON CONFLICT (key) DO NOTHING
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM system_settings WHERE key = 'tags_restrict_creation'`);
};
