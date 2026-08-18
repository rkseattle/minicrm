'use strict';

/**
 * Migration 091: Add pass_key_version to smtp_configuration.
 *
 * Mirrors migration 090 for the SMTP password column. Existing ciphertexts
 * are backfilled with key_version = 1.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumn('smtp_configuration', {
    pass_key_version: {
      type: 'smallint',
      notNull: true,
      default: 1,
      comment: 'Key version used to encrypt pass_encrypted. References ENCRYPTION_KEY_V<n> env var (MINCRM-519)',
    },
  });

  // Backfill: all existing ciphertexts were encrypted with key version 1.
  pgm.sql(`UPDATE smtp_configuration SET pass_key_version = 1`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumn('smtp_configuration', 'pass_key_version');
};
