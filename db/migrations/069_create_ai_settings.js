'use strict';

/**
 * Migration 069: Seed default AI configuration keys into system_settings
 * and expand the audit_log record_type constraint to include 'ai_settings'.
 *
 * All AI configuration is stored as key-value rows in system_settings.
 * The encrypted API key is never exposed in plaintext via the API — only
 * the 'ai_api_key_set' boolean indicator is returned to clients.
 *
 * Keys seeded (all with sensible defaults so the admin page renders before
 * any explicit configuration has been saved):
 *
 *   ai_enabled                    'false'
 *   ai_provider                   'anthropic'
 *   ai_model                      'claude-sonnet-4-20250514'
 *   ai_api_key                    '' (empty = not configured)
 *   ai_deployment_mode            'cloud_api'
 *   ai_base_url                   '' (empty = use provider default)
 *   ai_dpa_acknowledged           'false'
 *   ai_dpa_acknowledged_by        ''
 *   ai_dpa_acknowledged_at        ''
 *   ai_dpa_acknowledged_for_provider  ''
 *   ai_custom_dpa_url             ''
 *
 * (MINCRM-457)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Expand the audit_log record_type constraint to include 'ai_settings'.
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_record_type_check;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_record_type_check
      CHECK (record_type IN (
        'contact', 'account', 'deal', 'lead', 'activity',
        'user', 'system_settings', 'custom_report',
        'sequence', 'sequence_enrollment', 'feature_flag', 'ai_settings'
      ));
  `);

  // Seed default AI configuration rows. ON CONFLICT DO NOTHING ensures
  // this is idempotent if the migration is ever re-applied.
  pgm.sql(`
    INSERT INTO system_settings (key, value, updated_at) VALUES
      ('ai_enabled',                   'false',                    now()),
      ('ai_enabled_updated_at',        '',                         now()),
      ('ai_provider',                  'anthropic',                now()),
      ('ai_model',                     'claude-sonnet-4-20250514', now()),
      ('ai_api_key',                   '',                         now()),
      ('ai_deployment_mode',           'cloud_api',                now()),
      ('ai_base_url',                  '',                         now()),
      ('ai_dpa_acknowledged',          'false',                    now()),
      ('ai_dpa_acknowledged_by',       '',                         now()),
      ('ai_dpa_acknowledged_at',       '',                         now()),
      ('ai_dpa_acknowledged_for_provider', '',                     now()),
      ('ai_custom_dpa_url',            '',                         now())
    ON CONFLICT (key) DO NOTHING;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  // Remove the seeded AI settings keys.
  pgm.sql(`
    DELETE FROM system_settings WHERE key IN (
      'ai_enabled',
      'ai_enabled_updated_at',
      'ai_provider',
      'ai_model',
      'ai_api_key',
      'ai_deployment_mode',
      'ai_base_url',
      'ai_dpa_acknowledged',
      'ai_dpa_acknowledged_by',
      'ai_dpa_acknowledged_at',
      'ai_dpa_acknowledged_for_provider',
      'ai_custom_dpa_url'
    );
  `);

  // Revert audit_log constraint to pre-069 state.
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
