'use strict';

/**
 * Migration 120: Create feature_flag_group_beta_users table.
 * Group beta users bypass the group gate — if a user is in a group's beta list,
 * member flags proceed to their own flag-level evaluation even when the group is disabled.
 * Follows the same contract as feature_flag_beta_users (MINCRM-489).
 * (MINCRM-491)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('feature_flag_group_beta_users', {
    group_key: {
      type: 'varchar(100)',
      notNull: true,
      references: '"feature_flag_groups"',
      onDelete: 'CASCADE',
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
      onDelete: 'CASCADE',
    },
    added_by: {
      type: 'uuid',
      notNull: false,
      references: '"users"',
      onDelete: 'SET NULL',
    },
    added_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('feature_flag_group_beta_users', 'feature_flag_group_beta_users_pkey', {
    primaryKey: ['group_key', 'user_id'],
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('feature_flag_group_beta_users');
};
