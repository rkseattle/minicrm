'use strict';

/**
 * Migration 062: Add visibility column to custom_reports.
 * Controls who can see and mutate a report:
 *   private          — only the creator and admins
 *   public_read_only — all authenticated users can view; only creator/admins can edit/delete
 *   public           — all authenticated users have full CRUD
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('custom_reports', {
    visibility: {
      type: 'varchar(16)',
      notNull: true,
      default: 'public',
      check: "visibility IN ('private', 'public_read_only', 'public')",
    },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumn('custom_reports', 'visibility');
};
