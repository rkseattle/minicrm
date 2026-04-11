/**
 * Migration 015: Add password reset token columns to users
 *
 * Adds password_reset_token_hash and password_reset_expires_at to support
 * the forgot-password / reset-password flow (MINCRM-156, MINCRM-157).
 * Also adds password_changed_at so the auth middleware can invalidate JWTs
 * issued before a password reset (session invalidation on other devices).
 *
 * The plaintext token is never stored — only the SHA-256 hash.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('users', {
    password_reset_token_hash: {
      type: 'varchar(64)',
      notNull: false,
      default: null,
    },
    password_reset_expires_at: {
      type: 'timestamptz',
      notNull: false,
      default: null,
    },
    password_changed_at: {
      type: 'timestamptz',
      notNull: false,
      default: null,
    },
  });

  pgm.createIndex('users', 'password_reset_token_hash', {
    name: 'users_password_reset_token_hash_idx',
    where: 'password_reset_token_hash IS NOT NULL',
  });
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('users', 'password_reset_token_hash', {
    name: 'users_password_reset_token_hash_idx',
  });
  pgm.dropColumns('users', [
    'password_reset_token_hash',
    'password_reset_expires_at',
    'password_changed_at',
  ]);
};
