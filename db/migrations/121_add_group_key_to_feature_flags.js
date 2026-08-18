'use strict';

/**
 * Migration 121: Add group_key FK to feature_flags.
 * A flag may belong to at most one group. When the group is deleted, the FK
 * is set to NULL (flag becomes ungrouped) rather than cascading the delete.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('feature_flags', {
    group_key: {
      type: 'varchar(100)',
      notNull: false,
      references: '"feature_flag_groups"',
      onDelete: 'SET NULL',
    },
  });

  pgm.createIndex('feature_flags', 'group_key');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('feature_flags', 'group_key');
  pgm.dropColumn('feature_flags', 'group_key');
};
