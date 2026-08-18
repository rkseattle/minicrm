/**
 * Migration 150 — Add 'account' to org_visibility_settings
 *
 * Corrective migration on top of 105_create_org_visibility_settings: widens the
 * object_type CHECK constraint to also allow 'account', and seeds a default
 * 'org' row so existing deployments retain their current (unrestricted) account
 * visibility until an admin changes the policy.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.org_visibility_settings
      DROP CONSTRAINT org_visibility_settings_object_type_check
  `);

  pgm.sql(`
    ALTER TABLE public.org_visibility_settings
      ADD CONSTRAINT org_visibility_settings_object_type_check
      CHECK (object_type IN ('contact', 'deal', 'activity', 'account'))
  `);

  pgm.sql(`
    INSERT INTO public.org_visibility_settings (object_type, policy)
    VALUES ('account', 'org')
    ON CONFLICT (object_type) DO NOTHING
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM public.org_visibility_settings WHERE object_type = 'account'`);

  pgm.sql(`
    ALTER TABLE public.org_visibility_settings
      DROP CONSTRAINT org_visibility_settings_object_type_check
  `);

  pgm.sql(`
    ALTER TABLE public.org_visibility_settings
      ADD CONSTRAINT org_visibility_settings_object_type_check
      CHECK (object_type IN ('contact', 'deal', 'activity'))
  `);
};
