/**
 * Migration 113 — Add scim_external_id to users (MINCRM-541)
 *
 * Adds a nullable scim_external_id TEXT UNIQUE column to users so that the
 * SCIM /Users endpoint can scope its list to SCIM-provisioned users only,
 * preventing the bearer token from exposing the full internal user directory.
 *
 * SCIM-provisioned users have this column set to the IdP-supplied externalId
 * (typically the IdP's stable user UUID). Manually-created and SSO-JIT-
 * provisioned users leave it NULL and are not visible through the SCIM API.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumn({ schema: 'public', name: 'users' }, {
    scim_external_id: {
      type: 'text',
      notNull: false,
      unique: true,
      default: null,
    },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumn({ schema: 'public', name: 'users' }, 'scim_external_id');
};
