'use strict';

/**
 * Migration 059: Add SSO identity columns to users table. (MINCRM-399)
 *
 * sso_provider identifies which IdP protocol bound this user ('saml' | 'oidc').
 * sso_subject is the IdP-issued stable identifier (SAML nameID or OIDC sub claim).
 *
 * A partial unique index on (sso_provider, sso_subject) enforces that each external
 * identity is bound to exactly one MiniCRM account — standard JIT-provisioning invariant.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('users', {
    sso_provider: {
      type: 'varchar(20)',
      notNull: false,
      default: null,
      comment: 'SSO protocol that provisioned this user: saml | oidc',
    },
    sso_subject: {
      type: 'text',
      notNull: false,
      default: null,
      comment: 'Stable external identity: SAML nameID or OIDC sub claim',
    },
  });

  // Enforce one-IdP-to-one-user binding. WHERE clause excludes unbound users.
  pgm.createIndex('users', ['sso_provider', 'sso_subject'], {
    unique: true,
    name: 'users_sso_provider_sso_subject_unique',
    where: 'sso_subject IS NOT NULL',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('users', ['sso_provider', 'sso_subject'], {
    name: 'users_sso_provider_sso_subject_unique',
  });
  pgm.dropColumns('users', ['sso_provider', 'sso_subject']);
};
