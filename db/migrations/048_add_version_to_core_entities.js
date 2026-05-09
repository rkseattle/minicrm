/**
 * Migration 048 — Add optimistic locking version column to core CRM entities.
 * (MINCRM-349)
 *
 * Adds `version INTEGER NOT NULL DEFAULT 1` to contacts, accounts, deals,
 * leads, and activities. All existing rows receive version = 1. New rows
 * created after this migration also start at version = 1 via the column
 * default.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  for (const table of ['contacts', 'accounts', 'deals', 'leads', 'activities']) {
    pgm.addColumn(table, {
      version: { type: 'integer', notNull: true, default: 1 },
    });
  }
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  for (const table of ['contacts', 'accounts', 'deals', 'leads', 'activities']) {
    pgm.dropColumn(table, 'version');
  }
};
