/**
 * Migration 109 — Grant delete capabilities to rep and manager built-in roles
 *
 * Before the capability RBAC refactor (migration 106), reps could delete their own
 * contacts, deals, and activities — the delete routes used blockViewer() + an
 * ownership check (owner_id = req.user.id OR role = 'admin'). Migration 106 replaced
 * blockViewer() with requireCapability() but omitted contacts:delete, deals:delete,
 * and activities:delete from the rep and manager built-in roles, silently removing
 * the ability for reps and managers to delete their own records.
 *
 * This migration restores the pre-existing behavior by adding the three delete
 * capabilities to both the rep and manager built-in roles. Ownership enforcement
 * (only deleting own records) remains in the service layer via the WHERE clause.
 */

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO public.role_capabilities (role_id, capability)
    SELECT r.id, c.capability
    FROM public.custom_roles r
    JOIN (VALUES
      ('rep',     'contacts:delete'),
      ('rep',     'deals:delete'),
      ('rep',     'activities:delete'),
      ('manager', 'contacts:delete'),
      ('manager', 'deals:delete'),
      ('manager', 'activities:delete')
    ) AS c(role_name, capability) ON r.name = c.role_name
    WHERE r.is_builtin = true
    ON CONFLICT (role_id, capability) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM public.role_capabilities rc
    USING public.custom_roles r
    WHERE rc.role_id = r.id
      AND r.name IN ('rep', 'manager')
      AND r.is_builtin = true
      AND rc.capability IN ('contacts:delete', 'deals:delete', 'activities:delete')
  `);
};
