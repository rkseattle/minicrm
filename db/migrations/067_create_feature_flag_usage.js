'use strict';

/**
 * Migration 067: Create feature_flag_usage table for tracking per-user feature activity.
 * Used to show "X users active in last 30 days" warnings in the admin feature flag UI
 * before disabling a flag. One row per (flag_key, user_id) pair — upserted on each use.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('feature_flag_usage', {
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
    used_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('feature_flag_usage', 'pk_feature_flag_usage', {
    primaryKey: ['flag_key', 'user_id'],
  });

  pgm.createIndex('feature_flag_usage', 'used_at');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('feature_flag_usage');
};
