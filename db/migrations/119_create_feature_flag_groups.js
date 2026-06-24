'use strict';

/**
 * Migration 119: Create feature_flag_groups table.
 * Groups act as a gate layer above individual flags: if a group is disabled
 * and the requesting user is not in the group's beta list, no member flag can
 * resolve as enabled regardless of its own state.
 * Supports the same enable_at lazy-evaluation scheduling as MINCRM-488.
 * (MINCRM-491)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('feature_flag_groups', {
    group_key: {
      type: 'varchar(100)',
      primaryKey: true,
    },
    label: {
      type: 'varchar(100)',
      notNull: true,
    },
    description: {
      type: 'text',
      notNull: true,
      default: '',
    },
    enabled: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    enable_at: {
      type: 'timestamptz',
      notNull: false,
    },
    updated_by: {
      type: 'uuid',
      notNull: false,
      references: '"users"',
      onDelete: 'SET NULL',
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('feature_flag_groups');
};
