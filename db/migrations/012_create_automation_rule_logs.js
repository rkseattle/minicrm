/**
 * Migration 012: Create automation_rule_logs table
 *
 * Records each execution of an automation rule. Used to show the 20 most recent
 * executions per rule in the UI.
 *
 * triggering_record_type: 'deal' | 'contact'
 * triggering_record_id: UUID of the record that caused the trigger to fire
 * outcome: 'success' | 'error'
 * error_message: populated only when outcome = 'error'
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createType('automation_log_outcome', ['success', 'error']);

  pgm.createTable('automation_rule_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    rule_id: {
      type: 'uuid',
      notNull: true,
      references: '"automation_rules"',
      onDelete: 'CASCADE',
    },
    triggered_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    triggering_record_type: {
      type: 'varchar(50)',
      notNull: true,
    },
    triggering_record_id: {
      type: 'uuid',
      notNull: true,
    },
    outcome: {
      type: 'automation_log_outcome',
      notNull: true,
    },
    error_message: {
      type: 'text',
    },
  });

  pgm.createIndex('automation_rule_logs', ['rule_id', 'triggered_at']);
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('automation_rule_logs');
  pgm.dropType('automation_log_outcome');
};
