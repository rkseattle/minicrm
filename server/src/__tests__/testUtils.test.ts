/**
 * Unit tests for the shared fixture helpers in testUtils.ts.
 *
 * These pin the MINCRM-704 fix: demo specs depend on a fixture admin that a sibling
 * spec's bare `DELETE FROM users` (userService.test.ts) or an interrupted run can remove,
 * and on that fixture being the one `demoService.getAdminUserId()` actually resolves.
 * Both properties are invisible from the symptom when they break, so they are asserted
 * here rather than left to the demo specs to discover.
 *
 * Runs against the minicrm_test database.
 */

import 'dotenv/config';
import pool from '../db.js';
import { assertResolvedAdminIs, claimAdminResolution, ensureUser } from './testUtils.js';

const FILE_PREFIX = 'testutils-svc';

const ADMIN_USER = {
  email: `${FILE_PREFIX}-admin@example.com`,
  name: 'TestUtils Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Larger than any other fixture's backdate in this file, so this admin resolves first. */
const OLDEST_BACKDATE = '500 years';
/** Smaller, for the row that must lose the ORDER BY created_at race. */
const NEWER_BACKDATE = '1 year';

async function deleteFixtureUsers(): Promise<void> {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
}

beforeEach(async () => {
  await deleteFixtureUsers();
});

afterAll(async () => {
  await deleteFixtureUsers();
});

describe('ensureUser', () => {
  it('creates the user when absent and returns its id', async () => {
    const id = await ensureUser(ADMIN_USER);

    const row = await pool.query<{ id: string; email: string; role: string; status: string }>(
      'SELECT id, email, role, status FROM users WHERE email = $1',
      [ADMIN_USER.email],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].id).toBe(id);
    expect(row.rows[0].role).toBe('admin');
    expect(row.rows[0].status).toBe('active');
  });

  it('returns the SAME id when called repeatedly — the upsert is idempotent', async () => {
    const first = await ensureUser(ADMIN_USER);
    const second = await ensureUser(ADMIN_USER);
    const third = await ensureUser(ADMIN_USER);

    expect(second).toBe(first);
    expect(third).toBe(first);

    const count = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM users WHERE email = $1',
      [ADMIN_USER.email],
    );
    expect(count.rows[0].count).toBe('1');
  });

  it('recreates the user after a wholesale DELETE FROM users, as a sibling spec does', async () => {
    const before = await ensureUser(ADMIN_USER);
    await deleteFixtureUsers();

    const after = await ensureUser(ADMIN_USER);

    // A new row, so any id captured once in beforeAll would now be stale — which is why
    // the demo specs re-capture it in beforeEach rather than holding the beforeAll value.
    expect(after).not.toBe(before);
    const row = await pool.query('SELECT id FROM users WHERE email = $1', [ADMIN_USER.email]);
    expect(row.rows).toHaveLength(1);
  });

  it('restores role and status when a prior run left the row deactivated', async () => {
    await ensureUser(ADMIN_USER);
    await pool.query(`UPDATE users SET status = 'inactive', role = 'rep' WHERE email = $1`, [
      ADMIN_USER.email,
    ]);

    await ensureUser(ADMIN_USER);

    const row = await pool.query<{ role: string; status: string }>(
      'SELECT role, status FROM users WHERE email = $1',
      [ADMIN_USER.email],
    );
    expect(row.rows[0].role).toBe('admin');
    expect(row.rows[0].status).toBe('active');
  });

  it('clears must_change_password, which would otherwise 403 every authenticated request', async () => {
    await ensureUser(ADMIN_USER);
    await pool.query('UPDATE users SET must_change_password = true WHERE email = $1', [
      ADMIN_USER.email,
    ]);

    await ensureUser(ADMIN_USER);

    const row = await pool.query<{ must_change_password: boolean }>(
      'SELECT must_change_password FROM users WHERE email = $1',
      [ADMIN_USER.email],
    );
    // A leftover true here makes authenticate return 403 PASSWORD_CHANGE_REQUIRED, which
    // would turn a 403-expecting RBAC assertion green for the wrong reason.
    expect(row.rows[0].must_change_password).toBe(false);
  });

  it('normalizes email case so the upsert matches the case-sensitive unique index', async () => {
    const id = await ensureUser(ADMIN_USER);
    const upper = await ensureUser({ ...ADMIN_USER, email: ADMIN_USER.email.toUpperCase() });

    expect(upper).toBe(id);
  });

  it('backdates created_at so a re-inserted fixture does not sort last', async () => {
    await ensureUser(ADMIN_USER, OLDEST_BACKDATE);

    const row = await pool.query<{ age_years: number }>(
      `SELECT EXTRACT(YEAR FROM age(now(), created_at))::int AS age_years
         FROM users WHERE email = $1`,
      [ADMIN_USER.email],
    );
    expect(row.rows[0].age_years).toBeGreaterThan(100);
  });
});

describe('assertResolvedAdminIs', () => {
  it('passes when this fixture is the oldest active admin', async () => {
    await ensureUser(ADMIN_USER, OLDEST_BACKDATE);

    await expect(assertResolvedAdminIs(ADMIN_USER.email)).resolves.toBeUndefined();
  });

  it('throws, naming the condition, when no active admin exists at all', async () => {
    // A non-admin present but zero admins — the state the ticket reproduces.
    //
    // Deliberately deactivates EVERY active admin rather than only this file's fixtures.
    // The guard reads a global property (the oldest active admin across the whole table),
    // and the parallel project runs concurrently with this serial file — so a foreign
    // admin resident at this instant would send the guard down its "older active admin"
    // branch instead, making the assertion pass or fail on timing. Restored per-id in a
    // finally so no sibling spec observes the deactivation. (MINCRM-704)
    const activeAdmins = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'admin' AND status = 'active'`,
    );
    const deactivatedIds = activeAdmins.rows.map((row) => row.id);
    await pool.query(`UPDATE users SET status = 'inactive' WHERE id = ANY($1::uuid[])`, [
      deactivatedIds,
    ]);

    try {
      await ensureUser({ ...ADMIN_USER, email: `${FILE_PREFIX}-rep@example.com`, role: 'rep' });

      await expect(assertResolvedAdminIs(ADMIN_USER.email)).rejects.toThrow(/no ACTIVE ADMIN/);
    } finally {
      await pool.query(`UPDATE users SET status = 'active' WHERE id = ANY($1::uuid[])`, [
        deactivatedIds,
      ]);
    }
  });

  it('throws when an OLDER foreign admin would win the resolution', async () => {
    // The silent-corruption case: seedDemo() would seed under the foreign owner while
    // owner-scoped teardown cleans a different id, orphaning rows behind the RESTRICT FKs.
    await ensureUser(
      { ...ADMIN_USER, email: `${FILE_PREFIX}-foreign@example.com` },
      OLDEST_BACKDATE,
    );
    await ensureUser(ADMIN_USER, NEWER_BACKDATE);

    await expect(assertResolvedAdminIs(ADMIN_USER.email)).rejects.toThrow(/older active admin/);
  });

  it('claimAdminResolution wins against a surviving sibling fixture — AC 2', async () => {
    // The exact interrupted-run state: another demo spec's admin is still resident and
    // deliberately backdated to win resolution. The next spec to run must still be able to
    // take ownership, or that file is permanently unrunnable — which fixed relative
    // backdates could not guarantee, since only one spec can hold the oldest slot.
    await ensureUser(
      { ...ADMIN_USER, email: `${FILE_PREFIX}-sibling@example.com` },
      OLDEST_BACKDATE,
    );

    const id = await claimAdminResolution(ADMIN_USER);

    expect(id).toBeTruthy();
    await expect(assertResolvedAdminIs(ADMIN_USER.email)).resolves.toBeUndefined();
  });

  it('claimAdminResolution is idempotent across repeated beforeEach calls', async () => {
    const first = await claimAdminResolution(ADMIN_USER);
    const second = await claimAdminResolution(ADMIN_USER);

    expect(second).toBe(first);
    await expect(assertResolvedAdminIs(ADMIN_USER.email)).resolves.toBeUndefined();
  });

  it('ignores an inactive admin that would otherwise sort first', async () => {
    await ensureUser(
      { ...ADMIN_USER, email: `${FILE_PREFIX}-foreign@example.com`, status: 'inactive' },
      OLDEST_BACKDATE,
    );
    await ensureUser(ADMIN_USER, NEWER_BACKDATE);

    // getAdminUserId filters on status = 'active', so the inactive row must not count.
    await expect(assertResolvedAdminIs(ADMIN_USER.email)).resolves.toBeUndefined();
  });
});
