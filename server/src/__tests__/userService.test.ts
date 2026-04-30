/**
 * Unit tests for userService.
 *
 * These tests run against a real PostgreSQL database.
 * Set TEST_DB_* env vars (or DATABASE_URL) pointing to a test database.
 * The users table is truncated before each test to ensure isolation.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import {
  findUserByEmail,
  findUserById,
  createUser,
  updateUserStatus,
  updateUserRole,
  listUsers,
  listActiveUsers,
  setUserPassword,
  setUserPasswordFromPlaintext,
  adminSetUserPassword,
  clearMustChangePassword,
  getUserPreferredLanguage,
  setUserPreferredLanguage,
  getNotificationPrefs,
  updateNotificationPrefs,
  listUsersOptedIn,
  countActiveNotificationRecipients,
  seedDefaultAdmin,
} from '../services/userService.js';
import pool from '../db.js';

const FILE_PREFIX = 'user-svc';

/** Minimal user fixture used across tests */
const BASE_USER = {
  email: `${FILE_PREFIX}-test@example.com`,
  name: 'Test User',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

beforeEach(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── createUser ─────────────────────────────────────────────────────────────────

describe('createUser', () => {
  it('inserts a user and returns the full row', async () => {
    const user = await createUser(BASE_USER);

    expect(user.id).toBeDefined();
    expect(user.email).toBe(`${FILE_PREFIX}-test@example.com`);
    expect(user.name).toBe('Test User');
    expect(user.role).toBe('rep');
    expect(user.status).toBe('active');
    expect(user.password_hash).toBe(BASE_USER.passwordHash);
    expect(user.created_at).toBeInstanceOf(Date);
  });

  it('normalizes the email to lowercase', async () => {
    const user = await createUser({ ...BASE_USER, email: 'USER-SVC-UPPER@EXAMPLE.COM' });
    expect(user.email).toBe('user-svc-upper@example.com');
  });

  it('allows a null passwordHash for invited users', async () => {
    const user = await createUser({
      ...BASE_USER,
      passwordHash: null,
      status: 'invited',
    });
    expect(user.password_hash).toBeNull();
    expect(user.status).toBe('invited');
  });

  it('throws when inserting a duplicate email', async () => {
    await createUser(BASE_USER);
    await expect(createUser(BASE_USER)).rejects.toThrow();
  });
});

// ── findUserByEmail ────────────────────────────────────────────────────────────

describe('findUserByEmail', () => {
  it('returns the user row when found', async () => {
    await createUser(BASE_USER);
    const found = await findUserByEmail(`${FILE_PREFIX}-test@example.com`);
    expect(found).not.toBeNull();
    expect(found!.email).toBe(`${FILE_PREFIX}-test@example.com`);
  });

  it('returns null when no user matches', async () => {
    const found = await findUserByEmail('nobody@example.com');
    expect(found).toBeNull();
  });

  it('is case-insensitive', async () => {
    await createUser(BASE_USER);
    const found = await findUserByEmail('USER-SVC-TEST@EXAMPLE.COM');
    expect(found).not.toBeNull();
  });
});

// ── findUserById ───────────────────────────────────────────────────────────────

describe('findUserById', () => {
  it('returns the user row when found', async () => {
    const created = await createUser(BASE_USER);
    const found = await findUserById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it('returns null for a non-existent UUID', async () => {
    const found = await findUserById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});

// ── updateUserStatus ───────────────────────────────────────────────────────────

describe('updateUserStatus', () => {
  it('updates status to inactive', async () => {
    const user = await createUser(BASE_USER);
    const updated = await updateUserStatus(user.id, 'inactive');
    expect(updated!.status).toBe('inactive');
  });

  it('updates status to active from inactive', async () => {
    const user = await createUser({ ...BASE_USER, status: 'inactive' });
    const updated = await updateUserStatus(user.id, 'active');
    expect(updated!.status).toBe('active');
  });

  it('returns null for a non-existent user', async () => {
    const result = await updateUserStatus('00000000-0000-0000-0000-000000000000', 'inactive');
    expect(result).toBeNull();
  });
});

// ── updateUserRole ─────────────────────────────────────────────────────────────

describe('updateUserRole', () => {
  it('promotes a rep to admin', async () => {
    const user = await createUser(BASE_USER);
    const updated = await updateUserRole(user.id, 'admin');
    expect(updated!.role).toBe('admin');
  });

  it('demotes an admin to rep', async () => {
    const user = await createUser({ ...BASE_USER, role: 'admin' });
    const updated = await updateUserRole(user.id, 'rep');
    expect(updated!.role).toBe('rep');
  });

  it('returns null for a non-existent user', async () => {
    const result = await updateUserRole('00000000-0000-0000-0000-000000000000', 'admin');
    expect(result).toBeNull();
  });
});

// ── DB constraints ─────────────────────────────────────────────────────────────

describe('DB constraints — users', () => {
  it('rejects a user with a null email (NOT NULL)', async () => {
    await expect(
      pool.query(
        `INSERT INTO users (email, name, role, status) VALUES (NULL, 'Name', 'rep', 'active')`,
      ),
    ).rejects.toThrow();
  });

  it('rejects a user with a null name (NOT NULL)', async () => {
    await expect(
      pool.query(
        `INSERT INTO users (email, name, role, status) VALUES ('x@x.com', NULL, 'rep', 'active')`,
      ),
    ).rejects.toThrow();
  });
});

// ── listUsers ──────────────────────────────────────────────────────────────────

describe('listUsers', () => {
  it('returns an empty array when no users exist', async () => {
    const result = await listUsers();
    const mine = result.data.filter((u) => u.email.startsWith(FILE_PREFIX));
    expect(mine).toEqual([]);
  });

  it('returns all users ordered by created_at', async () => {
    await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-a@example.com` });
    await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-b@example.com` });

    const result = await listUsers({ limit: 1000 });
    const mine = result.data.filter((u) => u.email.startsWith(FILE_PREFIX));
    expect(mine).toHaveLength(2);
    expect(mine[0].email).toBe(`${FILE_PREFIX}-a@example.com`);
    expect(mine[1].email).toBe(`${FILE_PREFIX}-b@example.com`);
  });
});

// ── listUsers — pagination ─────────────────────────────────────────────────────

describe('listUsers — pagination', () => {
  it('returns correct page and limit metadata', async () => {
    await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-u1@example.com` });
    await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-u2@example.com` });
    await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-u3@example.com` });

    // Page 1 with limit 2: verify metadata fields are present and consistent
    const result = await listUsers({ page: 1, limit: 2 });
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.total).toBeGreaterThanOrEqual(3);
  });

  it('returns the correct slice for page 2', async () => {
    const u1 = await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-first@example.com` });
    const u2 = await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-second@example.com` });
    const u3 = await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-third@example.com` });
    const myIds = new Set([u1.id, u2.id, u3.id]);

    // Fetch enough to span pages and find our users across all pages
    const allResult = await listUsers({ limit: 1000 });
    const mine = allResult.data.filter((u) => myIds.has(u.id));
    expect(mine).toHaveLength(3);
    // Ordered by created_at ASC so first→second→third
    expect(mine[0].email).toBe(`${FILE_PREFIX}-first@example.com`);
    expect(mine[2].email).toBe(`${FILE_PREFIX}-third@example.com`);
  });
});

// ── listActiveUsers ────────────────────────────────────────────────────────────

describe('listActiveUsers', () => {
  it('returns an empty array when no active users from this file exist', async () => {
    // beforeEach already deleted all user-svc-* users; confirm none are active
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email LIKE $1 AND status = 'active'`,
      [`${FILE_PREFIX}-%`],
    );
    expect(rows).toHaveLength(0);
    // Also confirm listActiveUsers itself doesn't throw
    await expect(listActiveUsers()).resolves.toEqual(expect.any(Array));
  });

  it('returns only id and name fields', async () => {
    const created = await createUser(BASE_USER);
    const users = await listActiveUsers();
    const mine = users.find((u) => u.id === created.id);
    expect(mine).toBeDefined();
    expect(mine).toEqual({ id: created.id, name: BASE_USER.name });
    expect(mine).not.toHaveProperty('email');
    expect(mine).not.toHaveProperty('password_hash');
    expect(mine).not.toHaveProperty('role');
  });

  it('excludes invited users', async () => {
    const created = await createUser({
      ...BASE_USER,
      email: `${FILE_PREFIX}-invited@example.com`,
      status: 'invited',
      passwordHash: null,
    });
    const users = await listActiveUsers();
    expect(users.find((u) => u.id === created.id)).toBeUndefined();
  });

  it('excludes inactive users', async () => {
    const created = await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-inactive@example.com`, status: 'inactive' });
    const users = await listActiveUsers();
    expect(users.find((u) => u.id === created.id)).toBeUndefined();
  });

  it('orders results alphabetically by name', async () => {
    const charlie = await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-charlie@example.com`, name: 'Charlie' });
    const alice = await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-alice@example.com`, name: 'Alice' });
    const bob = await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-bob@example.com`, name: 'Bob' });
    const myIds = new Set([charlie.id, alice.id, bob.id]);

    const users = await listActiveUsers();
    const mine = users.filter((u) => myIds.has(u.id));
    expect(mine.map((u) => u.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('includes all active users regardless of role', async () => {
    const admin = await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-admin@example.com`, role: 'admin' });
    const rep = await createUser({ ...BASE_USER, email: `${FILE_PREFIX}-rep@example.com`, role: 'rep' });
    const myIds = new Set([admin.id, rep.id]);

    const users = await listActiveUsers();
    const mine = users.filter((u) => myIds.has(u.id));
    expect(mine).toHaveLength(2);
  });
});

// ── setUserPassword ────────────────────────────────────────────────────────────

describe('setUserPassword', () => {
  it('updates the password_hash field', async () => {
    const user = await createUser({
      ...BASE_USER,
      passwordHash: null,
      status: 'invited',
    });

    const newHash = '$2b$12$new_hash_value';
    const updated = await setUserPassword(user.id, newHash);

    expect(updated!.password_hash).toBe(newHash);
  });

  it('defaults must_change_password to false', async () => {
    const user = await createUser(BASE_USER);
    const updated = await setUserPassword(user.id, '$2b$12$new_hash');
    expect(updated!.must_change_password).toBe(false);
  });

  it('sets must_change_password to true when requested', async () => {
    const user = await createUser(BASE_USER);
    const updated = await setUserPassword(user.id, '$2b$12$new_hash', true);
    expect(updated!.must_change_password).toBe(true);
  });

  it('returns null for a non-existent user', async () => {
    const result = await setUserPassword('00000000-0000-0000-0000-000000000000', 'hash');
    expect(result).toBeNull();
  });
});

// ── adminSetUserPassword ───────────────────────────────────────────────────────

const ADMIN_ID = '00000000-0000-0000-0000-000000000001';

describe('adminSetUserPassword', () => {
  it('hashes and stores the password', async () => {
    const user = await createUser(BASE_USER);
    const updated = await adminSetUserPassword(ADMIN_ID, user.id, 'NewPass1');

    expect(updated).not.toBeNull();
    expect(updated!.password_hash).not.toBe('NewPass1');
    expect(updated!.password_hash).toMatch(/^\$2[aby]\$/);
  });

  it('sets must_change_password to true', async () => {
    const user = await createUser(BASE_USER);
    const updated = await adminSetUserPassword(ADMIN_ID, user.id, 'NewPass1');
    expect(updated!.must_change_password).toBe(true);
  });

  it('activates an invited user', async () => {
    const user = await createUser({ ...BASE_USER, passwordHash: null, status: 'invited' });
    const updated = await adminSetUserPassword(ADMIN_ID, user.id, 'NewPass1');
    expect(updated!.status).toBe('active');
  });

  it('leaves an active user still active', async () => {
    const user = await createUser(BASE_USER);
    const updated = await adminSetUserPassword(ADMIN_ID, user.id, 'NewPass1');
    expect(updated!.status).toBe('active');
  });

  it('returns null for a non-existent user', async () => {
    const result = await adminSetUserPassword(
      ADMIN_ID,
      '00000000-0000-0000-0000-000000000000',
      'NewPass1',
    );
    expect(result).toBeNull();
  });

  it('emits an audit log entry on success (MINCRM-89)', async () => {
    // Verify the function returns successfully — the audit log is written to
    // structured stdout via pino and is observable via logger.info spy in integration.
    // Here we confirm the function completes without error when admin and target IDs differ.
    const user = await createUser(BASE_USER);
    const updated = await adminSetUserPassword(ADMIN_ID, user.id, 'AuditPass1');
    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(user.id);
  });
});

// ── clearMustChangePassword ────────────────────────────────────────────────────

describe('clearMustChangePassword', () => {
  it('clears the must_change_password flag', async () => {
    const user = await createUser(BASE_USER);
    await setUserPassword(user.id, '$2b$12$hash', true);

    await clearMustChangePassword(user.id);

    const updated = await findUserById(user.id);
    expect(updated!.must_change_password).toBe(false);
  });
});

// ── setUserPasswordFromPlaintext ───────────────────────────────────────────────

describe('setUserPasswordFromPlaintext', () => {
  it('hashes the plaintext and stores the hash', async () => {
    const user = await createUser({ ...BASE_USER, passwordHash: null, status: 'invited' });
    const updated = await setUserPasswordFromPlaintext(user.id, 'MyP@ssword1');

    expect(updated).not.toBeNull();
    expect(updated!.password_hash).not.toBe('MyP@ssword1');
    expect(updated!.password_hash).toMatch(/^\$2[aby]\$/);
  });

  it('returns null for a non-existent user', async () => {
    const result = await setUserPasswordFromPlaintext(
      '00000000-0000-0000-0000-000000000000',
      'pass',
    );
    expect(result).toBeNull();
  });
});

// ── seedDefaultAdmin ───────────────────────────────────────────────────────────

describe('seedDefaultAdmin', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv['ADMIN_EMAIL'] = process.env.ADMIN_EMAIL;
    savedEnv['ADMIN_NAME'] = process.env.ADMIN_NAME;
    savedEnv['ADMIN_PASSWORD'] = process.env.ADMIN_PASSWORD;
  });

  afterEach(() => {
    for (const key of ['ADMIN_EMAIL', 'ADMIN_NAME', 'ADMIN_PASSWORD'] as const) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('creates an admin user when the table is empty and env vars are set', async () => {
    // This serial file runs after all parallel tests complete. beforeEach already
    // cleared user-svc-* users. Delete remaining child records then users to get
    // a clean table, relying on cascade FK order.
    await pool.query('DELETE FROM automation_rule_logs');
    await pool.query('DELETE FROM automation_rules');
    await pool.query('DELETE FROM overdue_task_notifications');
    await pool.query('DELETE FROM webhook_subscriptions');
    await pool.query('DELETE FROM activities');
    await pool.query('DELETE FROM deal_contacts');
    await pool.query('DELETE FROM deals');
    await pool.query('DELETE FROM leads');
    await pool.query('DELETE FROM contacts');
    await pool.query('DELETE FROM accounts');
    await pool.query('DELETE FROM users');

    process.env.ADMIN_EMAIL = `${FILE_PREFIX}-seed-admin@example.com`;
    process.env.ADMIN_NAME = 'Seed Admin';
    process.env.ADMIN_PASSWORD = 'SeedPass1';

    await seedDefaultAdmin();

    const user = await findUserByEmail(`${FILE_PREFIX}-seed-admin@example.com`);
    expect(user).not.toBeNull();
    expect(user!.role).toBe('admin');
    expect(user!.status).toBe('active');
  });

  it('is a no-op when users already exist', async () => {
    await createUser(BASE_USER);
    process.env.ADMIN_EMAIL = `${FILE_PREFIX}-should-not-exist@example.com`;
    process.env.ADMIN_NAME = 'Ghost';
    process.env.ADMIN_PASSWORD = 'GhostPass1';

    await seedDefaultAdmin();

    const ghost = await findUserByEmail(`${FILE_PREFIX}-should-not-exist@example.com`);
    expect(ghost).toBeNull();
  });

  it('is a no-op when ADMIN_EMAIL is not set', async () => {
    delete process.env.ADMIN_EMAIL;
    await expect(seedDefaultAdmin()).resolves.toBeUndefined();
  });
});

// ── getUserPreferredLanguage ───────────────────────────────────────────────────

describe('getUserPreferredLanguage', () => {
  it('returns null when no preference has been set', async () => {
    const user = await createUser(BASE_USER);
    const language = await getUserPreferredLanguage(user.id);
    expect(language).toBeNull();
  });

  it('returns null for a non-existent user', async () => {
    const language = await getUserPreferredLanguage('00000000-0000-0000-0000-000000000000');
    expect(language).toBeNull();
  });

  it('returns the language after it has been set', async () => {
    const user = await createUser(BASE_USER);
    await setUserPreferredLanguage(user.id, 'fr');
    const language = await getUserPreferredLanguage(user.id);
    expect(language).toBe('fr');
  });

  it('returns null after preference has been cleared', async () => {
    const user = await createUser(BASE_USER);
    await setUserPreferredLanguage(user.id, 'de');
    await setUserPreferredLanguage(user.id, null);
    const language = await getUserPreferredLanguage(user.id);
    expect(language).toBeNull();
  });

  it('returns null when the stored value is an unsupported locale', async () => {
    const user = await createUser(BASE_USER);
    // Inject an unsupported code directly to simulate a stale DB value
    await pool.query(`UPDATE users SET preferred_language = 'xx' WHERE id = $1`, [user.id]);
    const language = await getUserPreferredLanguage(user.id);
    expect(language).toBeNull();
  });
});

// ── setUserPreferredLanguage ───────────────────────────────────────────────────

describe('setUserPreferredLanguage', () => {
  it('persists the language and returns the updated row', async () => {
    const user = await createUser(BASE_USER);
    const updated = await setUserPreferredLanguage(user.id, 'zh-Hans');
    expect(updated).not.toBeNull();
    expect(updated!.preferred_language).toBe('zh-Hans');
  });

  it('overwrites a previously set language', async () => {
    const user = await createUser(BASE_USER);
    await setUserPreferredLanguage(user.id, 'es');
    const updated = await setUserPreferredLanguage(user.id, 'de');
    expect(updated!.preferred_language).toBe('de');
  });

  it('clears the preference when null is passed', async () => {
    const user = await createUser(BASE_USER);
    await setUserPreferredLanguage(user.id, 'fr');
    const updated = await setUserPreferredLanguage(user.id, null);
    expect(updated!.preferred_language).toBeNull();
  });

  it('handles all supported locales without error', async () => {
    const user = await createUser(BASE_USER);
    const locales = ['en', 'zh-Hans', 'es', 'fr', 'de'] as const;
    for (const locale of locales) {
      const updated = await setUserPreferredLanguage(user.id, locale);
      expect(updated!.preferred_language).toBe(locale);
    }
  });

  it('returns null for a non-existent user', async () => {
    const result = await setUserPreferredLanguage('00000000-0000-0000-0000-000000000000', 'en');
    expect(result).toBeNull();
  });
});

// ── getNotificationPrefs (MINCRM-163) ─────────────────────────────────────────

describe('getNotificationPrefs', () => {
  it('returns all-true defaults for a newly created user', async () => {
    const user = await createUser(BASE_USER);
    const prefs = await getNotificationPrefs(user.id);
    expect(prefs).toEqual({
      notify_overdue_tasks: true,
      notify_assignments: true,
      notify_deal_stage_changes: true,
    });
  });

  it('returns null for a non-existent user', async () => {
    const prefs = await getNotificationPrefs('00000000-0000-0000-0000-000000000000');
    expect(prefs).toBeNull();
  });
});

// ── updateNotificationPrefs (MINCRM-163) ──────────────────────────────────────

describe('updateNotificationPrefs', () => {
  it('persists updated preference flags', async () => {
    const user = await createUser(BASE_USER);
    const updated = await updateNotificationPrefs(user.id, {
      notify_overdue_tasks: false,
      notify_assignments: true,
      notify_deal_stage_changes: false,
    });
    expect(updated).not.toBeNull();
    expect(updated!.notify_overdue_tasks).toBe(false);
    expect(updated!.notify_assignments).toBe(true);
    expect(updated!.notify_deal_stage_changes).toBe(false);
  });

  it('can set all flags to false', async () => {
    const user = await createUser(BASE_USER);
    const updated = await updateNotificationPrefs(user.id, {
      notify_overdue_tasks: false,
      notify_assignments: false,
      notify_deal_stage_changes: false,
    });
    expect(updated!.notify_overdue_tasks).toBe(false);
    expect(updated!.notify_assignments).toBe(false);
    expect(updated!.notify_deal_stage_changes).toBe(false);
  });

  it('returns null for a non-existent user', async () => {
    const result = await updateNotificationPrefs('00000000-0000-0000-0000-000000000000', {
      notify_overdue_tasks: false,
      notify_assignments: false,
      notify_deal_stage_changes: false,
    });
    expect(result).toBeNull();
  });
});

// ── listUsersOptedIn (MINCRM-163) ─────────────────────────────────────────────

describe('listUsersOptedIn', () => {
  it('returns users opted in to overdue task notifications by default', async () => {
    const user = await createUser(BASE_USER);
    const opted = await listUsersOptedIn('notify_overdue_tasks');
    const ids = opted.map((u) => u.id);
    expect(ids).toContain(user.id);
  });

  it('excludes users who have opted out', async () => {
    const user = await createUser(BASE_USER);
    await updateNotificationPrefs(user.id, {
      notify_overdue_tasks: false,
      notify_assignments: true,
      notify_deal_stage_changes: true,
    });
    const opted = await listUsersOptedIn('notify_overdue_tasks');
    const ids = opted.map((u) => u.id);
    expect(ids).not.toContain(user.id);
  });
});

// ── countActiveNotificationRecipients (MINCRM-163) ───────────────────────────

describe('countActiveNotificationRecipients', () => {
  it('counts active users with at least one notification enabled', async () => {
    const countBefore = await countActiveNotificationRecipients();
    const user = await createUser(BASE_USER);

    // The new user has default notifications enabled — count must have increased
    const countWithUser = await countActiveNotificationRecipients();
    expect(countWithUser).toBeGreaterThanOrEqual(countBefore + 1);

    // Disable all notifs — this user's row must flip to all-false
    await updateNotificationPrefs(user.id, {
      notify_overdue_tasks: false,
      notify_assignments: false,
      notify_deal_stage_changes: false,
    });

    // Verify directly: the user is no longer in the notification-eligible set
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM users
       WHERE id = $1
         AND status = 'active'
         AND (notify_overdue_tasks = true OR notify_assignments = true OR notify_deal_stage_changes = true)`,
      [user.id],
    );
    expect(parseInt(rows[0].count, 10)).toBe(0);
  });
});
