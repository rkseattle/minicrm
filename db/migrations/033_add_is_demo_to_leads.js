/**
 * Migration 033: Add is_demo flag to leads and automation_rules tables.
 * Consistent with migration 013's pattern for contacts/accounts/deals/activities.
 * Required before demo leads and automation rules can be seeded and cleanly removed. (MINCRM-206)
 */

'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('leads', {
    is_demo: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
  });
  pgm.createIndex('leads', 'is_demo');

  pgm.addColumn('automation_rules', {
    is_demo: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
  });
  pgm.createIndex('automation_rules', 'is_demo');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('automation_rules', 'is_demo');
  pgm.dropColumn('automation_rules', 'is_demo');

  pgm.dropIndex('leads', 'is_demo');
  pgm.dropColumn('leads', 'is_demo');
};
