'use strict';

/**
 * Migration 090: Add api_key_key_version to ai_configuration.
 *
 * Encryption key versioning allows the application key to be rotated without a
 * maintenance window. The application maintains a versioned keyring; encryption
 * always uses the current key version; decryption selects the key by the stored
 * version. Existing ciphertexts are backfilled with key_version = 1.
 *
 * The column is a smallint (not integer) because realistic keyring sizes are
 * small (< 100) and the smaller type signals the intended use.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumn('ai_configuration', {
    api_key_key_version: {
      type: 'smallint',
      notNull: true,
      default: 1,
      comment: 'Key version used to encrypt api_key_encrypted. References ENCRYPTION_KEY_V<n> env var (MINCRM-519)',
    },
  });

  // Backfill: all existing ciphertexts were encrypted with key version 1.
  pgm.sql(`UPDATE ai_configuration SET api_key_key_version = 1`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumn('ai_configuration', 'api_key_key_version');
};
