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
  adminSetUserPassword,
  clearMustChangePassword,
} from '../services/userService.js';
import pool from '../db.js';

/** Minimal user fixture used across tests */
const BASE_USER = {
  email: 'test@example.com',
  name: 'Test User',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

beforeEach(async () => {
  await pool.query('DELETE FROM users');
});

afterAll(async () => {
  await pool.end();
});

// ── createUser ─────────────────────────────────────────────────────────────────

describe('createUser', () => {
  it('inserts a user and returns the full row', async () => {
    const user = await createUser(BASE_USER);

    expect(user.id).toBeDefined();
    expect(user.email).toBe('test@example.com');
    expect(user.name).toBe('Test User');
    expect(user.role).toBe('rep');
    expect(user.status).toBe('active');
    expect(user.password_hash).toBe(BASE_USER.passwordHash);
    expect(user.created_at).toBeInstanceOf(Date);
  });

  it('normalizes the email to lowercase', async () => {
    const user = await createUser({ ...BASE_USER, email: 'UPPER@EXAMPLE.COM' });
    expect(user.email).toBe('upper@example.com');
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
    const found = await findUserByEmail('test@example.com');
    expect(found).not.toBeNull();
    expect(found!.email).toBe('test@example.com');
  });

  it('returns null when no user matches', async () => {
    const found = await findUserByEmail('nobody@example.com');
    expect(found).toBeNull();
  });

  it('is case-insensitive', async () => {
    await createUser(BASE_USER);
    const found = await findUserByEmail('TEST@EXAMPLE.COM');
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

// ── listUsers ──────────────────────────────────────────────────────────────────

describe('listUsers', () => {
  it('returns an empty array when no users exist', async () => {
    const users = await listUsers();
    expect(users).toEqual([]);
  });

  it('returns all users ordered by created_at', async () => {
    await createUser({ ...BASE_USER, email: 'a@example.com' });
    await createUser({ ...BASE_USER, email: 'b@example.com' });

    const users = await listUsers();
    expect(users).toHaveLength(2);
    expect(users[0].email).toBe('a@example.com');
    expect(users[1].email).toBe('b@example.com');
  });
});

// ── listActiveUsers ────────────────────────────────────────────────────────────

describe('listActiveUsers', () => {
  it('returns an empty array when no active users exist', async () => {
    const users = await listActiveUsers();
    expect(users).toEqual([]);
  });

  it('returns only id and name fields', async () => {
    await createUser(BASE_USER);
    const users = await listActiveUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).toEqual({ id: expect.any(String), name: BASE_USER.name });
    expect(users[0]).not.toHaveProperty('email');
    expect(users[0]).not.toHaveProperty('password_hash');
    expect(users[0]).not.toHaveProperty('role');
  });

  it('excludes invited users', async () => {
    await createUser({
      ...BASE_USER,
      email: 'invited@example.com',
      status: 'invited',
      passwordHash: null,
    });
    const users = await listActiveUsers();
    expect(users).toHaveLength(0);
  });

  it('excludes inactive users', async () => {
    await createUser({ ...BASE_USER, email: 'inactive@example.com', status: 'inactive' });
    const users = await listActiveUsers();
    expect(users).toHaveLength(0);
  });

  it('orders results alphabetically by name', async () => {
    await createUser({ ...BASE_USER, email: 'charlie@example.com', name: 'Charlie' });
    await createUser({ ...BASE_USER, email: 'alice@example.com', name: 'Alice' });
    await createUser({ ...BASE_USER, email: 'bob@example.com', name: 'Bob' });

    const users = await listActiveUsers();
    expect(users.map((u) => u.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('includes all active users regardless of role', async () => {
    await createUser({ ...BASE_USER, email: 'admin@example.com', role: 'admin' });
    await createUser({ ...BASE_USER, email: 'rep@example.com', role: 'rep' });

    const users = await listActiveUsers();
    expect(users).toHaveLength(2);
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

describe('adminSetUserPassword', () => {
  it('hashes and stores the password', async () => {
    const user = await createUser(BASE_USER);
    const updated = await adminSetUserPassword(user.id, 'NewPass1');

    expect(updated).not.toBeNull();
    expect(updated!.password_hash).not.toBe('NewPass1');
    expect(updated!.password_hash).toMatch(/^\$2[aby]\$/);
  });

  it('sets must_change_password to true', async () => {
    const user = await createUser(BASE_USER);
    const updated = await adminSetUserPassword(user.id, 'NewPass1');
    expect(updated!.must_change_password).toBe(true);
  });

  it('activates an invited user', async () => {
    const user = await createUser({ ...BASE_USER, passwordHash: null, status: 'invited' });
    const updated = await adminSetUserPassword(user.id, 'NewPass1');
    expect(updated!.status).toBe('active');
  });

  it('leaves an active user still active', async () => {
    const user = await createUser(BASE_USER);
    const updated = await adminSetUserPassword(user.id, 'NewPass1');
    expect(updated!.status).toBe('active');
  });

  it('returns null for a non-existent user', async () => {
    const result = await adminSetUserPassword('00000000-0000-0000-0000-000000000000', 'NewPass1');
    expect(result).toBeNull();
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
