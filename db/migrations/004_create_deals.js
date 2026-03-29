/**
 * Migration 004: Create deals table
 *
 * Stores opportunity records. Each deal is owned by a user and optionally
 * linked to an account. Stage is restricted to the fixed alpha pipeline stages.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('deals', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
      notNull: true,
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    stage: {
      type: 'varchar(50)',
      notNull: true,
    },
    value: {
      type: 'numeric(15,2)',
      notNull: false,
    },
    close_date: {
      type: 'date',
      notNull: false,
    },
    loss_reason: {
      type: 'text',
      notNull: false,
    },
    account_id: {
      type: 'uuid',
      notNull: false,
      references: '"accounts"',
      onDelete: 'SET NULL',
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

  // Enforce valid pipeline stages at the DB level
  pgm.addConstraint('deals', 'deals_stage_check', {
    check: `stage IN ('Prospecting','Qualification','Proposal','Negotiation','Closed Won','Closed Lost')`,
  });

  // Index owner_id for ?owner=me filter
  pgm.createIndex('deals', 'owner_id');

  // Index account_id for filtering deals by account
  pgm.createIndex('deals', 'account_id');
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('deals');
};
