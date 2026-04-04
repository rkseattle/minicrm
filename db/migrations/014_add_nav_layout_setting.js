/**
 * Migration 014: Add nav_layout row to system_settings
 *
 * Seeds the default navigation layout setting ('top') so the app has a
 * value to read on first boot without requiring a separate bootstrap step.
 * (MINCRM-133)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration — insert the nav_layout default row.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('nav_layout', 'top', now())
    ON CONFLICT (key) DO NOTHING
  `);
};

/**
 * Revert the migration — remove the nav_layout row.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM system_settings WHERE key = 'nav_layout'`);
};
