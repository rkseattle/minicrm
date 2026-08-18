'use strict';

/**
 * Migration 053: add 'activity' to audit_log record_type CHECK constraint.
 * Required by the change that adds audit entries for activity CRUD operations.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_record_type_check;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_record_type_check
      CHECK (record_type IN ('contact', 'account', 'deal', 'lead', 'activity', 'user', 'system_settings'));
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_record_type_check;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_record_type_check
      CHECK (record_type IN ('contact', 'account', 'deal', 'lead', 'user', 'system_settings'));
  `);
};
