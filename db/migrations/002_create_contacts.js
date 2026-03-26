/**
 * Migration 002: Create contacts table
 *
 * Stores person-level CRM records. Each contact is owned by a user.
 * account_id linking is deferred to a later migration (MINCRM-9) once
 * the accounts table exists.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration — creates the contacts table.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('contacts', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
      notNull: true,
    },
    first_name: {
      type: 'varchar(255)',
      notNull: true,
    },
    last_name: {
      type: 'varchar(255)',
      notNull: true,
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
    },
    phone: {
      type: 'varchar(50)',
      notNull: false,
    },
    title: {
      type: 'varchar(255)',
      notNull: false,
    },
    department: {
      type: 'varchar(255)',
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

  // Index email for duplicate-detection queries
  pgm.createIndex('contacts', 'email');
  // Index owner_id for ?owner=me filter
  pgm.createIndex('contacts', 'owner_id');
};

/**
 * Revert the migration — drops the contacts table.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('contacts');
};
