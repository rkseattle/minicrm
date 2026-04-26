/**
 * Migration 036: Add SMTP configuration rows to system_settings (MINCRM-254)
 *
 * Stores SMTP configuration as key-value rows in the existing system_settings
 * table, matching the pattern used by storage and other settings. The password
 * ciphertext is stored encrypted via cryptoService; the plaintext is never
 * persisted. smtp_enabled is stored as the string 'true' / 'false'.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration — seeds the five SMTP setting rows with empty / default values.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES
      ('smtp_host',           '',      now()),
      ('smtp_port',           '587',   now()),
      ('smtp_user',           '',      now()),
      ('smtp_pass_encrypted', '',      now()),
      ('smtp_enabled',        'false', now())
    ON CONFLICT (key) DO NOTHING
  `);
};

/**
 * Revert the migration — removes the SMTP setting rows.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM system_settings
    WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass_encrypted', 'smtp_enabled')
  `);
};
