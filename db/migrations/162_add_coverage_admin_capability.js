'use strict';

/**
 * Migration 162 — Add coverage:admin capability (MINCRM-637)
 *
 * Inserts the coverage:admin capability into role_capabilities for the
 * built-in admin role only, following migration 114's (bulk:operations)
 * exact pattern — a static VALUES list joined against custom_roles.name,
 * not a dynamic query against current user_custom_roles assignments (that
 * approach was considered and rejected: the insert set it would compute is
 * not recoverable for `down`, since assignments can change between `up`
 * and any later `down`).
 *
 * This grants coverage:admin identical access to today's
 * requireRole('admin') check for any user resolved via
 * userCapabilities()'s built-in-role fallback path. It does NOT cover an
 * admin user holding an explicit custom-role assignment with no
 * coverage:admin grant of its own — that gap is why the route-layer swap
 * (server/src/middleware/coverageAccessGate.ts) stays behind
 * COVERAGE_CAPABILITY_GATING until production role-assignment data is
 * checked in a follow-up ticket, rather than assumed complete here.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO public.role_capabilities (role_id, capability)
    SELECT r.id, c.capability
    FROM public.custom_roles r
    JOIN (VALUES
      ('admin', 'coverage:admin')
    ) AS c(role_name, capability) ON r.name = c.role_name
    ON CONFLICT (role_id, capability) DO NOTHING
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM public.role_capabilities
    WHERE capability = 'coverage:admin'
  `);
};
