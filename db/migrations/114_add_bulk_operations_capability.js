/**
 * Migration 114 — Add bulk:operations capability (MINCRM-562)
 *
 * Inserts the bulk:operations capability into role_capabilities for the admin
 * and manager built-in roles. This capability gates all bulk selection UI and
 * bulk API endpoints. rep, viewer, and service_account do not receive it by
 * default — admins may grant it to custom roles.
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
      ('admin',   'bulk:operations'),
      ('manager', 'bulk:operations')
    ) AS c(role_name, capability) ON r.name = c.role_name
    ON CONFLICT (role_id, capability) DO NOTHING
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM public.role_capabilities
    WHERE capability = 'bulk:operations'
  `);
};
