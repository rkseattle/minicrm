/**
 * Migration 098: Add action_config_snapshot to automation_rule_logs (MINCRM-509)
 *
 * Snapshots the rule's action_config at execution time so historical log entries
 * remain accurate even after the rule is subsequently edited.
 * Nullable — no backfill of pre-existing rows is required.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('automation_rule_logs', {
    action_config_snapshot: {
      type: 'jsonb',
      notNull: false,
    },
  });
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumn('automation_rule_logs', 'action_config_snapshot');
};
