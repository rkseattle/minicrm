/**
 * Migration 016: Add email notification preference columns to users
 *
 * Adds three boolean flags to control which email notifications a user receives.
 * All default to true so existing users are opted in by default. (MINCRM-163)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration — add notification preference columns.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('users', {
    notify_overdue_tasks: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    notify_assignments: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    notify_deal_stage_changes: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
  });
};

/**
 * Revert the migration — drop notification preference columns.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumns('users', [
    'notify_overdue_tasks',
    'notify_assignments',
    'notify_deal_stage_changes',
  ]);
};
