/**
 * Migration 046: add 'lead' to audit_log record_type CHECK constraint.
 * Migration 044 added notes support for leads (MINCRM-352), which writes audit
 * entries with record_type='lead', but the existing constraint only allowed
 * contact, account, deal, user, and system_settings.
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
      CHECK (record_type IN ('contact', 'account', 'deal', 'lead', 'user', 'system_settings'));
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
      CHECK (record_type IN ('contact', 'account', 'deal', 'user', 'system_settings'));
  `);
};
