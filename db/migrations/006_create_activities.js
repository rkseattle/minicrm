/**
 * Migration 006: Create activities table
 *
 * Activities can be attached to a contact, account, or deal (at least one required).
 * Deleting the parent record cascades to remove its activities.
 * Activities of type Task carry a due_date and a status (open / complete).
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createType('activity_type', ['Note', 'Call', 'Email', 'Meeting', 'Task']);
  pgm.createType('activity_status', ['open', 'complete']);

  pgm.createTable('activities', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    type: {
      type: 'activity_type',
      notNull: true,
    },
    subject: {
      type: 'varchar(255)',
      notNull: true,
    },
    notes: {
      type: 'text',
    },
    due_date: {
      type: 'date',
    },
    status: {
      type: 'activity_status',
      notNull: true,
      default: 'open',
    },
    // At least one parent FK must be non-null (enforced by check constraint below)
    contact_id: {
      type: 'uuid',
      references: '"contacts"',
      onDelete: 'CASCADE',
    },
    account_id: {
      type: 'uuid',
      references: '"accounts"',
      onDelete: 'CASCADE',
    },
    deal_id: {
      type: 'uuid',
      references: '"deals"',
      onDelete: 'CASCADE',
    },
    owner_id: {
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

  // Require at least one parent record to be set
  pgm.addConstraint(
    'activities',
    'activities_has_parent',
    'CHECK (contact_id IS NOT NULL OR account_id IS NOT NULL OR deal_id IS NOT NULL)',
  );

  pgm.createIndex('activities', 'contact_id');
  pgm.createIndex('activities', 'account_id');
  pgm.createIndex('activities', 'deal_id');
  pgm.createIndex('activities', 'owner_id');
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('activities');
  pgm.dropType('activity_status');
  pgm.dropType('activity_type');
};
