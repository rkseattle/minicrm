/**
 * Migration 103 — Create teams and team_memberships tables (MINCRM-537)
 *
 * teams: hierarchical unit for data scoping, manager visibility, lead routing,
 * and IdP group mapping. parent_team_id enables arbitrary nesting depth; circular
 * references are prevented at the application layer (teamService.ts).
 *
 * team_memberships: join table recording which users belong to which teams and in
 * what capacity (lead = sub-team leader, member = regular participant). A user may
 * belong to multiple teams simultaneously.
 *
 * The updated_at trigger on teams uses the shared set_updated_at() function
 * introduced in the baseline.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE public.teams (
      id             uuid DEFAULT gen_random_uuid() NOT NULL,
      name           text NOT NULL,
      manager_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
      parent_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
      created_at     timestamp with time zone DEFAULT now() NOT NULL,
      updated_at     timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT teams_pkey PRIMARY KEY (id),
      CONSTRAINT teams_name_key UNIQUE (name)
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX teams_name_lower_idx
      ON public.teams (lower(name))
  `);

  pgm.sql(`
    CREATE TRIGGER set_teams_updated_at
      BEFORE UPDATE ON public.teams
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
  `);

  pgm.sql(`
    CREATE TABLE public.team_memberships (
      team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      role    text NOT NULL,
      CONSTRAINT team_memberships_pkey PRIMARY KEY (team_id, user_id),
      CONSTRAINT team_memberships_role_check CHECK (role IN ('lead', 'member'))
    )
  `);

  pgm.sql(`
    CREATE INDEX team_memberships_user_id_idx ON public.team_memberships (user_id)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.team_memberships`);
  pgm.sql(`DROP TABLE IF EXISTS public.teams`);
};
