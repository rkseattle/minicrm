'use strict';

/**
 * Migration 165: give ai_lead_routing_suggestion an explicit "rep": false.
 *
 * isFlagEnabledForRole consults role_overrides only when the role key is PRESENT and
 * otherwise falls through to the org-wide `enabled` column, so omitting a role grants it
 * rather than denying it. The map needs the key to exclude reps.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Only correct the untouched seed: the flag is admin-editable, and a tenant that has
  // already configured its own map should keep it.
  pgm.sql(`
    UPDATE feature_flags
    SET role_overrides = '{"admin":true,"manager":true,"rep":false}'::jsonb
    WHERE flag_key = 'ai_lead_routing_suggestion'
      AND role_overrides IS NOT DISTINCT FROM '{"admin":true,"manager":true}'::jsonb
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    UPDATE feature_flags
    SET role_overrides = '{"admin":true,"manager":true}'::jsonb
    WHERE flag_key = 'ai_lead_routing_suggestion'
      AND role_overrides IS NOT DISTINCT FROM '{"admin":true,"manager":true,"rep":false}'::jsonb
  `);
};
