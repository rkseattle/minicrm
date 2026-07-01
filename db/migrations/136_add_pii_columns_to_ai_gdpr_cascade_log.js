'use strict';

/**
 * Migration 136: Add original_name and original_email to ai_gdpr_cascade_log.
 *
 * These columns store the contact's PII at the time of the cascade so that an
 * admin-triggered re-run can use the original values for pattern matching, even
 * after the contacts row has been overwritten with redacted placeholders.
 *
 * Both columns are nullable because rows inserted by the first cascade (before
 * this migration) will not have the values backfilled.
 *
 * (MINCRM-446)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(
    `ALTER TABLE ai_gdpr_cascade_log
       ADD COLUMN IF NOT EXISTS original_name  text,
       ADD COLUMN IF NOT EXISTS original_email text`,
  );
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumns('ai_gdpr_cascade_log', ['original_name', 'original_email']);
};
