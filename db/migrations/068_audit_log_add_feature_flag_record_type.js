/**
 * Add 'feature_flag' to the audit_log.record_type CHECK constraint.
 * Required for writeAuditEntry calls from featureFlagService. (MINCRM-463)
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_record_type_check;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_record_type_check
      CHECK (record_type IN (
        'contact', 'account', 'deal', 'lead', 'activity',
        'user', 'system_settings', 'custom_report',
        'sequence', 'sequence_enrollment', 'feature_flag'
      ));
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_record_type_check;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_record_type_check
      CHECK (record_type IN (
        'contact', 'account', 'deal', 'lead', 'activity',
        'user', 'system_settings', 'custom_report',
        'sequence', 'sequence_enrollment'
      ));
  `);
};
