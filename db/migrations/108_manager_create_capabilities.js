/**
 * Migration 108 — Grant create capabilities to the manager built-in role (MINCRM-542)
 *
 * Migration 106 omitted contacts:create, deals:create, and activities:create for the
 * manager role. In practice managers need to create CRM records — they manage pipelines
 * and onboard new accounts alongside their teams. Without these capabilities, managers
 * cannot create contacts, deals, or activities at all, which breaks the expected
 * manager workflow.
 *
 * This migration adds the three missing create capabilities to the manager built-in role.
 * ON CONFLICT DO NOTHING makes the migration safe to run on databases where the
 * capability already exists (e.g. if added manually).
 */

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO public.role_capabilities (role_id, capability)
    SELECT r.id, c.capability
    FROM public.custom_roles r
    JOIN (VALUES
      ('contacts:create'),
      ('deals:create'),
      ('activities:create')
    ) AS c(capability) ON true
    WHERE r.name = 'manager' AND r.is_builtin = true
    ON CONFLICT (role_id, capability) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM public.role_capabilities rc
    USING public.custom_roles r
    WHERE rc.role_id = r.id
      AND r.name = 'manager'
      AND r.is_builtin = true
      AND rc.capability IN ('contacts:create', 'deals:create', 'activities:create')
  `);
};
