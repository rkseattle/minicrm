'use strict';

/**
 * Migration 054: Add TOTP two-factor authentication fields to users table
 * and the require_mfa system setting. (MINCRM-392)
 *
 * mfa_secret is stored AES-256-GCM encrypted (same pattern as file_storage_secret).
 * mfa_recovery_codes stores an array of bcrypt hashes for single-use recovery codes.
 * mfa_pending_secret holds an unconfirmed secret during the setup flow; cleared on enable.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS mfa_secret text,
      ADD COLUMN IF NOT EXISTS mfa_pending_secret text,
      ADD COLUMN IF NOT EXISTS mfa_recovery_codes text[] NOT NULL DEFAULT '{}';

    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('require_mfa', 'false', NOW())
    ON CONFLICT (key) DO NOTHING;
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      DROP COLUMN IF EXISTS mfa_enabled,
      DROP COLUMN IF EXISTS mfa_secret,
      DROP COLUMN IF EXISTS mfa_pending_secret,
      DROP COLUMN IF EXISTS mfa_recovery_codes;

    DELETE FROM system_settings WHERE key = 'require_mfa';
  `);
};
