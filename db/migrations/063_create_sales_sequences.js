'use strict';

/**
 * Migration 063: Create sales_sequences and sales_sequence_steps tables.
 * A sequence is a named ordered list of steps (send_email, log_call_reminder,
 * create_task) each with a configurable delay in days before the step fires.
 * Step 1 defaults to delay_days = 0 (fires immediately on enrollment).
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('sales_sequences', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(200)',
      notNull: true,
    },
    description: {
      type: 'text',
      notNull: false,
    },
    enabled: {
      type: 'boolean',
      notNull: true,
      default: true,
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

  pgm.createIndex('sales_sequences', 'created_by');

  pgm.createTable('sales_sequence_steps', {
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
    sort_order: {
      type: 'integer',
      notNull: true,
    },
    action_type: {
      type: 'varchar(32)',
      notNull: true,
      check: "action_type IN ('send_email', 'log_call_reminder', 'create_task')",
    },
    action_config: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    delay_days: {
      type: 'integer',
      notNull: true,
      default: 0,
      check: 'delay_days >= 0',
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

  pgm.createIndex('sales_sequence_steps', 'sequence_id');
  pgm.addConstraint('sales_sequence_steps', 'uq_sequence_sort_order', {
    unique: ['sequence_id', 'sort_order'],
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('sales_sequence_steps');
  pgm.dropTable('sales_sequences');
};
