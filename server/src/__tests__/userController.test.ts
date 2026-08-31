/**
 * Integration tests for user controller endpoints.
 *
 * Verifies that API responses never expose password_hash and that
 * admin-only endpoints are correctly gated.
 *
 * Runs against a real PostgreSQL test database via supertest.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { NAV_LAYOUTS } from '@minicrm/shared/schemas/settingsSchema.js';
import { makeAuthCookie } from './testUtils.js';

const BASE_USER = {
  name: 'Base User',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let adminId: string;
let adminCookie: string;
let repId: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'user-ctrl%'");

  const admin = await createUser({
    ...BASE_USER,
    email: 'user-ctrl-admin@example.com',
    role: 'admin',
  });
  adminId = admin.id;
  adminCookie = makeAuthCookie({
    id: adminId,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const rep = await createUser({
    ...BASE_USER,
    email: 'user-ctrl-rep@example.com',
    role: 'rep',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({
    id: repId,
    email: rep.email,
    name: rep.name,
    role: rep.role,
  });
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'user-ctrl%'");
});

// ── GET /api/v1/users ──────────────────────────────────────────────────────────────

describe('GET /api/v1/users', () => {
  it('returns 200 and a users array for admin', async () => {
    const res = await request(app).get('/api/v1/users').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('never exposes password_hash in the response', async () => {
    const res = await request(app).get('/api/v1/users').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    for (const user of res.body.data) {
      expect(user).not.toHaveProperty('password_hash');
    }
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app).get('/api/v1/users').set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/users/invite ──────────────────────────────────────────────────────

describe('POST /api/v1/users/invite', () => {
  it('creates an invited user and never exposes password_hash', async () => {
    const res = await request(app)
      .post('/api/v1/users/invite')
      .set('Cookie', adminCookie)
      .send({ email: 'user-ctrl-invited@example.com', name: 'Invited User', role: 'rep' });

    expect(res.status).toBe(201);
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.inviteToken).toBeDefined();
  });

  it('returns 409 when the email is already taken', async () => {
    const res = await request(app)
      .post('/api/v1/users/invite')
      .set('Cookie', adminCookie)
      .send({ email: 'user-ctrl-admin@example.com', name: 'Duplicate', role: 'rep' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USER_EMAIL_CONFLICT');
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app)
      .post('/api/v1/users/invite')
      .set('Cookie', repCookie)
      .send({ email: 'user-ctrl-blocked@example.com', name: 'Blocked', role: 'rep' });

    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/v1/users/:id/role ───────────────────────────────────────────────────

describe('PATCH /api/v1/users/:id/role', () => {
  afterEach(async () => {
    await pool.query(`UPDATE users SET role = 'rep' WHERE id = $1`, [repId]);
  });

  it('promotes a rep to admin and never exposes password_hash', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${repId}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('returns 404 for a non-existent user', async () => {
    const res = await request(app)
      .patch('/api/v1/users/00000000-0000-0000-0000-000000000000/role')
      .set('Cookie', adminCookie)
      .send({ role: 'admin' });

    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/v1/users/:id/deactivate ────────────────────────────────────────────

describe('PATCH /api/v1/users/:id/deactivate', () => {
  it('deactivates a user and never exposes password_hash', async () => {
    const target = await createUser({
      ...BASE_USER,
      email: 'user-ctrl-deactivate@example.com',
    });

    const res = await request(app)
      .patch(`/api/v1/users/${target.id}/deactivate`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('inactive');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${repId}/deactivate`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/users/me/nav-layout', () => {
  it('returns null when the user has no preference', async () => {
    const res = await request(app).get('/api/v1/users/me/nav-layout').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.layout).toBeNull();
  });

  it('is reachable by a non-admin', async () => {
    const res = await request(app).get('/api/v1/users/me/nav-layout').set('Cookie', repCookie);
    expect(res.status).toBe(200);
  });

  it('returns 401 without a session', async () => {
    const res = await request(app).get('/api/v1/users/me/nav-layout');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/v1/users/me/nav-layout', () => {
  // No truncating beforeEach in this file, so each test clears what it wrote.
  afterEach(async () => {
    for (const cookie of [adminCookie, repCookie]) {
      await request(app)
        .patch('/api/v1/users/me/nav-layout')
        .set('Cookie', cookie)
        .send({ layout: null });
    }
  });

  it.each([...NAV_LAYOUTS])('accepts %s and echoes it back', async (layout) => {
    const res = await request(app)
      .patch('/api/v1/users/me/nav-layout')
      .set('Cookie', adminCookie)
      .send({ layout });
    expect(res.status).toBe(200);
    expect(res.body.layout).toBe(layout);
  });

  it('accepts null to clear the preference', async () => {
    await request(app)
      .patch('/api/v1/users/me/nav-layout')
      .set('Cookie', adminCookie)
      .send({ layout: 'left' });

    const res = await request(app)
      .patch('/api/v1/users/me/nav-layout')
      .set('Cookie', adminCookie)
      .send({ layout: null });
    expect(res.status).toBe(200);
    expect(res.body.layout).toBeNull();
  });

  it('writes only the caller row, ignoring any id in the body', async () => {
    // Give the admin a distinct known value, so this test proves the rep's write landed
    // on the rep and left the admin alone, rather than inheriting a null from test order.
    await request(app)
      .patch('/api/v1/users/me/nav-layout')
      .set('Cookie', adminCookie)
      .send({ layout: 'top' });

    const res = await request(app)
      .patch('/api/v1/users/me/nav-layout')
      .set('Cookie', repCookie)
      .send({ layout: 'left', id: adminId, user_id: adminId });
    expect(res.status).toBe(200);
    expect(res.body.layout).toBe('left');

    const rep = await request(app).get('/api/v1/users/me/nav-layout').set('Cookie', repCookie);
    expect(rep.body.layout).toBe('left');

    const admin = await request(app).get('/api/v1/users/me/nav-layout').set('Cookie', adminCookie);
    expect(admin.body.layout).toBe('top');
  });

  it('rejects an unsupported layout with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/nav-layout')
      .set('Cookie', adminCookie)
      .send({ layout: 'sidebar' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain(NAV_LAYOUTS.join(', '));
  });

  it('rejects a missing layout key with 400', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/nav-layout')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is reachable by a non-admin', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/nav-layout')
      .set('Cookie', repCookie)
      .send({ layout: 'hamburger' });
    expect(res.status).toBe(200);
    expect(res.body.layout).toBe('hamburger');
  });

  it('returns 401 without a session', async () => {
    const res = await request(app).patch('/api/v1/users/me/nav-layout').send({ layout: 'top' });
    expect(res.status).toBe(401);
  });
});
