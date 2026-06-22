'use strict';

/**
 * Migration 115: Add enable_at scheduling column to feature_flags.
 * A flag with enable_at <= now() is treated as enabled at evaluation time,
 * regardless of the enabled column value. No background job is required.
 * (MINCRM-488)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('feature_flags', {
    enable_at: {
      type: 'timestamptz',
      notNull: false,
      default: null,
    },
  });

  pgm.sql(`COMMENT ON COLUMN public.feature_flags.enable_at IS 'When set and <= now(), the flag is treated as enabled regardless of the enabled column. Evaluated lazily at resolution time — no background job required. (MINCRM-488)'`);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumn('feature_flags', 'enable_at');
};
