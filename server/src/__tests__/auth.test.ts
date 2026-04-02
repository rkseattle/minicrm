/**
 * Integration tests for auth middleware and cookie security (MINCRM-74, MINCRM-76).
 *
 * MINCRM-74: Verifies that a deactivated user's JWT is rejected even if the
 *   token is still cryptographically valid, and that must_change_password is
 *   enforced on all routes except /api/auth/change-password.
 *
 * MINCRM-76: Verifies that the login response sets the expected cookie security
 *   flags (httpOnly, sameSite) and that the maxAge matches the 8-hour policy.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser, updateUserStatus } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

/** Eight hours expressed in milliseconds — must match authController constant */
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

/** Tolerance window for maxAge assertions (5 seconds) */
const MAX_AGE_TOLERANCE_MS = 5000;

const BASE_USER = {
  name: 'Auth Test User',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let activeUserId: string;
let activeCookie: string;
let deactivatedUserId: string;
let deactivatedCookie: string;
let _mustChangeUserId: string;
let mustChangeCookie: string;

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'auth-test-%'");

  const activeUser = await createUser({
    ...BASE_USER,
    email: 'auth-test-active@example.com',
  });
  activeUserId = activeUser.id;
  activeCookie = makeAuthCookie({
    id: activeUser.id,
    email: activeUser.email,
    name: activeUser.name,
    role: activeUser.role,
  });

  // Create and then deactivate — cookie is signed while user was active
  const deactivatedUser = await createUser({
    ...BASE_USER,
    email: 'auth-test-deactivated@example.com',
  });
  deactivatedUserId = deactivatedUser.id;
  deactivatedCookie = makeAuthCookie({
    id: deactivatedUser.id,
    email: deactivatedUser.email,
    name: deactivatedUser.name,
    role: deactivatedUser.role,
  });
  await updateUserStatus(deactivatedUserId, 'inactive');

  // Create a user with must_change_password = true
  const mustChangeUser = await pool.query(
    `INSERT INTO users (email, name, role, password_hash, status, must_change_password)
     VALUES ($1, $2, 'rep', '$2b$12$placeholder_hash', 'active', true)
     RETURNING *`,
    ['auth-test-mustchange@example.com', 'Must Change User'],
  );
  _mustChangeUserId = mustChangeUser.rows[0].id;
  mustChangeCookie = makeAuthCookie({
    id: mustChangeUser.rows[0].id,
    email: mustChangeUser.rows[0].email,
    name: mustChangeUser.rows[0].name,
    role: mustChangeUser.rows[0].role,
  });
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'auth-test-%'");
  await pool.end();
});

// ── MINCRM-74: deactivated user rejection ───────────────────────────────────

describe('MINCRM-74 — deactivated user mid-session', () => {
  it('returns 401 with USER_INACTIVE for a deactivated user on an authenticated route', async () => {
    const res = await request(app).get('/api/contacts').set('Cookie', deactivatedCookie);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('USER_INACTIVE');
  });

  it('returns 401 for a deactivated user hitting /api/auth/me', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', deactivatedCookie);

    // me() itself also checks status — either the middleware or controller returns 401
    expect(res.status).toBe(401);
  });

  it('allows a still-active user through', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', activeCookie);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(activeUserId);
  });
});

// ── MINCRM-74: must_change_password enforcement ─────────────────────────────

describe('MINCRM-74 — must_change_password enforcement', () => {
  it('returns 403 PASSWORD_CHANGE_REQUIRED on non-change-password routes', async () => {
    const res = await request(app).get('/api/contacts').set('Cookie', mustChangeCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('allows the must-change user to reach /api/auth/change-password', async () => {
    // Wrong current password — but we should get 401 (credential error), not 403
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', mustChangeCookie)
      .send({ currentPassword: 'wrong', newPassword: 'NewPass1' });

    // 401 means the route was reached (middleware passed); a 403 would mean it was blocked
    expect(res.status).not.toBe(403);
  });
});

// ── MINCRM-76: JWT cookie security flags ────────────────────────────────────

describe('MINCRM-76 — JWT cookie security flags', () => {
  beforeAll(async () => {
    // Seed the login test user; each test will set a fresh bcrypt hash before logging in
    await pool.query("DELETE FROM users WHERE email = 'auth-test-login@example.com'");
    await pool.query(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ('auth-test-login@example.com', 'Login Test', 'rep',
               '$2b$12$placeholder', 'active')`,
    );
  });

  it('sets httpOnly flag on the auth cookie', async () => {
    // Perform a real login using bcrypt so we get a Set-Cookie response
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash('TestPass1', 12);
    await pool.query(
      `UPDATE users SET password_hash = $1 WHERE email = 'auth-test-login@example.com'`,
      [hash],
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'auth-test-login@example.com', password: 'TestPass1' });

    expect(res.status).toBe(200);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const authCookie = cookies.find((c: string) => c.startsWith('minicrm_token='));
    expect(authCookie).toBeDefined();
    expect(authCookie!.toLowerCase()).toContain('httponly');
  });

  it('sets SameSite=Lax on the auth cookie', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash('TestPass1', 12);
    await pool.query(
      `UPDATE users SET password_hash = $1 WHERE email = 'auth-test-login@example.com'`,
      [hash],
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'auth-test-login@example.com', password: 'TestPass1' });

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const authCookie = cookies.find((c: string) => c.startsWith('minicrm_token='));
    expect(authCookie!.toLowerCase()).toContain('samesite=lax');
  });

  it('sets Max-Age consistent with the 8-hour session policy', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash('TestPass1', 12);
    await pool.query(
      `UPDATE users SET password_hash = $1 WHERE email = 'auth-test-login@example.com'`,
      [hash],
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'auth-test-login@example.com', password: 'TestPass1' });

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const authCookie = cookies.find((c: string) => c.startsWith('minicrm_token='));

    // Max-Age is in seconds in the Set-Cookie header
    const maxAgeMatch = authCookie!.match(/max-age=(\d+)/i);
    expect(maxAgeMatch).not.toBeNull();
    const maxAgeMs = parseInt(maxAgeMatch![1], 10) * 1000;
    expect(Math.abs(maxAgeMs - EIGHT_HOURS_MS)).toBeLessThan(MAX_AGE_TOLERANCE_MS);
  });

  it('does not set Secure flag in test environment (NODE_ENV != production)', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash('TestPass1', 12);
    await pool.query(
      `UPDATE users SET password_hash = $1 WHERE email = 'auth-test-login@example.com'`,
      [hash],
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'auth-test-login@example.com', password: 'TestPass1' });

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const authCookie = cookies.find((c: string) => c.startsWith('minicrm_token='));
    // In test/dev NODE_ENV the Secure flag should be absent
    expect(authCookie!.toLowerCase()).not.toContain('; secure');
  });
});
