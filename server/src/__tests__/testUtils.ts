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
