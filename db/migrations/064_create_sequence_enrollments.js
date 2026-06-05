'use strict';

/**
 * Migration 064: Create sequence_enrollments and sequence_enrollment_logs tables.
 * An enrollment tracks one contact's progress through a sales sequence.
 * A partial unique index prevents duplicate active enrollments for the same
 * (sequence, contact) pair. (MINCRM-403)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('sequence_enrollments', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    sequence_id: {
      type: 'uuid',
      notNull: true,
      references: '"sales_sequences"',
      onDelete: 'CASCADE',
    },
    contact_id: {
      type: 'uuid',
      notNull: true,
      references: '"contacts"',
      onDelete: 'CASCADE',
    },
    enrolled_by_id: {
      type: 'uuid',
      notNull: false,
      references: '"users"',
      onDelete: 'SET NULL',
    },
    enrolled_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    status: {
      type: 'varchar(16)',
      notNull: true,
      default: "'active'",
      check: "status IN ('active', 'completed', 'unenrolled')",
    },
    current_step_id: {
      type: 'uuid',
      notNull: false,
      references: '"sales_sequence_steps"',
      onDelete: 'SET NULL',
    },
    next_action_at: {
      type: 'timestamptz',
      notNull: false,
    },
    unenrolled_at: {
      type: 'timestamptz',
      notNull: false,
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

  pgm.createIndex('sequence_enrollments', 'sequence_id');
  pgm.createIndex('sequence_enrollments', 'contact_id');
  pgm.createIndex('sequence_enrollments', 'next_action_at');

  // Prevent duplicate active enrollments for the same (sequence, contact) pair
  pgm.sql(`
    CREATE UNIQUE INDEX uq_active_enrollment
      ON sequence_enrollments (sequence_id, contact_id)
      WHERE status = 'active';
  `);

  pgm.createTable('sequence_enrollment_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    enrollment_id: {
      type: 'uuid',
      notNull: true,
      references: '"sequence_enrollments"',
      onDelete: 'CASCADE',
    },
    step_id: {
      type: 'uuid',
      notNull: false,
      references: '"sales_sequence_steps"',
      onDelete: 'SET NULL',
    },
    executed_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    action_type: {
      type: 'varchar(32)',
      notNull: true,
    },
    outcome: {
      type: 'varchar(8)',
      notNull: true,
      check: "outcome IN ('success', 'skipped', 'error')",
    },
    error_message: {
      type: 'text',
      notNull: false,
    },
  });

  pgm.createIndex('sequence_enrollment_logs', 'enrollment_id');

  // Extend audit_log.record_type CHECK to allow 'sequence' and 'sequence_enrollment'
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

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('sequence_enrollment_logs');
  pgm.dropTable('sequence_enrollments');

  // Restore pre-064 CHECK constraint
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
