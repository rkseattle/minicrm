/**
 * Migration 011: Create automation_rules table
 *
 * Automation rules pair a trigger (e.g., deal stage changed) with an action
 * (e.g., create a task). Rules are created and managed by admins only.
 *
 * trigger_config stores trigger-specific parameters as JSONB:
 *   - deal_stage_changed: { stage: string }  — fires when a deal moves to this stage
 *   - deal_created / contact_created: {}      — no extra params
 *
 * action_config stores action-specific parameters as JSONB:
 *   - create_task: { subject, task_type, assignee_type ('owner'|'specific'),
 *                    assignee_id (uuid, only when assignee_type='specific'),
 *                    due_date_offset_days (integer >= 0) }
 *   - send_notification: { message }
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createType('automation_trigger_type', [
    'deal_stage_changed',
    'deal_created',
    'contact_created',
  ]);

  pgm.createType('automation_action_type', ['create_task', 'send_notification']);

  pgm.createTable('automation_rules', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    enabled: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    trigger_type: {
      type: 'automation_trigger_type',
      notNull: true,
    },
    trigger_config: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    action_type: {
      type: 'automation_action_type',
      notNull: true,
    },
    action_config: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    created_by: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
      onDelete: 'RESTRICT',
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

  pgm.createIndex('automation_rules', 'trigger_type');
  pgm.createIndex('automation_rules', 'enabled');
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('automation_rules');
  pgm.dropType('automation_action_type');
  pgm.dropType('automation_trigger_type');
};
