/**
 * Migration 028: add 'merged' to audit_log event_type CHECK constraint.
 * Required by the contact merge feature (MINCRM-187) which writes a 'merged'
 * audit event when two contact records are consolidated.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_event_type_check;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_event_type_check
      CHECK (event_type IN (
        'created','updated','deleted','login','logout',
        'password_changed','role_changed','deactivated','reactivated',
        'ownership_reassigned','merged'
      ));
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_event_type_check;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_event_type_check
      CHECK (event_type IN (
        'created','updated','deleted','login','logout',
        'password_changed','role_changed','deactivated','reactivated',
        'ownership_reassigned'
      ));
  `);
};
