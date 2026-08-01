/**
 * Shared test utilities for controller integration tests.
 */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';
import pool from '../db.js';

/** Returns an 8-character random hex string for use in test email addresses. */
export const uid = () => randomUUID().slice(0, 8);

/**
 * Signs a JWT with the test secret and returns a cookie string
 * that can be passed via supertest's `.set('Cookie', ...)`.
 *
 * @param payload - The user fields to embed in the token.
 */
export function makeAuthCookie(payload: {
  id: string;
  email: string;
  name: string;
  role: string;
}): string {
  const token = jwt.sign(payload, process.env.JWT_SECRET ?? '', { expiresIn: '1h' });
  return `${AUTH_COOKIE_NAME}=${token}`;
}

/**
 * Polls `check` until it resolves truthy, or throws once `timeoutMs` elapses.
 *
 * Prefer this over a fixed `setTimeout` + single assertion when testing
 * time-based behavior (cache TTLs, scheduled state changes): a fixed sleep
 * races the real clock and produces a coin-flip failure whenever the process
 * is under any scheduling pressure, since a single sample right at the
 * boundary can land on either side. Polling instead asserts "this becomes
 * true within a generous bound," which is deterministic — it passes as soon
 * as the condition is genuinely met and only fails if it never is.
 *
 * @param check - Predicate to poll; called repeatedly until it returns true.
 * @param timeoutMs - Maximum time to wait before throwing.
 * @param intervalMs - Delay between poll attempts.
 */
export async function waitUntil(
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) {
      throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Deletes audit_log rows scoped to `actorId`, bypassing the append-only
 * trigger (audit_log_no_modify, migration 000_baseline.js — BEFORE DELETE
 * OR UPDATE only, never SELECT). Every audit-log integration test suite
 * needs this same cleanup; it used to be duplicated per-file as three
 * unwrapped pool.query() calls (DISABLE TRIGGER / DELETE / ENABLE TRIGGER).
 *
 * ALTER TABLE ... DISABLE/ENABLE TRIGGER is catalog-level, not
 * session-scoped — it is visible to every concurrent connection, not just
 * the one that issued it (verified directly: a second, independent session
 * can INSERT past a trigger a first session disabled, before the first
 * re-enables it). Wrapping all three statements in one transaction on a
 * single client is the actual fix, not a workaround for that: ALTER TABLE
 * DISABLE/ENABLE TRIGGER takes an ACCESS EXCLUSIVE lock on the table,
 * released only at COMMIT (verified directly: a second session's own
 * ALTER TABLE against the same table blocks until the first's transaction
 * commits). That lock serializes any other caller of this same
 * disable/delete/enable sequence — including a different test FILE's own
 * concurrently-running beforeEach, since Vitest runs test files in
 * parallel against the shared test database — behind this one, closing
 * the race that otherwise lets one invocation's ENABLE TRIGGER fire before
 * another's DELETE completes and trips "audit_log is append-only" on an
 * unrelated test (found via a real cross-file-parallel test run failure).
 */
export async function clearAuditLogFor(actorId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_modify');
    await client.query('DELETE FROM audit_log WHERE changed_by_id = $1', [actorId]);
    await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_modify');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Counts audit_log rows for one record type/name, scoped to a single actor.
 *
 * Singleton-config writes (`ai_settings`, `system_settings`) leave `record_id`
 * NULL, so `record_type` + `record_name` are the only other dimensions — and
 * both are shared with the controller test file covering the same feature. A
 * `created_at` window narrows that race but cannot close it, especially since
 * controllers write via `writeAuditEntryBestEffort` (void, unawaited), so a row
 * can land after its own test finished. `changed_by_id` is the one dimension a
 * concurrently running file cannot collide on, provided each file passes its
 * own actor. It is indexed (`audit_log_changed_by_id_index`, created in
 * `000_baseline.js` for fresh databases and re-established by migration 093's
 * partitioning). (MINCRM-693)
 *
 * `queryable` is a `pool` or a checked-out client — pass a client to count rows
 * inside an uncommitted transaction, which no other connection can see.
 */
export async function countAuditRowsFor(
  queryable: { query: typeof pool.query },
  filter: { recordType: string; recordName: string; actorId: string },
): Promise<number> {
  const result = await queryable.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_log
     WHERE record_type = $1 AND record_name = $2 AND changed_by_id = $3`,
    [filter.recordType, filter.recordName, filter.actorId],
  );
  return Number(result.rows[0].count);
}

/**
 * Asserts that an actor-scoped audit count ignores a row written under a
 * different actor with the same record_type + record_name — i.e. that the actor
 * dimension, not the record name, is what isolates the assertion. (MINCRM-693)
 *
 * Runs inside a transaction that is always rolled back, on a dedicated client:
 * audit_log's append-only trigger fires BEFORE DELETE OR UPDATE so an inserted
 * row cannot be removed afterwards, and an uncommitted row is invisible to every
 * other connection — which is why both counts must run on this same client.
 * Deliberately avoids the DISABLE/ENABLE TRIGGER sequence clearAuditLogFor uses,
 * since that takes a catalog-level ACCESS EXCLUSIVE lock on the whole table.
 *
 * `expect` is injected rather than imported so this stays a plain helper.
 */
export async function expectActorScopingIsolatesForeignRows(
  filter: { recordType: string; recordName: string; actorId: string; fieldName: string },
  foreignActorId: string,
  assert: (actual: number) => { toBe: (expected: number) => void },
): Promise<void> {
  const client = await pool.connect();

  const countUnscoped = async (): Promise<number> => {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_log
       WHERE record_type = $1 AND record_name = $2`,
      [filter.recordType, filter.recordName],
    );
    return Number(result.rows[0].count);
  };

  try {
    await client.query('BEGIN');
    // Two independent baselines. The unscoped one counts every accumulated row
    // under this record_type/record_name from every actor and every prior test,
    // so the two are not comparable to each other — only each against itself.
    const scopedBefore = await countAuditRowsFor(client, filter);
    const unscopedBefore = await countUnscoped();

    await client.query(
      `INSERT INTO audit_log (record_type, record_name, event_type, field_name, changed_by_id, changed_by_name)
       VALUES ($1, $2, 'updated', $3, $4, 'Some Other Test File')`,
      [filter.recordType, filter.recordName, filter.fieldName, foreignActorId],
    );

    // Unscoped by actor, the interloper IS counted — which is exactly why a
    // record_name + time-window assertion raced.
    assert(await countUnscoped()).toBe(unscopedBefore + 1);

    // Scoped by actor, it is not.
    assert(await countAuditRowsFor(client, filter)).toBe(scopedBefore);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
