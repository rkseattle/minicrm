/**
 * RLS context service — helpers for injecting the `app.current_user_id` PostgreSQL
 * session variable required by the Row-Level Security policies on core CRM tables.
 *
 * ## Why this exists
 *
 * PostgreSQL `SET LOCAL` persists only for the duration of a transaction. Service
 * functions that use `pool.query()` (auto-commit, no transaction) cannot rely on a
 * prior `SET LOCAL` — the variable resets after each statement. These functions must
 * wrap their queries in an explicit BEGIN/SET LOCAL/query/COMMIT to inject the user
 * context per query.
 *
 * Service functions that already use `pool.connect()` + `BEGIN` must call
 * `setRlsUserId(client)` immediately after `await client.query('BEGIN')`.
 *
 * The user ID is read from the `AsyncLocalStorage` request context populated by the
 * `authenticate` middleware. Outside a request (cron jobs, seeds, tests) the context is
 * null and `SET LOCAL app.current_user_id = ''` is used, which matches no rows under
 * the owner policy — admin policy is separate. Tests that need to read RLS-protected
 * tables must either use `runWithRequestContext` or connect as a superuser role.
 *
 * ## Usage in transactional service functions (pool.connect + BEGIN)
 *
 *   const client = await pool.connect();
 *   try {
 *     await client.query('BEGIN');
 *     await setRlsUserId(client);          // ← add this line after every BEGIN
 *     // ... rest of transaction
 *     await client.query('COMMIT');
 *   } catch (err) {
 *     await client.query('ROLLBACK');
 *     throw err;
 *   } finally {
 *     client.release();
 *   }
 *
 * ## Usage for standalone (non-transactional) queries on RLS-protected tables
 *
 *   const rows = await withRlsQuery(
 *     (client) => client.query<MyRow>('SELECT * FROM contacts WHERE id = $1', [id]),
 *   );
 */

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import pool from '../db.js';
import { getRequestContext } from '../utils/requestContext.js';

/**
 * Sets `app.current_user_id` for the current transaction on the given client.
 * Uses `SET LOCAL` so the value is scoped to the transaction (automatically cleared
 * on COMMIT or ROLLBACK).
 *
 * Call this immediately after every `await client.query('BEGIN')` in service functions
 * that touch RLS-protected tables (contacts, accounts, deals, leads, activities).
 *
 * When the request context is unauthenticated (cron jobs, system operations), sets
 * the value to an empty string. The `app_current_user_id()` DB function returns NULL
 * for empty strings, which matches no owner-policy rows. Admin-bypass queries (e.g.
 * admin list endpoints) rely on the admin policy, not the owner policy.
 */
export async function setRlsUserId(client: PoolClient): Promise<void> {
  const { userId } = getRequestContext();
  // set_config(key, value, is_local) is the parameterized equivalent of SET LOCAL.
  // is_local=true scopes the value to the current transaction (reset on COMMIT/ROLLBACK).
  await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId ?? '']);
}

/**
 * Executes a single query on an RLS-protected table within an isolated transaction,
 * with `app.current_user_id` set from the current request context.
 *
 * Intended for read-only `pool.query()` call sites that need RLS enforcement.
 * The transaction is always committed (not rolled back) since reads are idempotent.
 *
 * @param fn - Async function that receives a checked-out client and returns a QueryResult.
 * @returns The QueryResult returned by `fn`.
 */
export async function withRlsQuery<T extends QueryResultRow>(
  fn: (client: PoolClient) => Promise<QueryResult<T>>,
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
