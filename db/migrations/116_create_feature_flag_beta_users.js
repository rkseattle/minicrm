'use strict';

/**
 * Migration 116: Create feature_flag_beta_users table.
 * Enables user-level targeting for feature flags — a user enrolled in the beta
 * for a disabled flag will see it as enabled, regardless of org-wide state.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('feature_flag_beta_users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    flag_key: {
      type: 'varchar(100)',
      notNull: true,
      references: '"feature_flags"',
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

  pgm.addConstraint('feature_flag_beta_users', 'feature_flag_beta_users_flag_key_user_id_unique', {
    unique: ['flag_key', 'user_id'],
  });

  pgm.createIndex('feature_flag_beta_users', 'flag_key');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('feature_flag_beta_users');
};
