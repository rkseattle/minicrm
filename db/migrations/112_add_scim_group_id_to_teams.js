/**
 * Migration 112 — Add scim_group_id to teams
 *
 * Adds a nullable scim_group_id TEXT UNIQUE column to the teams table so that
 * SCIM-provisioned teams can be looked up by their external IdP group ID.
 * SCIM-managed teams have this column set; manually-created teams leave it NULL.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumn({ schema: 'public', name: 'teams' }, {
    scim_group_id: {
      type: 'text',
      notNull: false,
      unique: true,
      default: null,
    },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumn({ schema: 'public', name: 'teams' }, 'scim_group_id');
};
