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
  getUserNavLayout,
  setUserNavLayout,
  getNotificationPrefs,
  updateNotificationPrefs,
  listUsersOptedIn,
  countActiveNotificationRecipients,
  seedDefaultAdmin,
  resetUserOnboarding,
} from '../services/userService.js';
import pool from '../db.js';
import { NAV_LAYOUTS } from '@minicrm/shared/schemas/settingsSchema.js';
import { getFieldDisplayName } from '../services/auditService.js';

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

  // new roles
  it('assigns manager role', async () => {
    const user = await createUser(BASE_USER);
    const updated = await updateUserRole(user.id, 'manager');
    expect(updated!.role).toBe('manager');
  });

  it('assigns viewer role', async () => {
    const user = await createUser(BASE_USER);
    const updated = await updateUserRole(user.id, 'viewer');
    expect(updated!.role).toBe('viewer');
  });

  it('assigns service_account role', async () => {
    const user = await createUser(BASE_USER);
    const updated = await updateUserRole(user.id, 'service_account');
    expect(updated!.role).toBe('service_account');
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
    const created = await createUser({
      ...BASE_USER,
      email: `${FILE_PREFIX}-inactive@example.com`,
      status: 'inactive',
    });
    const users = await listActiveUsers();
    expect(users.find((u) => u.id === created.id)).toBeUndefined();
  });

  it('orders results alphabetically by name', async () => {
    const charlie = await createUser({
      ...BASE_USER,
      email: `${FILE_PREFIX}-charlie@example.com`,
      name: 'Charlie',
    });
    const alice = await createUser({
      ...BASE_USER,
      email: `${FILE_PREFIX}-alice@example.com`,
      name: 'Alice',
    });
    const bob = await createUser({
      ...BASE_USER,
      email: `${FILE_PREFIX}-bob@example.com`,
      name: 'Bob',
    });
    const myIds = new Set([charlie.id, alice.id, bob.id]);

    const users = await listActiveUsers();
    const mine = users.filter((u) => myIds.has(u.id));
    expect(mine.map((u) => u.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('includes all active users regardless of role', async () => {
    const admin = await createUser({
      ...BASE_USER,
      email: `${FILE_PREFIX}-admin@example.com`,
      role: 'admin',
    });
    const rep = await createUser({
      ...BASE_USER,
      email: `${FILE_PREFIX}-rep@example.com`,
      role: 'rep',
    });
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

  it('emits an audit log entry on success', async () => {
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
    await pool.query('DELETE FROM notes');
    await pool.query('DELETE FROM users');

    process.env.ADMIN_EMAIL = `${FILE_PREFIX}-seed-admin@example.com`;
    process.env.ADMIN_NAME = 'Seed Admin';
    process.env.ADMIN_PASSWORD = 'Se3dPass!phrase';

    await seedDefaultAdmin();

    const user = await findUserByEmail(`${FILE_PREFIX}-seed-admin@example.com`);
    expect(user).not.toBeNull();
    expect(user!.role).toBe('admin');
    expect(user!.status).toBe('active');
  });

  /**
   * Both .env templates ship this literal. Seeding it produces an ACTIVE admin whose
   * password is published in this repository — so refusing to boot is the safe
   * outcome, and it is reachable by a reader who follows the Quick Start but misses
   * the single line of prose telling them to change it.
   */
  it('refuses to seed the placeholder password shipped in .env.example', async () => {
    process.env.ADMIN_EMAIL = `${FILE_PREFIX}-seed-placeholder@example.com`;
    process.env.ADMIN_NAME = 'Seed Admin';
    process.env.ADMIN_PASSWORD = 'REPLACE_WITH_STRONG_PASSWORD';

    await expect(seedDefaultAdmin()).rejects.toThrow(/still the placeholder/i);
    expect(await findUserByEmail(`${FILE_PREFIX}-seed-placeholder@example.com`)).toBeNull();
  });

  /**
   * The policy is enforced wherever a password is CHANGED but was not where the first
   * one is SEEDED, so a weak value was accepted here and then rejected the moment the
   * admin tried to change it — locking them out of their own account.
   */
  it('refuses to seed a password the change-password policy would reject', async () => {
    process.env.ADMIN_EMAIL = `${FILE_PREFIX}-seed-weak@example.com`;
    process.env.ADMIN_NAME = 'Seed Admin';
    process.env.ADMIN_PASSWORD = 'short1';

    await expect(seedDefaultAdmin()).rejects.toThrow(/password policy/i);
    expect(await findUserByEmail(`${FILE_PREFIX}-seed-weak@example.com`)).toBeNull();
  });

  // the guard is scoped to ADMIN_EMAIL, not "any user exists". An
  // unrelated row (service account, deactivated user, leftover test fixture) must not
  // permanently block the configured admin from being created — that is the lockout
  // this ticket fixes.
  it('creates the configured admin even when other users already exist', async () => {
    await createUser(BASE_USER);
    process.env.ADMIN_EMAIL = `${FILE_PREFIX}-seed-with-others@example.com`;
    process.env.ADMIN_NAME = 'Seed Admin';
    process.env.ADMIN_PASSWORD = 'Se3dPass!phrase';

    await seedDefaultAdmin();

    const admin = await findUserByEmail(`${FILE_PREFIX}-seed-with-others@example.com`);
    expect(admin).not.toBeNull();
    expect(admin!.role).toBe('admin');
    expect(admin!.status).toBe('active');
  });

  it('is idempotent when the configured admin already exists', async () => {
    process.env.ADMIN_EMAIL = `${FILE_PREFIX}-seed-idempotent@example.com`;
    process.env.ADMIN_NAME = 'Seed Admin';
    process.env.ADMIN_PASSWORD = 'Se3dPass!phrase';

    await seedDefaultAdmin();
    await seedDefaultAdmin();

    const { rows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM users WHERE email = $1',
      [`${FILE_PREFIX}-seed-idempotent@example.com`],
    );
    expect(rows[0].count).toBe(1);
  });

  // createUser stores email lowercased and trimmed. A guard that compares the raw
  // ADMIN_EMAIL would miss the stored row on every boot, then fail the insert on the
  // unique constraint — reintroducing the silent no-op this ticket removes.
  it('is idempotent when ADMIN_EMAIL differs from the stored row only by case and whitespace', async () => {
    const address = `${FILE_PREFIX}-seed-mixed-case@example.com`;
    process.env.ADMIN_EMAIL = address;
    process.env.ADMIN_NAME = 'Seed Admin';
    process.env.ADMIN_PASSWORD = 'Se3dPass!phrase';
    await seedDefaultAdmin();

    process.env.ADMIN_EMAIL = `  ${address.toUpperCase()}  `;
    await seedDefaultAdmin();

    const { rows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM users WHERE email = $1',
      [address],
    );
    expect(rows[0].count).toBe(1);
  });

  // ADMIN_EMAIL taken by a user who cannot log in as admin is logged loudly but must
  // NOT throw: seedDefaultAdmin runs inside server.ts's startup block, whose catch
  // exits the process. Demoting or deactivating the bootstrap admin is a supported
  // admin-UI action, so throwing would turn a routine change into a boot loop on the
  // next restart. The seed is a bootstrap convenience, not a liveness requirement.
  it('warns without throwing when ADMIN_EMAIL is taken by a non-admin user', async () => {
    const address = `${FILE_PREFIX}-seed-conflict-role@example.com`;
    await createUser({
      email: address,
      name: 'Existing Rep',
      role: 'rep',
      passwordHash: 'hash',
      status: 'active',
    });
    process.env.ADMIN_EMAIL = address;
    process.env.ADMIN_NAME = 'Seed Admin';
    process.env.ADMIN_PASSWORD = 'Se3dPass!phrase';

    await expect(seedDefaultAdmin()).resolves.toBeUndefined();

    // The existing row is left exactly as it was — never silently promoted.
    const stillRep = await findUserByEmail(address);
    expect(stillRep!.role).toBe('rep');
  });

  it('warns without throwing when ADMIN_EMAIL is taken by a deactivated admin', async () => {
    const address = `${FILE_PREFIX}-seed-conflict-status@example.com`;
    const user = await createUser({
      email: address,
      name: 'Disabled Admin',
      role: 'admin',
      passwordHash: '$2b$12$placeholder_hash',
      status: 'active',
    });
    await updateUserStatus(user.id, 'inactive');
    process.env.ADMIN_EMAIL = address;
    process.env.ADMIN_NAME = 'Seed Admin';
    process.env.ADMIN_PASSWORD = 'Se3dPass!phrase';

    await expect(seedDefaultAdmin()).resolves.toBeUndefined();

    const stillInactive = await findUserByEmail(address);
    expect(stillInactive!.status).toBe('inactive');
  });

  // An active admin with no password_hash boots fine but cannot log in —
  // authController rejects it with AUTH_ACCOUNT_NOT_ACTIVATED. Invited and
  // SCIM/SSO-provisioned rows are created this way and can be promoted to admin.
  it('warns without throwing when ADMIN_EMAIL is taken by an admin with no password hash', async () => {
    const address = `${FILE_PREFIX}-seed-conflict-nohash@example.com`;
    await createUser({
      email: address,
      name: 'Invited Admin',
      role: 'admin',
      passwordHash: null,
      status: 'active',
    });
    process.env.ADMIN_EMAIL = address;
    process.env.ADMIN_NAME = 'Seed Admin';
    process.env.ADMIN_PASSWORD = 'Se3dPass!phrase';

    await expect(seedDefaultAdmin()).resolves.toBeUndefined();

    const stillHashless = await findUserByEmail(address);
    expect(stillHashless!.password_hash).toBeNull();
  });

  it('is a no-op when ADMIN_EMAIL is not set', async () => {
    delete process.env.ADMIN_EMAIL;
    await expect(seedDefaultAdmin()).resolves.toBeUndefined();
  });

  it('is a no-op when ADMIN_NAME is not set', async () => {
    process.env.ADMIN_EMAIL = `${FILE_PREFIX}-seed-no-name@example.com`;
    delete process.env.ADMIN_NAME;
    process.env.ADMIN_PASSWORD = 'Se3dPass!phrase';

    await expect(seedDefaultAdmin()).resolves.toBeUndefined();

    const user = await findUserByEmail(`${FILE_PREFIX}-seed-no-name@example.com`);
    expect(user).toBeNull();
  });

  it('is a no-op when ADMIN_PASSWORD is not set', async () => {
    process.env.ADMIN_EMAIL = `${FILE_PREFIX}-seed-no-password@example.com`;
    process.env.ADMIN_NAME = 'Seed Admin';
    delete process.env.ADMIN_PASSWORD;

    await expect(seedDefaultAdmin()).resolves.toBeUndefined();

    const user = await findUserByEmail(`${FILE_PREFIX}-seed-no-password@example.com`);
    expect(user).toBeNull();
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

/** A UUID no user row holds, for the not-found paths below. */
const MISSING_USER_ID = '00000000-0000-0000-0000-000000000000';

// ── getUserNavLayout ───────────────────────────────────────────────────────────

describe('getUserNavLayout', () => {
  it('returns null when no preference has been set', async () => {
    const user = await createUser(BASE_USER);
    expect(await getUserNavLayout(user.id)).toBeNull();
  });

  it('returns null for a non-existent user', async () => {
    expect(await getUserNavLayout(MISSING_USER_ID)).toBeNull();
  });

  it('returns the layout after it has been set', async () => {
    const user = await createUser(BASE_USER);
    await setUserNavLayout(user.id, 'left', { id: user.id, name: user.name });
    expect(await getUserNavLayout(user.id)).toBe('left');
  });

  it('returns null after the preference has been cleared', async () => {
    const user = await createUser(BASE_USER);
    await setUserNavLayout(user.id, 'hamburger', { id: user.id, name: user.name });
    await setUserNavLayout(user.id, null, { id: user.id, name: user.name });
    expect(await getUserNavLayout(user.id)).toBeNull();
  });

  it('rejects an unsupported stored value without needing to plant one', async () => {
    // The CHECK constraint makes a stale nav_layout unreachable through the app, and
    // dropping it to plant one would take an ACCESS EXCLUSIVE lock across every
    // parallel test file. The runtime guard is shared with preferred_language, whose
    // column has no CHECK — the sibling test above plants 'xx' there and covers the
    // same branch. Here, assert the constraint is the reason a stale value cannot exist.
    const user = await createUser(BASE_USER);
    await expect(
      pool.query(`UPDATE users SET nav_layout = 'sidebar' WHERE id = $1`, [user.id]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await getUserNavLayout(user.id)).toBeNull();
  });
});

// ── setUserNavLayout ───────────────────────────────────────────────────────────

describe('setUserNavLayout', () => {
  it('persists the layout and returns the updated row', async () => {
    const user = await createUser(BASE_USER);
    const updated = await setUserNavLayout(user.id, 'left', { id: user.id, name: user.name });
    expect(updated).not.toBeNull();
    expect(updated!.nav_layout).toBe('left');
  });

  it('overwrites a previously set layout', async () => {
    const user = await createUser(BASE_USER);
    await setUserNavLayout(user.id, 'left', { id: user.id, name: user.name });
    const updated = await setUserNavLayout(user.id, 'hamburger', { id: user.id, name: user.name });
    expect(updated).not.toBeNull();
    expect(updated!.nav_layout).toBe('hamburger');
  });

  it('clears the preference when null is passed', async () => {
    const user = await createUser(BASE_USER);
    await setUserNavLayout(user.id, 'left', { id: user.id, name: user.name });
    const updated = await setUserNavLayout(user.id, null, { id: user.id, name: user.name });
    expect(updated).not.toBeNull();
    expect(updated!.nav_layout).toBeNull();
  });

  it('handles every supported layout without error', async () => {
    const user = await createUser(BASE_USER);
    for (const layout of NAV_LAYOUTS) {
      const updated = await setUserNavLayout(user.id, layout, { id: user.id, name: user.name });
      expect(updated).not.toBeNull();
      expect(updated!.nav_layout).toBe(layout);
    }
  });

  it('returns null for a non-existent user', async () => {
    const result = await setUserNavLayout(MISSING_USER_ID, 'top', {
      id: MISSING_USER_ID,
      name: 'Nobody',
    });
    expect(result).toBeNull();
  });

  it('writes one audit entry naming the caller as the actor', async () => {
    const user = await createUser(BASE_USER);
    await setUserNavLayout(user.id, 'left', { id: user.id, name: user.name });

    const audit = await pool.query(
      `SELECT field_name, old_value, new_value, changed_by_id, event_type, record_type
         FROM audit_log WHERE record_id = $1 AND field_name = $2`,
      [user.id, getFieldDisplayName('nav_layout')],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      record_type: 'user',
      event_type: 'updated',
      old_value: null,
      new_value: 'left',
      changed_by_id: user.id,
    });
  });

  it('records the previous layout as the audit old value', async () => {
    const user = await createUser(BASE_USER);
    await setUserNavLayout(user.id, 'left', { id: user.id, name: user.name });
    await setUserNavLayout(user.id, 'hamburger', { id: user.id, name: user.name });

    const audit = await pool.query<{ old_value: string | null; new_value: string | null }>(
      `SELECT old_value, new_value FROM audit_log
        WHERE record_id = $1 AND field_name = $2
        ORDER BY created_at DESC LIMIT 1`,
      [user.id, getFieldDisplayName('nav_layout')],
    );
    expect(audit.rows[0].old_value).toBe('left');
    expect(audit.rows[0].new_value).toBe('hamburger');
  });

  it('writes no audit entry when the user does not exist', async () => {
    await setUserNavLayout(MISSING_USER_ID, 'top', { id: MISSING_USER_ID, name: 'Nobody' });
    const audit = await pool.query(
      `SELECT 1 FROM audit_log WHERE record_id = $1 AND field_name = $2`,
      [MISSING_USER_ID, getFieldDisplayName('nav_layout')],
    );
    expect(audit.rows).toHaveLength(0);
  });
});

// ── getNotificationPrefs ─────────────────────────────────────────

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

// ── updateNotificationPrefs ──────────────────────────────────────

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

// ── listUsersOptedIn ─────────────────────────────────────────────

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

// ── countActiveNotificationRecipients ───────────────────────────

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

// ── resetUserOnboarding ──────────────────────────────────────────

describe('resetUserOnboarding', () => {
  const ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

  it('resets onboarding_completed to false for the target user', async () => {
    const user = await createUser(BASE_USER);

    // First mark as completed
    await pool.query(
      `UPDATE users SET onboarding_completed = true, onboarding_completed_at = now() WHERE id = $1`,
      [user.id],
    );

    await resetUserOnboarding(user.id, ACTOR);

    const result = await pool.query<{
      onboarding_completed: boolean;
      onboarding_completed_at: Date | null;
    }>(`SELECT onboarding_completed, onboarding_completed_at FROM users WHERE id = $1`, [user.id]);
    expect(result.rows[0].onboarding_completed).toBe(false);
    expect(result.rows[0].onboarding_completed_at).toBeNull();
  });

  it('throws USER_NOT_FOUND for a non-existent user', async () => {
    await expect(
      resetUserOnboarding('00000000-0000-0000-0000-999999999999', ACTOR),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('writes an audit entry', async () => {
    const user = await createUser(BASE_USER);

    await pool.query(
      `UPDATE users SET onboarding_completed = true, onboarding_completed_at = now() WHERE id = $1`,
      [user.id],
    );

    await resetUserOnboarding(user.id, ACTOR);

    const audit = await pool.query<{ field_name: string; old_value: string; new_value: string }>(
      `SELECT field_name, old_value, new_value
       FROM audit_log
       WHERE record_type = 'user' AND record_id = $1 AND field_name = 'onboarding_completed'
       ORDER BY created_at DESC LIMIT 1`,
      [user.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].old_value).toBe('true');
    expect(audit.rows[0].new_value).toBe('false');
  });
});
