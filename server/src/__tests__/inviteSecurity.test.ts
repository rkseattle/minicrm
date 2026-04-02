/**
 * Security verification tests for invite token properties (MINCRM-87) and
 * must_change_password API enforcement (MINCRM-78).
 *
 * MINCRM-87: Verifies that the invite token is:
 *   1. Time-limited — jwt.sign with expiresIn: '72h'; an expired token is rejected
 *   2. Single-use — second call to set-password after activation returns 409
 *   3. Purpose-scoped — a regular auth JWT cannot be used as an invite token
 *
 * MINCRM-78: Verifies that must_change_password is enforced at the API layer,
 *   not just client-side. A user with must_change_password=true receives 403
 *   PASSWORD_CHANGE_REQUIRED on all routes except /api/auth/change-password,
 *   regardless of whether they go through the React app.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';

const BASE_USER = {
  name: 'Invite Security Test',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let adminCookie: string;

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'inv-sec-%'");

  const admin = await createUser({
    ...BASE_USER,
    email: 'inv-sec-admin@example.com',
    role: 'admin',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'inv-sec-%'");
  await pool.end();
});

// ── MINCRM-87: invite token is time-limited ───────────────────────────────────

describe('MINCRM-87 — invite token expiry', () => {
  it('rejects an expired invite token with AUTH_INVALID_TOKEN', async () => {
    // Sign a token that expired 1 second ago
    const expiredToken = jwt.sign(
      { id: '00000000-0000-0000-0000-000000000001', purpose: 'invite' },
      process.env.JWT_SECRET ?? '',
      { expiresIn: -1 },
    );

    const res = await request(app)
      .post('/api/users/set-password')
      .send({ token: expiredToken, password: 'NewPass1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('invite token returned by /invite has an expiry claim', async () => {
    const res = await request(app)
      .post('/api/users/invite')
      .set('Cookie', adminCookie)
      .send({ email: 'inv-sec-expiry-check@example.com', name: 'Expiry Check', role: 'rep' });

    expect(res.status).toBe(201);

    const decoded = jwt.decode(res.body.inviteToken) as Record<string, unknown>;
    expect(decoded).not.toBeNull();
    expect(typeof decoded['exp']).toBe('number');

    // exp should be approximately 72 hours from now (within a 5-minute tolerance)
    const expectedExp = Math.floor(Date.now() / 1000) + 72 * 60 * 60;
    expect(Math.abs((decoded['exp'] as number) - expectedExp)).toBeLessThan(300);
  });
});

// ── MINCRM-87: invite token is single-use ────────────────────────────────────

describe('MINCRM-87 — invite token is single-use', () => {
  it('returns 409 USER_ALREADY_ACTIVATED on second use of the same invite token', async () => {
    // Create an invited user
    const inviteRes = await request(app)
      .post('/api/users/invite')
      .set('Cookie', adminCookie)
      .send({ email: 'inv-sec-singleuse@example.com', name: 'Single Use', role: 'rep' });

    expect(inviteRes.status).toBe(201);
    const { inviteToken } = inviteRes.body;

    // First use — should succeed
    const firstUse = await request(app)
      .post('/api/users/set-password')
      .send({ token: inviteToken, password: 'NewPass1' });

    expect(firstUse.status).toBe(200);

    // Second use — same token, same password — should be rejected
    const secondUse = await request(app)
      .post('/api/users/set-password')
      .send({ token: inviteToken, password: 'AnotherPass1' });

    expect(secondUse.status).toBe(409);
    expect(secondUse.body.error.code).toBe('USER_ALREADY_ACTIVATED');
  });
});

// ── MINCRM-87: invite token is purpose-scoped ────────────────────────────────

describe('MINCRM-87 — invite token cannot be substituted with an auth JWT', () => {
  it('rejects a regular session JWT used as an invite token', async () => {
    // Sign a token that looks like a session token (no purpose claim)
    const sessionToken = jwt.sign(
      { id: '00000000-0000-0000-0000-000000000002', email: 'x@x.com', role: 'rep' },
      process.env.JWT_SECRET ?? '',
      { expiresIn: '1h' },
    );

    const res = await request(app)
      .post('/api/users/set-password')
      .send({ token: sessionToken, password: 'NewPass1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });
});

// ── MINCRM-78: must_change_password is API-enforced ──────────────────────────

describe('MINCRM-78 — must_change_password enforced at the API layer', () => {
  let mustChangeCookie: string;

  beforeAll(async () => {
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, role, password_hash, status, must_change_password)
       VALUES ('inv-sec-mustchange@example.com', 'Must Change', 'rep',
               '$2b$12$placeholder_hash', 'active', true)
       RETURNING *`,
    );
    mustChangeCookie = makeAuthCookie({
      id: rows[0].id,
      email: rows[0].email,
      name: rows[0].name,
      role: rows[0].role,
    });
  });

  it('blocks API access with 403 PASSWORD_CHANGE_REQUIRED even without the React app', async () => {
    // Simulate a client bypassing the React app and calling the API directly
    const res = await request(app).get('/api/contacts').set('Cookie', mustChangeCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('blocks multiple different endpoints — enforcement is in middleware, not per-route', async () => {
    const endpoints = ['/api/accounts', '/api/deals', '/api/activities'];

    for (const endpoint of endpoints) {
      const res = await request(app).get(endpoint).set('Cookie', mustChangeCookie);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
  });

  it('allows access to /api/auth/change-password so the user can resolve the lock', async () => {
    // Wrong current password — but we should reach the controller (401), not be blocked (403)
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', mustChangeCookie)
      .send({ currentPassword: 'wrong', newPassword: 'NewPass1' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).not.toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('blocks access even when a valid JWT cookie is crafted manually without going through login', async () => {
    // Craft a cookie directly — simulates a user who knows their user ID
    const craftedToken = jwt.sign(
      { id: '00000000-0000-0000-0000-000000000099', email: 'x@x.com', name: 'x', role: 'rep' },
      process.env.JWT_SECRET ?? '',
      { expiresIn: '1h' },
    );
    const craftedCookie = `${AUTH_COOKIE_NAME}=${craftedToken}`;

    // User doesn't exist in DB — should get USER_INACTIVE (401), not bypass the gate
    const res = await request(app).get('/api/contacts').set('Cookie', craftedCookie);

    expect(res.status).toBe(401);
  });
});
