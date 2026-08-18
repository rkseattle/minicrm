/**
 * Migration 013: Add is_demo flag to contacts, accounts, deals, and activities
 *
 * Demo records are identified by is_demo = true. This allows the seed-demo and
 * remove-demo scripts to insert and purge demo data without touching real records.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration — adds is_demo column to all four core entity tables.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  for (const table of ['contacts', 'accounts', 'deals', 'activities']) {
    pgm.addColumn(table, {
      is_demo: {
        type: 'boolean',
        notNull: true,
        default: false,
      },
    });
    pgm.createIndex(table, 'is_demo');
  }
};

/**
 * Revert the migration — drops is_demo from all four tables.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  for (const table of ['contacts', 'accounts', 'deals', 'activities']) {
    pgm.dropIndex(table, 'is_demo');
    pgm.dropColumn(table, 'is_demo');
  }
};
