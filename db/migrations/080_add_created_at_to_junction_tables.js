'use strict';

/**
 * Migration 080: Add created_at to junction tables. (MINCRM-513)
 *
 * Four junction tables have no timestamp columns, preventing any answer to
 * "when was this tag applied?" or "when was this contact linked to this deal?":
 *   contact_tags, account_tags, deal_tags, deal_contacts
 *
 * Existing rows receive the current transaction timestamp as the default.
 * This is intentional — historical backfill is not possible — and is
 * acceptable per the acceptance criteria.
 *
 * No service-layer changes are required; the column is written exclusively
 * via the DEFAULT on INSERT.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

const JUNCTION_TABLES = ['contact_tags', 'account_tags', 'deal_tags', 'deal_contacts'];

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  for (const table of JUNCTION_TABLES) {
    pgm.sql(`
      ALTER TABLE ${table}
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
    `);
  }
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  for (const table of [...JUNCTION_TABLES].reverse()) {
    pgm.sql(`ALTER TABLE ${table} DROP COLUMN IF EXISTS created_at;`);
  }
};
