/**
 * Unit tests for the shared fixture helpers in testUtils.ts.
 *
 * These pin the fix: demo specs depend on a fixture admin that a sibling
 * spec's bare `DELETE FROM users` (userService.test.ts) or an interrupted run can remove,
 * and on that fixture being the one `demoService.getAdminUserId()` actually resolves.
 * Both properties are invisible from the symptom when they break, so they are asserted
 * here rather than left to the demo specs to discover.
 *
 * Runs against the minicrm_test database.
 */

import 'dotenv/config';
import pool from '../db.js';
import {
  FIXTURE_CREATED_AT_BACKDATE,
  assertResolvedAdminIs,
  claimAdminResolution,
  ensureUser,
} from './testUtils.js';

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

  it('clears every auth-gating column a prior spec may have left set', async () => {
    await ensureUser(ADMIN_USER);
    // password_changed_at later than a freshly-signed token's iat makes authenticate
    // reject with 401; the MFA and SSO columns gate their own flows. All are documented
    // as reset, so all are pinned — otherwise deleting a reset clause fails nothing.
    await pool.query(
      `UPDATE users SET password_changed_at = now(), mfa_enabled = true, mfa_secret = 'x',
                        sso_provider = 'saml', sso_subject = 'subj'
        WHERE email = $1`,
      [ADMIN_USER.email],
    );

    await ensureUser(ADMIN_USER);

    const row = await pool.query<{
      password_changed_at: Date | null;
      mfa_enabled: boolean;
      mfa_secret: string | null;
      sso_provider: string | null;
      sso_subject: string | null;
    }>(
      `SELECT password_changed_at, mfa_enabled, mfa_secret, sso_provider, sso_subject
         FROM users WHERE email = $1`,
      [ADMIN_USER.email],
    );
    expect(row.rows[0].password_changed_at).toBeNull();
    expect(row.rows[0].mfa_enabled).toBe(false);
    expect(row.rows[0].mfa_secret).toBeNull();
    expect(row.rows[0].sso_provider).toBeNull();
    expect(row.rows[0].sso_subject).toBeNull();
  });

  it('applies the default backdate when no explicit interval is given', async () => {
    // demoSeed.test.ts relies on the default path; without this, setting the default to
    // '0 seconds' would fail nothing.
    //
    // Asserts against the exported constant rather than a literal year count. The default
    // is expressed in seconds so it is directly comparable with claimAdminResolution's
    // fallback, and seconds do not convert to a whole number of leap-aware years — a
    // hardcoded expectation silently pins one spelling of the constant and has to be
    // hand-corrected whenever it changes.
    await ensureUser(ADMIN_USER);

    const row = await pool.query<{ matches_default: boolean }>(
      `SELECT created_at BETWEEN
                now() - $2::interval - interval '1 minute'
                AND now() - $2::interval + interval '1 minute' AS matches_default
         FROM users WHERE email = $1`,
      [ADMIN_USER.email, FIXTURE_CREATED_AT_BACKDATE],
    );
    expect(row.rows[0].matches_default).toBe(true);
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
    // Exact, not `> 100`: a loose bound passes for any value above the default and so
    // would not pin the interval the caller actually passed.
    expect(row.rows[0].age_years).toBe(500);
  });
});

describe('assertResolvedAdminIs', () => {
  it('passes when this fixture is the oldest active admin', async () => {
    await ensureUser(ADMIN_USER, OLDEST_BACKDATE);

    await expect(assertResolvedAdminIs(ADMIN_USER.email)).resolves.toBeUndefined();
  });

  it('throws, naming the condition, when no active admin exists at all', async () => {
    // "No active admin" is a property of the WHOLE users table, and the parallel project
    // runs concurrently with this serial file — so establishing it by deactivating every
    // admin row would make ~28 specs that authenticate with an admin cookie fail with
    // 401 USER_INACTIVE while this test held the window open (middleware/auth.ts rejects
    // any non-active user on a live lookup). A SELECT-then-UPDATE would also be TOCTOU:
    // an admin created between the two statements survives, and the assertion then fails
    // on the wrong branch.
    //
    // Both problems go away by never committing the mutation. The deactivation runs
    // inside a transaction on a dedicated client and is always rolled back, so no other
    // connection can SEE it — though it does hold row locks on the admin rows until the
    // rollback, so a concurrent writer touching one would block. Three statements, so the
    // window is short; do not extend this transaction. Same isolation pattern as
    // expectActorScopingIsolatesForeignRows
    // in testUtils.ts already uses for exactly this reason. assertResolvedAdminIs must
    // run on that same client to see the uncommitted state.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE users SET status = 'inactive' WHERE role = 'admin'`);
      await client.query(
        `INSERT INTO users (email, name, role, password_hash, status)
         VALUES ($1, 'Leftover Rep', 'rep', 'x', 'active')
         ON CONFLICT (email) DO UPDATE SET status = 'active'`,
        [`${FILE_PREFIX}-rep@example.com`],
      );

      await expect(assertResolvedAdminIs(ADMIN_USER.email, client)).rejects.toThrow(
        /no ACTIVE ADMIN/,
      );
    } finally {
      // Unconditional: an assertion failure must not leak the deactivation to any
      // sibling spec.
      await client.query('ROLLBACK');
      client.release();
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
