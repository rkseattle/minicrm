'use strict';

/**
 * Migration 065: Add is_demo flag to sales_sequences so demo sequences can be
 * identified and removed by the demo teardown routine.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales_sequences
      ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales_sequences
      DROP COLUMN IF EXISTS is_demo
  `);
};
