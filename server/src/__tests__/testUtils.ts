/**
 * Shared test utilities for controller integration tests.
 */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { UserRole, UserStatus } from '@minicrm/shared/schemas/userSchema.js';
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
 * Default backdate applied to a fixture user's `created_at`. See ensureUser. (MINCRM-704)
 *
 * Callers that must win `getAdminUserId()`'s `ORDER BY created_at LIMIT 1` against another
 * backdated fixture pass an explicit, larger value instead — a shared constant is not
 * enough, because `now()` advances between statements and the FIRST row inserted would
 * otherwise win regardless of which spec is running.
 *
 * Expressed in SECONDS, not `'100 years'`, so it is directly comparable with
 * claimAdminResolution's COALESCE fallback below. Postgres resolves `'100 years'` to
 * 36525 days (leap-aware) while 3153600000 seconds is 100x365 days — a 25-day gap in
 * which a default-backdated fixture silently out-sorts a claim made against an empty
 * table. Same unit on both sides removes the class. (MINCRM-704)
 */
export const FIXTURE_CREATED_AT_BACKDATE = '3153600000 seconds';

/** Shared tail of the remedies below. (MINCRM-704) */
const RESET_DATABASE_REMEDY =
  'Reset the database:\n' +
  '  docker exec minicrm-test-db psql -U minicrm -d postgres -c ' +
  '"DROP DATABASE minicrm_test" -c "CREATE DATABASE minicrm_test OWNER minicrm"\n' +
  '  (test stack is port 5433 — never 5432, which is the dev database)';

/**
 * Asserts that the admin `demoService.getAdminUserId()` will resolve is the one this spec
 * owns, and fails with an actionable message when it is not.
 *
 * `getAdminUserId()` runs `WHERE role = 'admin' AND status = 'active' ORDER BY created_at
 * LIMIT 1` — the oldest active admin in the whole shared database, not the calling spec's
 * fixture. Two distinct states break a demo spec, and both are invisible from the symptom:
 *
 * 1. **No active admin at all.** `seedDemo()`/`resetDemo()` throw from deep inside the
 *    service. Happens when a spec deletes users wholesale (`userService.test.ts` runs a
 *    bare `DELETE FROM users`) or a prior run was interrupted before its `afterAll`.
 * 2. **A foreign active admin sorts first.** Worse, because nothing throws: demo data is
 *    seeded under an owner the spec does not know about, its owner-scoped `afterAll`
 *    cleans a different id, and the orphaned rows then block a later `DELETE FROM users`
 *    behind the `ON DELETE RESTRICT` owner FKs — surfacing as an FK violation in whatever
 *    unrelated file deletes users next.
 *
 * Normally reached via `claimAdminResolution`, which upserts the fixture and then calls
 * this to confirm the claim held; specs should prefer that. Exported separately so a test
 * can assert the guard's own branches, and so a spec that manages its own fixture can
 * check the property without re-upserting. The assertion is deliberately not "an admin
 * exists" — an upsert has just guaranteed that — but "the admin that will actually be
 * resolved is mine".
 *
 * Deliberately a spec-level helper rather than a `globalSetup` check: globalSetup runs
 * once before any worker, so it cannot observe state a later file destroys — which is the
 * actual failure window — and it would fire on a legitimately empty fresh database.
 *
 * @param expectedAdminEmail - The calling spec's own admin fixture email.
 * @param queryable - A pool or a checked-out client. Pass a client to assert against
 *   uncommitted state inside a transaction — the only safe way for a test to establish a
 *   whole-table property like "no active admin" without other connections observing it.
 */
export async function assertResolvedAdminIs(
  expectedAdminEmail: string,
  queryable: { query: typeof pool.query } = pool,
): Promise<void> {
  const result = await queryable.query<{ email: string }>(
    `SELECT email FROM users
      WHERE role = 'admin' AND status = 'active'
      ORDER BY created_at LIMIT 1`,
  );
  const resolved = result.rows[0]?.email;
  const expected = expectedAdminEmail.toLowerCase().trim();

  if (!resolved) {
    throw new Error(
      'minicrm_test has no ACTIVE ADMIN, so seedDemo()/resetDemo() cannot resolve an ' +
        'owner and will throw from inside getAdminUserId().\n' +
        'This is leftover local state, not a code defect — CI provisions a fresh database ' +
        'and never hits it.\n' +
        'Cause: a spec deleted users wholesale (userService.test.ts runs a bare ' +
        '`DELETE FROM users`) or a prior run was interrupted before its afterAll.\n' +
        'Fix: call ensureUser() from beforeEach rather than creating the fixture once in ' +
        `beforeAll. ${RESET_DATABASE_REMEDY}`,
    );
  }

  if (resolved !== expected) {
    throw new Error(
      `minicrm_test holds an older active admin (${resolved}) than this spec's fixture ` +
        `(${expected}), so seedDemo() would seed demo data owned by it and this spec's ` +
        'owner-scoped cleanup would not remove those rows — which then blocks a later ' +
        '`DELETE FROM users` behind the ON DELETE RESTRICT owner FKs.\n' +
        'This should be unreachable: claimAdminResolution() backdates the caller past every ' +
        'other active admin. Reaching it means a row was inserted with an even older ' +
        'created_at.\n' +
        `Fix: ${RESET_DATABASE_REMEDY}`,
    );
  }
}

/**
 * Makes `expectedAdminEmail` the admin that `demoService.getAdminUserId()` resolves, by
 * backdating it strictly further than every other active admin currently in the table,
 * then asserts the outcome.
 *
 * Relative per-spec backdates are not sufficient on their own. Two demo specs each need to
 * be the resolved admin while they run, so a fixed ordering between them makes the loser
 * unrunnable whenever the winner's fixture survives an interrupted run — which is exactly
 * the state AC 2 requires the next run to recover from. Claiming resolution at fixture
 * time is self-healing instead: whichever spec runs next takes ownership, no matter what
 * the previous run left behind.
 *
 * Idempotent, and safe to call from `beforeEach`. Returns the fixture's id so callers do
 * not need a second query. (MINCRM-704)
 *
 * @param user - The caller's own admin fixture.
 * @returns The fixture row's id.
 */
export async function claimAdminResolution(user: {
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  status: UserStatus;
}): Promise<string> {
  const email = user.email.toLowerCase().trim();

  // One year older than the current oldest active admin that is not this fixture, so the
  // claim holds regardless of what a prior run left behind. COALESCE covers the empty case.
  const oldest = await pool.query<{ backdate: string }>(
    `SELECT COALESCE(
              EXTRACT(EPOCH FROM (now() - MIN(created_at)))::bigint + 31536000,
              -- Strictly older than FIXTURE_CREATED_AT_BACKDATE (3153600000s), so a claim
              -- made against an empty table still wins once default-backdated fixtures
              -- appear. Same unit on both sides. (MINCRM-704)
              6307200000
            )::text AS backdate
       FROM users
      WHERE role = 'admin' AND status = 'active' AND email <> $1`,
    [email],
  );

  const id = await ensureUser(user, `${oldest.rows[0].backdate} seconds`);
  await assertResolvedAdminIs(email);
  return id;
}

/**
 * Creates a user, or fully restores the existing row when one with this email is already
 * present, returning its id either way.
 *
 * Call this from `beforeEach` rather than creating fixture users once in `beforeAll`
 * when a spec's tests cannot run without the row. `minicrm_test` is shared across the
 * whole suite, and specs delete users wholesale — `userService.test.ts` runs a bare
 * `DELETE FROM users` to exercise `seedDefaultAdmin()` on an empty table. Serial
 * execution order is duration-derived, not fixed (vitest sorts failed-first, then
 * duration-descending), so no spec can rely on running before that wipe. An interrupted
 * run that skips `afterAll` leaves the same gap. (MINCRM-704)
 *
 * Uses `ON CONFLICT` rather than a read-then-create so the upsert is atomic.
 *
 * Three details are load-bearing:
 *
 * 1. **`created_at` is backdated**, by `createdAtBackdate` when given. A row re-inserted
 *    mid-run would otherwise carry `now()` and sort last under
 *    `demoService.getAdminUserId()`'s `ORDER BY created_at LIMIT 1`, letting a leftover
 *    foreign admin win. Note a shared backdate is NOT sufficient on its own: `now()`
 *    advances between statements, so among equally-backdated rows the first inserted wins.
 *    A spec that must be the resolved admin passes a distinct, larger interval and
 *    verifies the outcome with `assertResolvedAdminIs`.
 * 2. **Email and name are normalized** exactly as `userService.createUser` does. The
 *    `users_email_key` UNIQUE index is case-sensitive, so an un-normalized email that
 *    differs only by case from a `createUser`-written row raises a duplicate-key error
 *    instead of taking the upsert path.
 * 3. **Auth-gating columns are reset.** A row left with `must_change_password = true`, or
 *    with a `password_changed_at` later than a freshly-signed token's `iat`, makes
 *    `authenticate` reject — 403 PASSWORD_CHANGE_REQUIRED or 401 — which would turn a
 *    403-expecting RBAC assertion green for entirely the wrong reason. Both are cleared,
 *    along with the MFA and SSO columns, so a restored fixture is fully known-state.
 *
 * @param user - The fixture user to create or restore.
 * @param createdAtBackdate - Postgres interval to backdate `created_at` by. Defaults to
 *   FIXTURE_CREATED_AT_BACKDATE; pass a larger value to win the admin-resolution ordering.
 * @returns The row id, whether newly inserted or pre-existing.
 */
export async function ensureUser(
  user: {
    email: string;
    name: string;
    role: UserRole;
    passwordHash: string;
    status: UserStatus;
  },
  createdAtBackdate: string = FIXTURE_CREATED_AT_BACKDATE,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role, password_hash, status, created_at)
     VALUES ($1, $2, $3, $4, $5, now() - $6::interval)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
                                       status = EXCLUDED.status,
                                       password_hash = EXCLUDED.password_hash,
                                       created_at = EXCLUDED.created_at,
                                       must_change_password = false,
                                       password_changed_at = NULL,
                                       mfa_enabled = false,
                                       mfa_secret = NULL,
                                       sso_provider = NULL,
                                       sso_subject = NULL
     RETURNING id`,
    [
      user.email.toLowerCase().trim(),
      user.name.trim(),
      user.role,
      user.passwordHash,
      user.status,
      createdAtBackdate,
    ],
  );
  // Safe: INSERT ... ON CONFLICT DO UPDATE always returns exactly one row.
  return result.rows[0].id;
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
