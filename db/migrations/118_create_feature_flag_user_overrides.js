'use strict';

/**
 * Migration 118: Create feature_flag_user_overrides table.
 * Allows admins to force a flag on (force_enabled) or off (force_disabled)
 * for a specific user, unconditionally overriding all other targeting rules.
 * Overrides are evaluated first in the isFlagEnabledForUser resolution chain.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('feature_flag_user_overrides', {
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
    override: {
      type: 'varchar(20)',
      notNull: true,
    },
    reason: {
      type: 'text',
      notNull: false,
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

  pgm.addConstraint(
    'feature_flag_user_overrides',
    'feature_flag_user_overrides_override_check',
    { check: "override IN ('force_enabled', 'force_disabled')" },
  );

  pgm.addConstraint(
    'feature_flag_user_overrides',
    'feature_flag_user_overrides_flag_key_user_id_unique',
    { unique: ['flag_key', 'user_id'] },
  );

  pgm.createIndex('feature_flag_user_overrides', 'flag_key');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('feature_flag_user_overrides');
};
