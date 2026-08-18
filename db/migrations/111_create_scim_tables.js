/**
 * Migration 111 — Create SCIM provisioning tables
 *
 * Adds two tables to support SCIM 2.0 provisioning:
 *
 *   scim_tokens — Stores the SHA-256 hash of the long-lived bearer token used to
 *     authenticate inbound SCIM requests. Only one token is active at a time.
 *     Rotation atomically replaces the existing row. The raw token is never stored.
 *
 *   scim_group_role_mappings — Maps an external IdP group (identified by its SCIM
 *     group ID) to a MiniCRM custom role. When a SCIM group membership event arrives,
 *     the mapping table determines which role to assign the user.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable({ schema: 'public', name: 'scim_tokens' }, {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    token_hash: {
      type: 'text',
      notNull: true,
      unique: true,
    },
    created_by: {
      type: 'uuid',
      notNull: false,
      references: 'public.users(id)',
      onDelete: 'SET NULL',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    last_used_at: {
      type: 'timestamptz',
      notNull: false,
      default: null,
    },
  });

  pgm.createTable({ schema: 'public', name: 'scim_group_role_mappings' }, {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    scim_group_id: {
      type: 'text',
      notNull: true,
      unique: true,
    },
    group_name: {
      type: 'text',
      notNull: true,
    },
    role_id: {
      type: 'uuid',
      notNull: true,
      references: 'public.custom_roles(id)',
      onDelete: 'RESTRICT',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable({ schema: 'public', name: 'scim_group_role_mappings' });
  pgm.dropTable({ schema: 'public', name: 'scim_tokens' });
};
