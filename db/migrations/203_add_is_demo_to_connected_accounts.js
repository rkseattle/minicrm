'use strict';

/**
 * Migration 203: Add is_demo to connected_accounts, so the demo seed's mailbox can be
 * identified and removed by the demo teardown routine, as every other seeded table's rows
 * are. Its messages need no flag: they cascade from the mailbox.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE connected_accounts
      ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false
  `);
  pgm.sql(`
    COMMENT ON COLUMN connected_accounts.is_demo IS
      'True for the demo seed''s mailbox, which demo removal deletes by this flag.'
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE connected_accounts
      DROP COLUMN IF EXISTS is_demo
  `);
};
