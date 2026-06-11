/**
 * Migration 106 — Capability-based RBAC: custom_roles, role_capabilities,
 * user_custom_roles tables (MINCRM-542)
 *
 * Introduces a fully DB-backed capability model:
 *   custom_roles       — named role definitions (built-in and admin-created)
 *   role_capabilities  — capability strings assigned to each role
 *   user_custom_roles  — assignment of roles to users (additive, union-based)
 *
 * Built-in roles (admin, manager, rep, viewer, service_account) are seeded with
 * is_builtin = true and the full capability matrix from the MINCRM-542 spec.
 * Future capabilities are seeded now so custom roles can be pre-configured before
 * the enforcing routes ship.
 *
 * All existing users receive a user_custom_roles row matching their current
 * users.role value, so capability resolution is consistent from day one.
 *
 * The users.role column is retained as a denormalized cache for the JWT payload
 * and legacy role checks during the transition; it is kept in sync by application
 * logic and is NOT deprecated in this migration.
 *
 * DOWN: drops all three new tables; user_custom_roles rows are gone, but users.role
 * is unchanged so the system falls back to the pre-migration state.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ── Tables ──────────────────────────────────────────────────────────────────

  pgm.sql(`
    CREATE TABLE public.custom_roles (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      description TEXT,
      is_builtin  BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT custom_roles_name_key UNIQUE (name)
    )
  `);

  pgm.sql(`COMMENT ON TABLE public.custom_roles IS
    'Named role definitions for capability-based RBAC (MINCRM-542). '
    'Rows with is_builtin = true correspond to the five built-in roles '
    '(admin, manager, rep, viewer, service_account) and cannot be deleted or renamed '
    'via the REST API. Custom roles (is_builtin = false) are admin-configurable.'
  `);

  pgm.sql(`
    CREATE TABLE public.role_capabilities (
      role_id    UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
      capability TEXT NOT NULL,
      PRIMARY KEY (role_id, capability)
    )
  `);

  pgm.sql(`COMMENT ON TABLE public.role_capabilities IS
    'Capability strings granted to a role (MINCRM-542). '
    'The TypeScript Capability enum in shared/schemas/capabilitySchema.ts is the '
    'source of truth for valid capability strings — the DB stores assignments only. '
    'A capability absent from this table means the role does not have it.'
  `);

  pgm.sql(`
    CREATE TABLE public.user_custom_roles (
      user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    )
  `);

  pgm.sql(`COMMENT ON TABLE public.user_custom_roles IS
    'Assignment of custom roles to users (MINCRM-542). '
    'A user may hold multiple roles; effective capabilities are the union of all '
    'capabilities from all assigned roles. At least one built-in role row is '
    'inserted for every user by this migration; additional custom roles are additive.'
  `);

  pgm.sql(`CREATE INDEX user_custom_roles_user_id_idx ON public.user_custom_roles (user_id)`);
  pgm.sql(`CREATE INDEX user_custom_roles_role_id_idx ON public.user_custom_roles (role_id)`);
  pgm.sql(`CREATE INDEX role_capabilities_role_id_idx ON public.role_capabilities (role_id)`);

  // ── set_updated_at trigger for custom_roles ─────────────────────────────────
  pgm.sql(`
    DO $$ BEGIN
      CREATE TRIGGER custom_roles_set_updated_at
        BEFORE UPDATE ON public.custom_roles
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  // ── Seed built-in roles ─────────────────────────────────────────────────────
  // Inserted by name so the generated UUIDs are stable per-DB (not hard-coded).
  pgm.sql(`
    INSERT INTO public.custom_roles (name, description, is_builtin) VALUES
      ('admin',           'Full administrative access to all capabilities',             true),
      ('manager',         'Team management with broad record access',                   true),
      ('rep',             'Standard sales representative access',                       true),
      ('viewer',          'Read-only access across the organisation',                   true),
      ('service_account', 'Machine-to-machine API access via bearer token',             true)
    ON CONFLICT (name) DO NOTHING
  `);

  // ── Seed capability matrix ───────────────────────────────────────────────────
  // Each INSERT selects the role UUID by name — no hard-coded UUIDs.
  // Future capabilities (marked in the spec) are seeded so custom roles can be
  // pre-configured; no routes enforce them yet.
  pgm.sql(`
    INSERT INTO public.role_capabilities (role_id, capability)
    SELECT r.id, c.capability
    FROM public.custom_roles r
    JOIN (VALUES
      -- contacts
      ('admin',           'contacts:view'),
      ('admin',           'contacts:create'),
      ('admin',           'contacts:edit'),
      ('admin',           'contacts:delete'),
      ('admin',           'contacts:export'),
      ('manager',         'contacts:view'),
      ('manager',         'contacts:edit'),
      ('manager',         'contacts:export'),
      ('rep',             'contacts:view'),
      ('rep',             'contacts:create'),
      ('rep',             'contacts:edit'),
      ('viewer',          'contacts:view'),

      -- deals
      ('admin',           'deals:view'),
      ('admin',           'deals:create'),
      ('admin',           'deals:edit'),
      ('admin',           'deals:delete'),
      ('admin',           'deals:reassign'),
      ('manager',         'deals:view'),
      ('manager',         'deals:edit'),
      ('manager',         'deals:reassign'),
      ('rep',             'deals:view'),
      ('rep',             'deals:create'),
      ('rep',             'deals:edit'),
      ('viewer',          'deals:view'),

      -- activities
      ('admin',           'activities:view'),
      ('admin',           'activities:create'),
      ('admin',           'activities:edit'),
      ('admin',           'activities:delete'),
      ('manager',         'activities:view'),
      ('manager',         'activities:edit'),
      ('rep',             'activities:view'),
      ('rep',             'activities:create'),
      ('rep',             'activities:edit'),
      ('viewer',          'activities:view'),

      -- pipelines
      ('admin',           'pipelines:view'),
      ('admin',           'pipelines:manage'),
      ('manager',         'pipelines:view'),
      ('rep',             'pipelines:view'),
      ('viewer',          'pipelines:view'),

      -- sequences (future — no enforcing routes yet)
      ('admin',           'sequences:view'),
      ('admin',           'sequences:create'),
      ('admin',           'sequences:edit'),
      ('admin',           'sequences:delete'),
      ('admin',           'sequences:enroll'),
      ('manager',         'sequences:view'),
      ('manager',         'sequences:create'),
      ('manager',         'sequences:edit'),
      ('manager',         'sequences:enroll'),
      ('rep',             'sequences:view'),
      ('rep',             'sequences:enroll'),

      -- workflows / automation (future — no enforcing routes yet)
      ('admin',           'workflows:view'),
      ('admin',           'workflows:create'),
      ('admin',           'workflows:edit'),
      ('admin',           'workflows:delete'),
      ('admin',           'workflows:activate'),
      ('manager',         'workflows:view'),

      -- reports
      ('admin',           'reports:view'),
      ('admin',           'reports:create'),
      ('admin',           'reports:edit'),
      ('admin',           'reports:delete'),
      ('admin',           'reports:export'),
      ('admin',           'reports:schedule'),
      ('manager',         'reports:view'),
      ('manager',         'reports:create'),
      ('manager',         'reports:edit'),
      ('manager',         'reports:export'),
      ('manager',         'reports:schedule'),
      ('rep',             'reports:view'),
      ('viewer',          'reports:view'),

      -- dashboards (future — no enforcing routes yet)
      ('admin',           'dashboards:view'),
      ('admin',           'dashboards:manage'),
      ('manager',         'dashboards:view'),
      ('manager',         'dashboards:manage'),
      ('rep',             'dashboards:view'),
      ('viewer',          'dashboards:view'),

      -- forecasting (future — no enforcing routes yet)
      ('admin',           'forecasting:view'),
      ('admin',           'forecasting:edit'),
      ('manager',         'forecasting:view'),
      ('manager',         'forecasting:edit'),
      ('rep',             'forecasting:view'),
      ('viewer',          'forecasting:view'),

      -- bulk data
      ('admin',           'data:import'),
      ('admin',           'data:export'),
      ('manager',         'data:export'),

      -- admin / user management
      ('admin',           'users:view'),
      ('admin',           'users:create'),
      ('admin',           'users:edit'),
      ('admin',           'users:delete'),
      ('admin',           'teams:manage'),
      ('admin',           'integrations:manage'),
      ('admin',           'settings:manage'),
      ('admin',           'feature_flags:manage'),

      -- audit log (future — no enforcing routes yet)
      ('admin',           'audit_log:view'),

      -- billing (future — no built-in role has these; reserved for super_admin)
      -- (intentionally no rows — billing:* assigned when super_admin role lands)

      -- api access (service_account only)
      ('service_account', 'api:access')
    ) AS c(role_name, capability) ON r.name = c.role_name
    ON CONFLICT (role_id, capability) DO NOTHING
  `);

  // ── Backfill user_custom_roles from users.role ───────────────────────────────
  // Every existing user gets a single built-in role row matching their current role.
  pgm.sql(`
    INSERT INTO public.user_custom_roles (user_id, role_id)
    SELECT u.id, r.id
    FROM public.users u
    JOIN public.custom_roles r ON r.name = u.role AND r.is_builtin = true
    ON CONFLICT (user_id, role_id) DO NOTHING
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.user_custom_roles`);
  pgm.sql(`DROP TABLE IF EXISTS public.role_capabilities`);
  pgm.sql(`DROP TABLE IF EXISTS public.custom_roles`);
};
