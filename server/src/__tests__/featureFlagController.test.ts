/**
 * HTTP contract tests for featureFlagController.
 * Verifies auth enforcement, response shapes, validation, and error codes.
 * Business logic is covered by featureFlagService.test.ts.
 * (MINCRM-463, MINCRM-488, MINCRM-489)
 *
 * Run: npm test --workspace=minicrm-server
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { __clearCacheForTest } from '../services/featureFlagService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'ff-ctrl';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'FF Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'FF Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

beforeEach(async () => {
  __clearCacheForTest();
  await pool.query('TRUNCATE feature_flag_beta_users RESTART IDENTITY CASCADE');
  // Reset flags to seeded defaults before each test.
  await pool.query(
    `UPDATE feature_flags
     SET enabled = CASE
       WHEN flag_key IN ('mobile_access', 'demo_data') THEN false
       ELSE true
     END,
     role_overrides = CASE
       WHEN flag_key IN ('reporting', 'csv_export') THEN '{"admin":true,"rep":true}'::jsonb
       ELSE null
     END,
     enable_at = null,
     updated_by = null,
     updated_at = now()`,
  );
});

afterAll(async () => {
  await pool.query('TRUNCATE feature_flag_beta_users RESTART IDENTITY CASCADE');
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  // Restore flags.
  await pool.query(
    `UPDATE feature_flags
     SET enabled = CASE
       WHEN flag_key IN ('mobile_access', 'demo_data') THEN false
       ELSE true
     END,
     role_overrides = CASE
       WHEN flag_key IN ('reporting', 'csv_export') THEN '{"admin":true,"rep":true}'::jsonb
       ELSE null
     END,
     enable_at = null,
     updated_by = null,
     updated_at = now()`,
  );
});

// ── GET /api/v1/admin/feature-flags ──────────────────────────────────────────

describe('GET /api/v1/admin/feature-flags', () => {
  it('returns 401 with no auth cookie', async () => {
    const res = await request(app).get('/api/v1/admin/feature-flags');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a rep role', async () => {
    const res = await request(app).get('/api/v1/admin/feature-flags').set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('returns 200 with flags array for admin', async () => {
    const res = await request(app).get('/api/v1/admin/feature-flags').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.flags)).toBe(true);
    expect(res.body.flags.length).toBeGreaterThanOrEqual(18);
  });

  it('each flag has required fields', async () => {
    const res = await request(app).get('/api/v1/admin/feature-flags').set('Cookie', adminCookie);
    const first = res.body.flags[0];
    expect(first).toHaveProperty('flag_key');
    expect(first).toHaveProperty('label');
    expect(first).toHaveProperty('description');
    expect(first).toHaveProperty('category');
    expect(first).toHaveProperty('enabled');
    expect(first).toHaveProperty('active_user_count');
    expect(typeof first.active_user_count).toBe('number');
  });
});

// ── PATCH /api/v1/admin/feature-flags/:key ────────────────────────────────────

describe('PATCH /api/v1/admin/feature-flags/:key', () => {
  it('returns 401 with no auth cookie', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/notes')
      .send({ enabled: false });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a rep role', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/notes')
      .set('Cookie', repCookie)
      .send({ enabled: false });
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown flag key', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/totally_unknown_flag')
      .set('Cookie', adminCookie)
      .send({ enabled: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('FEATURE_FLAG_NOT_FOUND');
  });

  it('returns 400 when enabled is missing from the body', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/notes')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/notes')
      .set('Cookie', adminCookie)
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('disables a flag and returns updated flag', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/notes')
      .set('Cookie', adminCookie)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.flag.flag_key).toBe('notes');
    expect(res.body.flag.enabled).toBe(false);
    expect(res.body.flag).toHaveProperty('active_user_count');
  });

  it('enables a disabled flag', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.flag.enabled).toBe(true);
  });

  it('updates role_overrides when provided', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/reporting')
      .set('Cookie', adminCookie)
      .send({ enabled: true, role_overrides: { admin: true, rep: false } });
    expect(res.status).toBe(200);
    expect(res.body.flag.role_overrides.rep).toBe(false);
    expect(res.body.flag.role_overrides.admin).toBe(true);
  });

  it('does not allow DELETE — returns 404', async () => {
    const res = await request(app)
      .delete('/api/v1/admin/feature-flags/notes')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  // MINCRM-488: enable_at scheduling
  it('accepts a future enable_at and returns it in the response', async () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, enable_at: futureDate });
    expect(res.status).toBe(200);
    expect(res.body.flag.enable_at).toBe(futureDate);
  });

  it('returns 400 when enable_at is a past date', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, enable_at: pastDate });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('clears enable_at when null is passed', async () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, enable_at: futureDate });

    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, enable_at: null });
    expect(res.status).toBe(200);
    expect(res.body.flag.enable_at).toBeNull();
  });

  it('response includes beta_user_count field', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/notes')
      .set('Cookie', adminCookie)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(typeof res.body.flag.beta_user_count).toBe('number');
  });
});

// ── GET /api/v1/admin/feature-flags/:key/beta-users ───────────────────────────

describe('GET /api/v1/admin/feature-flags/:key/beta-users', () => {
  it('returns 401 with no auth cookie', async () => {
    const res = await request(app).get('/api/v1/admin/feature-flags/mobile_access/beta-users');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a rep role', async () => {
    const res = await request(app)
      .get('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('returns 200 with empty users array when none enrolled', async () => {
    const res = await request(app)
      .get('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBe(0);
  });
});

// ── POST /api/v1/admin/feature-flags/:key/beta-users ─────────────────────────

describe('POST /api/v1/admin/feature-flags/:key/beta-users', () => {
  let targetUserId: string;

  beforeAll(async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ($1, 'Beta Target', 'rep', '$2b$12$placeholder', 'active')
       RETURNING id`,
      [`${FILE_PREFIX}-target@example.com`],
    );
    targetUserId = result.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [`${FILE_PREFIX}-target@example.com`]);
  });

  it('returns 401 with no auth cookie', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .send({ userId: targetUserId });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a rep role', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .set('Cookie', repCookie)
      .send({ userId: targetUserId });
    expect(res.status).toBe(403);
  });

  it('returns 400 when userId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when userId is not a UUID', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when user does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('enrolls a user and returns 201 with the entry', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: targetUserId });
    expect(res.status).toBe(201);
    expect(res.body.user.user_id).toBe(targetUserId);
    expect(res.body.user).toHaveProperty('added_at');
  });

  it('returns 409 when the same user is enrolled twice', async () => {
    await request(app)
      .post('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: targetUserId });

    const res = await request(app)
      .post('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: targetUserId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BETA_USER_ALREADY_ENROLLED');
  });
});

// ── DELETE /api/v1/admin/feature-flags/:key/beta-users/:userId ───────────────

describe('DELETE /api/v1/admin/feature-flags/:key/beta-users/:userId', () => {
  let targetUserId: string;

  beforeAll(async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ($1, 'Beta Delete Target', 'rep', '$2b$12$placeholder', 'active')
       RETURNING id`,
      [`${FILE_PREFIX}-del-target@example.com`],
    );
    targetUserId = result.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [
      `${FILE_PREFIX}-del-target@example.com`,
    ]);
  });

  it('returns 401 with no auth cookie', async () => {
    const res = await request(app).delete(
      `/api/v1/admin/feature-flags/mobile_access/beta-users/${targetUserId}`,
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for a rep role', async () => {
    const res = await request(app)
      .delete(`/api/v1/admin/feature-flags/mobile_access/beta-users/${targetUserId}`)
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('returns 404 when user is not enrolled', async () => {
    const res = await request(app)
      .delete(`/api/v1/admin/feature-flags/mobile_access/beta-users/${targetUserId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BETA_USER_NOT_ENROLLED');
  });

  it('returns 204 after successfully removing an enrollment', async () => {
    // Enroll first.
    await request(app)
      .post('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: targetUserId });

    const res = await request(app)
      .delete(`/api/v1/admin/feature-flags/mobile_access/beta-users/${targetUserId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });
});

// ── GET /api/v1/admin/feature-flags (beta_user_count) ────────────────────────

describe('GET /api/v1/admin/feature-flags includes beta_user_count', () => {
  it('includes beta_user_count on each flag', async () => {
    const res = await request(app).get('/api/v1/admin/feature-flags').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    for (const flag of res.body.flags as Array<{ beta_user_count: unknown }>) {
      expect(typeof flag.beta_user_count).toBe('number');
    }
  });
});

// ── GET /api/v1/feature-flags/me reflects beta access ────────────────────────

describe('GET /api/v1/feature-flags/me reflects beta enrollment', () => {
  let betaUserId: string;
  let betaUserCookie: string;

  beforeAll(async () => {
    const { createUser } = await import('../services/userService.js');
    const { makeAuthCookie } = await import('./testUtils.js');
    const user = await createUser({
      email: `${FILE_PREFIX}-betame@example.com`,
      name: 'Beta Me User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    betaUserId = user.id;
    betaUserCookie = makeAuthCookie({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [`${FILE_PREFIX}-betame@example.com`]);
  });

  it('/me shows mobile_access as disabled before enrollment', async () => {
    const res = await request(app).get('/api/v1/feature-flags/me').set('Cookie', betaUserCookie);
    expect(res.status).toBe(200);
    expect(res.body.flags['mobile_access']).toBe(false);
  });

  it('/me shows mobile_access as enabled after beta enrollment', async () => {
    await request(app)
      .post('/api/v1/admin/feature-flags/mobile_access/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: betaUserId });

    const res = await request(app).get('/api/v1/feature-flags/me').set('Cookie', betaUserCookie);
    expect(res.status).toBe(200);
    expect(res.body.flags['mobile_access']).toBe(true);
  });
});
