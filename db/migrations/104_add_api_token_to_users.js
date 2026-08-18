/**
 * Migration 104 — Add API token columns to users
 *
 * Service account users authenticate via a long-lived static token supplied in
 * the Authorization: Bearer header instead of a session cookie. The token is
 * never stored in plaintext — only its SHA-256 hex digest is persisted.
 *
 * api_token_hash   — SHA-256 hex of the plaintext token; NULL when no token issued
 * api_token_issued_at — timestamp of the most recent issuance; used in audit display
 *
 * Only one active token per user is supported. Issuing a new token atomically
 * revokes the previous one (by overwriting the hash). Revocation NULLs both columns.
 *
 * A unique index on api_token_hash (partial, WHERE NOT NULL) enforces that no two
 * users share the same token hash, protecting against hash-collision attacks.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumns('users', {
    api_token_hash: {
      type: 'text',
      notNull: false,
      default: null,
    },
    api_token_issued_at: {
      type: 'timestamptz',
      notNull: false,
      default: null,
    },
  });

  pgm.createIndex('users', ['api_token_hash'], {
    name: 'users_api_token_hash_unique',
    unique: true,
    where: 'api_token_hash IS NOT NULL',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex('users', ['api_token_hash'], { name: 'users_api_token_hash_unique' });
  pgm.dropColumns('users', ['api_token_hash', 'api_token_issued_at']);
};
