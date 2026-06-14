/**
 * Migration 110 — Seed sso_jit_default_role_id into system_settings (MINCRM-540)
 *
 * Phase 1 of MINCRM-540 adds the ability for admins to configure which custom
 * role is assigned to JIT-provisioned SSO users on first login. This migration
 * seeds the setting with the UUID of the built-in 'rep' role so that the
 * default behavior matches the hardcoded value that previously existed in code.
 *
 * system_settings is a KV store so no schema change is needed.
 */

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO public.system_settings (key, value, updated_at)
    SELECT 'sso_jit_default_role_id', r.id::text, now()
    FROM public.custom_roles r
    WHERE r.name = 'rep' AND r.is_builtin = true
    ON CONFLICT (key) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM public.system_settings
    WHERE key = 'sso_jit_default_role_id'
  `);
};
