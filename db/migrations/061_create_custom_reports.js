'use strict';

/**
 * Migration 061: Create custom_reports table.
 * Stores user-defined report definitions (entity type, selected fields, filter
 * conditions, grouping, sort, aggregates) as a JSONB config blob. Reports are
 * executed on demand — no cached results table.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('custom_reports', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(200)',
      notNull: true,
      unique: true,
    },
    entity_type: {
      type: 'varchar(16)',
      notNull: true,
      check: "entity_type IN ('contact', 'account', 'deal', 'lead', 'activity')",
    },
    config: {
      type: 'jsonb',
      notNull: true,
    },
    created_by: {
      type: 'uuid',
      notNull: false,
      references: '"users"',
      onDelete: 'SET NULL',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('custom_reports', 'created_by');

  // Extend audit_log.record_type CHECK constraint to allow 'custom_report'
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_record_type_check;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_record_type_check
      CHECK (record_type IN (
        'contact', 'account', 'deal', 'lead', 'activity',
        'user', 'system_settings', 'custom_report'
      ));
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('custom_reports');

  // Restore the pre-061 CHECK constraint
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_record_type_check;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_record_type_check
      CHECK (record_type IN (
        'contact', 'account', 'deal', 'lead', 'activity',
        'user', 'system_settings'
      ));
  `);
};
