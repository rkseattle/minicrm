/**
 * Migration 010: Add direction and outcome columns to activities table
 *
 * Supports structured communication logging (Call/Email) with direction (Inbound/Outbound)
 * and a free-text outcome field. Both columns are nullable to remain compatible with
 * existing Note, Meeting, and Task activity types.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createType('activity_direction', ['Inbound', 'Outbound']);

  pgm.addColumns('activities', {
    direction: {
      type: 'activity_direction',
      notNull: false,
    },
    outcome: {
      type: 'text',
      notNull: false,
    },
  });
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumns('activities', ['direction', 'outcome']);
  pgm.dropType('activity_direction');
};
