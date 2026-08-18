'use strict';

/**
 * Migration 051: extend audit_log event_type CHECK constraint with gdpr_erasure.
 * Required by the GDPR erasure feature which writes gdpr_erasure
 * audit events when personal data is erased under Art. 17.
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
        'ownership_reassigned','merged',
        'note_created','note_updated','note_deleted','note_visibility_changed',
        'gdpr_erasure'
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
        'ownership_reassigned','merged',
        'note_created','note_updated','note_deleted','note_visibility_changed'
      ));
  `);
};
