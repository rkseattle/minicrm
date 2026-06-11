/**
 * Migration 105 — Create org_visibility_settings table (MINCRM-538)
 *
 * Stores per-object-type data visibility policies that the service layer
 * enforces at query time. One row per object type; policies are:
 *   org     — all users see all records (default; preserves current behaviour)
 *   team    — users see only records owned by members of their team(s)
 *   private — users see only their own records
 *
 * Seeded with 'org' for all three object types so existing deployments retain
 * their current visibility (no behaviour change until an admin changes a policy).
 *
 * manager, viewer, and admin roles are not constrained by these policies —
 * see visibilityService.ts for the authoritative role-override logic.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.org_visibility_settings (
      object_type  text        NOT NULL,
      policy       text        NOT NULL DEFAULT 'org',
      updated_at   timestamptz NOT NULL DEFAULT now(),
      updated_by   uuid        REFERENCES public.users(id) ON DELETE SET NULL,
      CONSTRAINT org_visibility_settings_pkey PRIMARY KEY (object_type),
      CONSTRAINT org_visibility_settings_policy_check
        CHECK (policy IN ('private', 'team', 'org')),
      CONSTRAINT org_visibility_settings_object_type_check
        CHECK (object_type IN ('contact', 'deal', 'activity'))
    )
  `);

  // Seed defaults — preserves current org-wide visibility for all object types.
  // ON CONFLICT is a no-op so this is safe to re-run on existing databases.
  pgm.sql(`
    INSERT INTO public.org_visibility_settings (object_type, policy)
    VALUES ('contact', 'org'), ('deal', 'org'), ('activity', 'org')
    ON CONFLICT (object_type) DO NOTHING
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.org_visibility_settings`);
};
