/**
 * Migration 017: Create overdue_task_notifications table
 *
 * Tracks which tasks have already triggered an overdue email so we
 * don't spam the user with the same overdue task on every daily run. (MINCRM-161)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration — create the deduplication table and seed the global
 * email notifications enabled setting.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('overdue_task_notifications', {
    activity_id: {
      type: 'uuid',
      notNull: true,
      references: 'activities(id)',
      onDelete: 'CASCADE',
      primaryKey: true,
    },
    notified_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Seed the global email notifications toggle (default: enabled)
  pgm.sql(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('email_notifications_enabled', 'true', now())
    ON CONFLICT (key) DO NOTHING
  `);
};

/**
 * Revert the migration — drop the table and the settings row.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('overdue_task_notifications');
  pgm.sql(`DELETE FROM system_settings WHERE key = 'email_notifications_enabled'`);
};
