/**
 * Migration 001: Create users table
 *
 * Establishes the core users table for authentication and role management.
 * Uses gen_random_uuid() for UUID primary keys (available in Postgres 13+).
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration — creates the users table.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
      notNull: true,
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    password_hash: {
      type: 'text',
      notNull: false,
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    role: {
      type: 'varchar(10)',
      notNull: true,
      check: "role IN ('admin', 'rep')",
      default: "'rep'",
    },
    status: {
      type: 'varchar(10)',
      notNull: true,
      check: "status IN ('active', 'invited', 'inactive')",
      default: "'active'",
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

  // Index email for fast lookup during login
  pgm.createIndex('users', 'email');
};

/**
 * Revert the migration — drops the users table.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('users');
};
