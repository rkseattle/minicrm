/**
 * Unit/integration tests for auth, requireRole, and asyncHandler middleware.
 * (MINCRM-295)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';
import jwt from 'jsonwebtoken';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';

const FILE_PREFIX = 'mw';

let repCookie: string;
let repId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'MW Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── authenticate middleware ───────────────────────────────────────────────────

describe('authenticate middleware', () => {
  it('returns 401 AUTH_MISSING_TOKEN when no cookie is present', async () => {
    const res = await request(app).get('/api/v1/contacts');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_MISSING_TOKEN');
  });

  it('returns 401 AUTH_INVALID_TOKEN for a tampered token', async () => {
    const res = await request(app)
      .get('/api/v1/contacts')
      .set('Cookie', `${AUTH_COOKIE_NAME}=not.a.valid.jwt`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('returns 401 AUTH_INVALID_TOKEN for a token signed with the wrong secret', async () => {
    const badToken = jwt.sign({ id: repId, email: 'x', name: 'x', role: 'rep' }, 'wrong-secret');
    const res = await request(app)
      .get('/api/v1/contacts')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${badToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('returns 401 USER_INACTIVE when the user has been deactivated', async () => {
    const inactive = await createUser({
      email: `${FILE_PREFIX}-inactive@example.com`,
      name: 'Inactive',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'inactive',
    });
    const cookie = makeAuthCookie({
      id: inactive.id,
      email: inactive.email,
      name: inactive.name,
      role: inactive.role,
    });
    const res = await request(app).get('/api/v1/contacts').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('USER_INACTIVE');
  });

  it('returns 401 USER_INACTIVE for a token whose user id does not exist', async () => {
    const cookie = makeAuthCookie({
      id: '00000000-0000-0000-0000-000000000000',
      email: 'ghost@example.com',
      name: 'Ghost',
      role: 'rep',
    });
    const res = await request(app).get('/api/v1/contacts').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('USER_INACTIVE');
  });

  it('returns 403 PASSWORD_CHANGE_REQUIRED when must_change_password is set', async () => {
    const mustChange = await createUser({
      email: `${FILE_PREFIX}-mustchange@example.com`,
      name: 'Must Change',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    await pool.query('UPDATE users SET must_change_password = true WHERE id = $1', [mustChange.id]);
    const cookie = makeAuthCookie({
      id: mustChange.id,
      email: mustChange.email,
      name: mustChange.name,
      role: mustChange.role,
    });
    const res = await request(app).get('/api/v1/contacts').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('allows the change-password route through when must_change_password is set', async () => {
    const mustChange = await createUser({
      email: `${FILE_PREFIX}-mustchange2@example.com`,
      name: 'Must Change 2',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    await pool.query('UPDATE users SET must_change_password = true WHERE id = $1', [mustChange.id]);
    const cookie = makeAuthCookie({
      id: mustChange.id,
      email: mustChange.email,
      name: mustChange.name,
      role: mustChange.role,
    });
    // POST change-password with a bad body — we just need it to get past authenticate (not 403)
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).not.toBe(403);
  });

  it('returns 401 AUTH_INVALID_TOKEN for a token issued before a password reset', async () => {
    const user = await createUser({
      email: `${FILE_PREFIX}-pwreset@example.com`,
      name: 'PW Reset',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    // Issue token with iat in the past (1 second before "now")
    const oldIat = Math.floor(Date.now() / 1000) - 10;
    const oldToken = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, iat: oldIat },
      process.env.JWT_SECRET ?? '',
    );
    // Simulate a password reset by setting password_changed_at to now
    await pool.query('UPDATE users SET password_changed_at = NOW() WHERE id = $1', [user.id]);
    const res = await request(app)
      .get('/api/v1/contacts')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${oldToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('passes through and sets req.user for a valid active user', async () => {
    const res = await request(app).get('/api/v1/contacts').set('Cookie', repCookie);
    // Contacts list returns 200 — authenticate passed control to the handler
    expect(res.status).toBe(200);
  });
});

// ── requireRole middleware ────────────────────────────────────────────────────

describe('requireRole middleware', () => {
  it('returns 403 AUTH_FORBIDDEN when a rep hits an admin-only route', async () => {
    const res = await request(app).get('/api/v1/admin/webhooks').set('Cookie', repCookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('allows an admin through an admin-only route', async () => {
    const admin = await createUser({
      email: `${FILE_PREFIX}-admin@example.com`,
      name: 'MW Admin',
      role: 'admin',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const adminCookie = makeAuthCookie({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    });
    const res = await request(app).get('/api/v1/admin/webhooks').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
  });
});

// ── asyncHandler middleware ───────────────────────────────────────────────────

describe('asyncHandler middleware', () => {
  it('forwards an unhandled async error to the Express error handler (500)', async () => {
    // Trigger a route that throws — passing a non-UUID to a :id param causes the
    // service to throw a DB error that asyncHandler forwards to the error handler.
    const res = await request(app).get('/api/v1/contacts/not-a-uuid').set('Cookie', repCookie);
    expect(res.status).toBe(500);
  });
});
