'use strict';

/**
 * Migration 117: Add controlled rollout columns to feature_flags.
 * rollout_percentage (0–100) controls what share of users see the flag as enabled.
 * rollout_stages (JSONB) holds the scheduled advancement schedule.
 * User bucketing is deterministic via stableHash(userId + flagKey) % 100.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('feature_flags', {
    rollout_percentage: {
      type: 'smallint',
      notNull: false,
      default: null,
    },
  });

  pgm.addConstraint('feature_flags', 'feature_flags_rollout_percentage_range', {
    check: 'rollout_percentage BETWEEN 0 AND 100',
  });

  pgm.addColumn('feature_flags', {
    rollout_stages: {
      type: 'jsonb',
      notNull: false,
      default: null,
    },
  });

  pgm.sql(`COMMENT ON COLUMN public.feature_flags.rollout_percentage IS 'When non-null, gates users via stableHash(userId+flagKey)%100 < rollout_percentage. null skips rollout gating entirely. 100 means all users are enabled. (MINCRM-490)'`);
  pgm.sql(`COMMENT ON COLUMN public.feature_flags.rollout_stages IS 'Ordered array of {percentage, scheduled_at} objects. Background scheduler advances rollout_percentage when scheduled_at <= now(). (MINCRM-490)'`);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropConstraint('feature_flags', 'feature_flags_rollout_percentage_range');
  pgm.dropColumn('feature_flags', 'rollout_stages');
  pgm.dropColumn('feature_flags', 'rollout_percentage');
};
