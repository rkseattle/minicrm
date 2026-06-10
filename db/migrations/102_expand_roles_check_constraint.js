/**
 * Migration 102 — Expand users.role CHECK constraint (MINCRM-533)
 *
 * Adds manager, viewer, and service_account to the allowed role values.
 * Widens the column from varchar(10) to varchar(20) to accommodate the
 * longest new value ('service_account' = 15 chars).
 *
 * The RLS policies on accounts/activities/contacts/deals/leads reference
 * users.role via a subquery, which records a type dependency in the PostgreSQL
 * catalog. PostgreSQL will reject ALTER COLUMN TYPE while those policies exist,
 * so we drop them before the ALTER and recreate them after.
 *
 * down() narrows the column back and restores the two-value constraint.
 * Safe only when no rows with new role values exist at rollback time.
 */

const RLS_TABLES = ['accounts', 'activities', 'contacts', 'deals', 'leads'];

const ADMIN_POLICY_USING =
  "(((( SELECT users.role FROM public.users WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text))";

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Drop the admin RLS policies that have a type dependency on users.role
  for (const table of RLS_TABLES) {
    pgm.sql(`DROP POLICY IF EXISTS rls_admin_select ON public.${table}`);
    pgm.sql(`DROP POLICY IF EXISTS rls_admin_update ON public.${table}`);
    pgm.sql(`DROP POLICY IF EXISTS rls_admin_delete ON public.${table}`);
  }

  pgm.sql(`
    ALTER TABLE users
      DROP CONSTRAINT users_role_check,
      ALTER COLUMN role TYPE varchar(20),
      ADD CONSTRAINT users_role_check
        CHECK (role IN ('admin', 'rep', 'manager', 'viewer', 'service_account'))
  `);

  // Recreate the admin RLS policies with the same definitions
  for (const table of RLS_TABLES) {
    pgm.sql(`CREATE POLICY rls_admin_select ON public.${table} FOR SELECT USING (${ADMIN_POLICY_USING})`);
    pgm.sql(`CREATE POLICY rls_admin_update ON public.${table} FOR UPDATE USING (${ADMIN_POLICY_USING})`);
    pgm.sql(`CREATE POLICY rls_admin_delete ON public.${table} FOR DELETE USING (${ADMIN_POLICY_USING})`);
  }
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  for (const table of RLS_TABLES) {
    pgm.sql(`DROP POLICY IF EXISTS rls_admin_select ON public.${table}`);
    pgm.sql(`DROP POLICY IF EXISTS rls_admin_update ON public.${table}`);
    pgm.sql(`DROP POLICY IF EXISTS rls_admin_delete ON public.${table}`);
  }

  pgm.sql(`
    ALTER TABLE users
      DROP CONSTRAINT users_role_check,
      ALTER COLUMN role TYPE varchar(10),
      ADD CONSTRAINT users_role_check
        CHECK (role IN ('admin', 'rep'))
  `);

  for (const table of RLS_TABLES) {
    pgm.sql(`CREATE POLICY rls_admin_select ON public.${table} FOR SELECT USING (${ADMIN_POLICY_USING})`);
    pgm.sql(`CREATE POLICY rls_admin_update ON public.${table} FOR UPDATE USING (${ADMIN_POLICY_USING})`);
    pgm.sql(`CREATE POLICY rls_admin_delete ON public.${table} FOR DELETE USING (${ADMIN_POLICY_USING})`);
  }
};
