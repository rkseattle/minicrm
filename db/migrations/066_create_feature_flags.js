'use strict';

/**
 * Migration 066: Create feature_flags table and seed all org-wide feature flags.
 * Flags are seeded at install time; new flags are added via migration only.
 * (MINCRM-463)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('feature_flags', {
    flag_key: {
      type: 'varchar(100)',
      primaryKey: true,
    },
    label: {
      type: 'varchar(100)',
      notNull: true,
    },
    description: {
      type: 'text',
      notNull: true,
    },
    category: {
      type: 'varchar(50)',
      notNull: true,
    },
    enabled: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    // Per-role enable/disable; only set for flags that support role overrides.
    // Shape: { "admin": true, "rep": false }
    role_overrides: {
      type: 'jsonb',
      notNull: false,
    },
    updated_by: {
      type: 'uuid',
      notNull: false,
      references: '"users"',
      onDelete: 'SET NULL',
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    // system_flag = true means this flag cannot be deleted, only toggled.
    system_flag: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
  });

  pgm.createIndex('feature_flags', 'category');

  // Seed all flags. All are system_flag = true (cannot be deleted via API).
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      ('notes',               'Notes',                    'Allows users to create and view notes on contacts, accounts, and deals.',              'Core CRM',    true,  NULL,                        true),
      ('tags',                'Tags',                     'Allows users to tag contacts, accounts, and deals for categorization.',                'Core CRM',    true,  NULL,                        true),
      ('activities',          'Activities',               'Enables activity logging (calls, emails, meetings) on CRM records.',                  'Core CRM',    true,  NULL,                        true),
      ('tasks',               'Tasks',                    'Allows users to create and track tasks linked to CRM records.',                       'Core CRM',    true,  NULL,                        true),
      ('lead_scoring',        'Lead Scoring',             'Enables automated scoring of leads based on configurable criteria.',                   'Productivity', true,  NULL,                        true),
      ('duplicate_detection', 'Duplicate Detection',      'Warns users when creating records that may be duplicates of existing ones.',          'Productivity', true,  NULL,                        true),
      ('custom_fields',       'Custom Fields',            'Allows admins to define custom data fields on contacts, accounts, and deals.',        'Productivity', true,  NULL,                        true),
      ('multiple_pipelines',  'Multiple Pipelines',       'Enables management of more than one deal pipeline with independent stage sets.',      'Productivity', true,  NULL,                        true),
      ('reporting',           'Reporting & Dashboards',   'Provides access to built-in reports and the dashboard analytics view.',               'Data',         true,  '{"admin":true,"rep":true}',   true),
      ('sequencing',          'Sequencing',               'Enables automated email cadence sequences for outbound sales outreach.',              'Productivity', true,  NULL,                        true),
      ('csv_import',          'CSV Import',               'Allows bulk import of contacts, accounts, and deals from CSV files.',                 'Data',         true,  NULL,                        true),
      ('csv_export',          'CSV Export',               'Allows users to export CRM records as CSV files.',                                   'Data',         true,  '{"admin":true,"rep":true}',   true),
      ('automation_rules',    'Automation Rules',         'Enables configurable trigger-action automation rules that run on record changes.',    'Integrations', true,  NULL,                        true),
      ('webhooks',            'Webhooks',                 'Allows admins to configure outbound webhook notifications to external systems.',      'Integrations', true,  NULL,                        true),
      ('email_templates',     'Email Templates',          'Provides a library of reusable email templates for use in sequences and activities.', 'Integrations', true,  NULL,                        true),
      ('ai_features',         'AI Features',              'Master toggle for all AI-powered features in the CRM.',                              'AI',           true,  NULL,                        true),
      ('mobile_access',       'Mobile Access',            'Enables access to the CRM from mobile devices.',                                     'Core CRM',    false, NULL,                        true),
      ('demo_data',           'Demo Data',                'Allows loading and removing demo data for onboarding and evaluation purposes.',       'Data',         false, NULL,                        true)
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('feature_flags');
};
