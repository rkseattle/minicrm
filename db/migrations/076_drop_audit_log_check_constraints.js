'use strict';

/**
 * Migration 076: Drop CHECK constraints on audit_log.event_type and
 * audit_log.record_type.
 *
 * These constraints have been re-created by every migration that introduced a
 * new audit event or record type, creating unnecessary migration churn and a
 * risk of schema drift if a developer forgets to update the constraint list.
 *
 * Valid values are now enforced exclusively at the service layer via the
 * TypeScript union types AuditEventType and AuditRecordType in
 * server/src/services/auditService.ts. The compiler prevents any callee from
 * passing an unknown type — making the DB-level constraint redundant.
 *
 * A table comment is added to document the authoritative value list for DBAs
 * and developers inspecting the schema directly.
 *
 * The down migration restores the constraints to the state left by migration 069
 * (the most recent migration to touch audit_log_record_type_check) and
 * migration 060 (the most recent to touch audit_log_event_type_check).
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_event_type_check,
      DROP CONSTRAINT IF EXISTS audit_log_record_type_check;

    COMMENT ON TABLE audit_log IS
      'Append-only audit trail. Valid record_type values: contact, account, deal, lead, activity, user, system_settings, custom_report, sequence, sequence_enrollment, feature_flag, ai_settings. Valid event_type values: created, updated, deleted, login, logout, password_changed, role_changed, deactivated, reactivated, ownership_reassigned, merged, note_created, note_updated, note_deleted, note_visibility_changed, gdpr_erasure, mfa_enabled, mfa_disabled, sso_login, sso_provisioned, sso_linked, sso_unlinked. Enforced at service layer via AuditRecordType and AuditEventType TypeScript unions in server/src/services/auditService.ts.';
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  // Restore constraints to the state after migration 069 (record_type) and
  // migration 060 (event_type).
  pgm.sql(`
    COMMENT ON TABLE audit_log IS NULL;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_record_type_check
      CHECK (record_type IN (
        'contact', 'account', 'deal', 'lead', 'activity',
        'user', 'system_settings', 'custom_report',
        'sequence', 'sequence_enrollment', 'feature_flag', 'ai_settings'
      ));

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_event_type_check
      CHECK (event_type IN (
        'created','updated','deleted','login','logout',
        'password_changed','role_changed','deactivated','reactivated',
        'ownership_reassigned','merged',
        'note_created','note_updated','note_deleted','note_visibility_changed',
        'gdpr_erasure',
        'mfa_enabled','mfa_disabled',
        'sso_login','sso_provisioned','sso_linked','sso_unlinked'
      ));
  `);
};
