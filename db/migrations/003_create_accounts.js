/**
 * Migration 003: Create accounts table and add account_id to contacts
 *
 * Stores company-level CRM records. Each account is owned by a user.
 * Also adds the account_id foreign key to the contacts table that was
 * deferred from migration 002.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('accounts', {
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
    industry: {
      type: 'varchar(255)',
      notNull: false,
    },
    website: {
      type: 'varchar(255)',
      notNull: false,
    },
    employee_range: {
      type: 'varchar(50)',
      notNull: false,
    },
    revenue_range: {
      type: 'varchar(50)',
      notNull: false,
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

  // Index owner_id for ?owner=me filter
  pgm.createIndex('accounts', 'owner_id');

  // Add account_id FK to contacts (deferred from migration 002)
  pgm.addColumn('contacts', {
    account_id: {
      type: 'uuid',
      notNull: false,
      references: '"accounts"',
      onDelete: 'SET NULL',
    },
  });

  pgm.createIndex('contacts', 'account_id');
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('contacts', 'account_id');
  pgm.dropColumn('contacts', 'account_id');
  pgm.dropTable('accounts');
};
