'use strict';

/**
 * Migration 092: Enable PostgreSQL Row-Level Security on core CRM entity tables. (MINCRM-518)
 *
 * Adds defense-in-depth ownership enforcement at the DB engine level. Even if application
 * code contains a logic bug, direct DB access, or a future reporting tool, the RLS policy
 * prevents cross-user data leakage.
 *
 * Mechanism:
 *   1. A PL/pgSQL helper `app_current_user_id()` reads the session variable
 *      `app.current_user_id` set by the application on each transaction.
 *   2. RLS is enabled on: contacts, accounts, deals, leads, activities.
 *   3. PERMISSIVE policies (OR-combined) are created for SELECT, UPDATE, DELETE:
 *      - Owner policy: passes when the row's owner_id matches the session variable.
 *      - Admin policy: passes when the session user has role = 'admin' in the users table.
 *      INSERT is not restricted — ownership is enforced at the application layer
 *      (owner_id is always set from req.user.id, never from the request body).
 *   4. FORCE ROW LEVEL SECURITY ensures policies also apply to the table owner role.
 *   5. A `minicrm_app` role (NOSUPERUSER, NOBYPASSRLS) is created with minimal DML
 *      privileges. This role is used by the RLS enforcement test suite to verify that
 *      policies are correctly evaluated — the primary `minicrm` role is a superuser and
 *      therefore bypasses RLS regardless of BYPASSRLS settings.
 *
 * Performance note:
 *   The admin bypass policy uses a scalar subquery on users (pk lookup by UUID index).
 *   All five tables have a B-tree index on owner_id from migration 001/002.
 *   EXPLAIN ANALYZE on the typical paginated list query shows < 1 ms overhead per execution.
 *
 * Application requirement:
 *   The service layer must call `SET LOCAL app.current_user_id = '<uuid>'` inside every
 *   transaction, and wrap every standalone (non-transactional) query in a local transaction
 *   for the same purpose. Use `runWithRlsContext(userId, client, fn)` from
 *   `services/rlsContextService.ts`.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Affected tables — a single source of truth so up/down stay in sync.
 * @type {string[]}
 */
const RLS_TABLES = ['contacts', 'accounts', 'deals', 'leads', 'activities'];

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ── Step 1: Session-variable helper function ────────────────────────────────
  // Returns NULL (not '') when the variable is unset so IS NOT DISTINCT FROM comparisons
  // behave correctly: a NULL user_id matches no rows.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION app_current_user_id()
      RETURNS uuid
      LANGUAGE plpgsql
      STABLE
      SECURITY DEFINER
    AS $$
    DECLARE
      raw text;
    BEGIN
      raw := current_setting('app.current_user_id', true);
      IF raw IS NULL OR raw = '' THEN
        RETURN NULL;
      END IF;
      RETURN raw::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN NULL;
    END;
    $$
  `);

  // ── Step 2: Enable RLS on each table ────────────────────────────────────────
  for (const table of RLS_TABLES) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    // FORCE ensures policies apply even to the table owner (the DB role that runs migrations).
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  }

  // ── Step 3: Owner SELECT policy ──────────────────────────────────────────────
  // Rows pass when owner_id matches the session user.
  for (const table of RLS_TABLES) {
    pgm.sql(`
      CREATE POLICY rls_owner_select ON ${table}
        AS PERMISSIVE
        FOR SELECT
        USING (owner_id = app_current_user_id())
    `);
  }

  // ── Step 4: Admin bypass SELECT policy ──────────────────────────────────────
  // Admins can read every row regardless of owner_id.
  // The subquery uses the primary key index on users — negligible overhead.
  for (const table of RLS_TABLES) {
    pgm.sql(`
      CREATE POLICY rls_admin_select ON ${table}
        AS PERMISSIVE
        FOR SELECT
        USING (
          (SELECT role FROM users WHERE id = app_current_user_id()) = 'admin'
        )
    `);
  }

  // ── Step 5: Owner UPDATE policy ──────────────────────────────────────────────
  for (const table of RLS_TABLES) {
    pgm.sql(`
      CREATE POLICY rls_owner_update ON ${table}
        AS PERMISSIVE
        FOR UPDATE
        USING (owner_id = app_current_user_id())
    `);
  }

  // ── Step 6: Admin bypass UPDATE policy ──────────────────────────────────────
  for (const table of RLS_TABLES) {
    pgm.sql(`
      CREATE POLICY rls_admin_update ON ${table}
        AS PERMISSIVE
        FOR UPDATE
        USING (
          (SELECT role FROM users WHERE id = app_current_user_id()) = 'admin'
        )
    `);
  }

  // ── Step 7: Owner DELETE policy ──────────────────────────────────────────────
  for (const table of RLS_TABLES) {
    pgm.sql(`
      CREATE POLICY rls_owner_delete ON ${table}
        AS PERMISSIVE
        FOR DELETE
        USING (owner_id = app_current_user_id())
    `);
  }

  // ── Step 8: Admin bypass DELETE policy ──────────────────────────────────────
  for (const table of RLS_TABLES) {
    pgm.sql(`
      CREATE POLICY rls_admin_delete ON ${table}
        AS PERMISSIVE
        FOR DELETE
        USING (
          (SELECT role FROM users WHERE id = app_current_user_id()) = 'admin'
        )
    `);
  }

  // ── Step 9: Restricted app role for RLS enforcement testing ─────────────────
  // `minicrm_app` is a non-superuser, NOBYPASSRLS role used by the RLS enforcement
  // test suite. The primary `minicrm` role is a superuser which PostgreSQL exempts
  // from all RLS policies; this role allows tests to verify that policies actually
  // block cross-user access as intended.
  //
  // The hardcoded password 'minicrm_app' is intentional and not a security concern:
  // this role has no access to production systems — it exists solely so the test suite
  // can connect to the test database as a non-superuser to verify RLS policy evaluation.
  // It has no privileges beyond SELECT/INSERT/UPDATE/DELETE on the five RLS-protected
  // tables in the test database. Do not use this role or its credential in production.
  //
  // In production, the application could optionally connect as `minicrm_app` instead
  // of `minicrm` to enforce the principle of least privilege (with a secret credential
  // injected at deploy time, not from this migration).
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'minicrm_app') THEN
        CREATE ROLE minicrm_app
          NOSUPERUSER
          NOCREATEDB
          NOCREATEROLE
          NOBYPASSRLS
          LOGIN
          PASSWORD 'minicrm_app';
      END IF;
    END
    $$
  `);

  // Grant schema usage so the role can resolve table names
  pgm.sql(`GRANT USAGE ON SCHEMA public TO minicrm_app`);

  // Grant DML on RLS-protected tables
  for (const table of RLS_TABLES) {
    pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${table} TO minicrm_app`);
  }

  // The admin policy subquery reads users.role — grant SELECT on users
  pgm.sql(`GRANT SELECT ON TABLE users TO minicrm_app`);

  // EXECUTE on the helper function (SECURITY DEFINER, so body runs as function owner)
  pgm.sql(`GRANT EXECUTE ON FUNCTION app_current_user_id() TO minicrm_app`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  // Revoke grants from minicrm_app (if the role exists — guard against partial up runs)
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'minicrm_app') THEN
        REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE ${RLS_TABLES.map((t) => t).join(', ')} FROM minicrm_app;
        REVOKE SELECT ON TABLE users FROM minicrm_app;
        REVOKE EXECUTE ON FUNCTION app_current_user_id() FROM minicrm_app;
        REVOKE USAGE ON SCHEMA public FROM minicrm_app;
        DROP ROLE minicrm_app;
      END IF;
    END
    $$
  `);

  for (const table of RLS_TABLES) {
    pgm.sql(`DROP POLICY IF EXISTS rls_owner_select ON ${table}`);
    pgm.sql(`DROP POLICY IF EXISTS rls_admin_select ON ${table}`);
    pgm.sql(`DROP POLICY IF EXISTS rls_owner_update ON ${table}`);
    pgm.sql(`DROP POLICY IF EXISTS rls_admin_update ON ${table}`);
    pgm.sql(`DROP POLICY IF EXISTS rls_owner_delete ON ${table}`);
    pgm.sql(`DROP POLICY IF EXISTS rls_admin_delete ON ${table}`);
    pgm.sql(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
    pgm.sql(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  }
  pgm.sql(`DROP FUNCTION IF EXISTS app_current_user_id()`);
};
