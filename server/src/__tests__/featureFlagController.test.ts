/**
 * HTTP contract tests for featureFlagController.
 * Verifies auth enforcement, response shapes, validation, and error codes.
 * Business logic is covered by featureFlagService.test.ts.
 * (MINCRM-463, MINCRM-488, MINCRM-489, MINCRM-490, MINCRM-492)
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

// (MINCRM-491) group endpoint tests added at bottom of file.

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
  await pool.query('TRUNCATE feature_flag_user_overrides RESTART IDENTITY CASCADE');
  // DELETE cascades to feature_flag_group_beta_users and sets feature_flags.group_key = null.
  await pool.query('DELETE FROM feature_flag_groups');
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
     rollout_percentage = null,
     rollout_stages = null,
     updated_by = null,
     updated_at = now()`,
  );
});

afterAll(async () => {
  await pool.query('TRUNCATE feature_flag_beta_users RESTART IDENTITY CASCADE');
  await pool.query('TRUNCATE feature_flag_user_overrides RESTART IDENTITY CASCADE');
  // DELETE cascades to feature_flag_group_beta_users and sets feature_flags.group_key = null.
  await pool.query('DELETE FROM feature_flag_groups');
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
     rollout_percentage = null,
     rollout_stages = null,
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

// ── PATCH — rollout fields (MINCRM-490) ───────────────────────────────────────

describe('PATCH /api/v1/admin/feature-flags/:key — rollout fields', () => {
  it('accepts rollout_percentage and returns it in the response', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, rollout_percentage: 42 });
    expect(res.status).toBe(200);
    expect(res.body.flag.rollout_percentage).toBe(42);
  });

  it('accepts rollout_stages and returns them in the response', async () => {
    const stages = [
      { percentage: 25, scheduled_at: '2099-01-01T00:00:00.000Z' },
      { percentage: 75, scheduled_at: '2099-06-01T00:00:00.000Z' },
    ];
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, rollout_stages: stages });
    expect(res.status).toBe(200);
    expect(res.body.flag.rollout_stages).toHaveLength(2);
  });

  it('rejects rollout_percentage out of range (> 100)', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, rollout_percentage: 101 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects rollout_stages with unsorted scheduled_at', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({
        enabled: false,
        rollout_stages: [
          { percentage: 75, scheduled_at: '2099-06-01T00:00:00.000Z' },
          { percentage: 25, scheduled_at: '2099-01-01T00:00:00.000Z' },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts null rollout_percentage to clear the rollout', async () => {
    // Set a rollout first.
    await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, rollout_percentage: 50 });

    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, rollout_percentage: null });
    expect(res.status).toBe(200);
    expect(res.body.flag.rollout_percentage).toBeNull();
  });
});

// ── User overrides API (MINCRM-492) ───────────────────────────────────────────

describe('User overrides API', () => {
  let overrideUserId: string;
  const OVERRIDE_USER_EMAIL = `${FILE_PREFIX}-override-user@example.com`;

  beforeAll(async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ($1, 'Override Test User', 'rep', '$2b$12$placeholder', 'active')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [OVERRIDE_USER_EMAIL],
    );
    overrideUserId = result.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [OVERRIDE_USER_EMAIL]);
  });

  it('GET /overrides — 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/admin/feature-flags/mobile_access/overrides');
    expect(res.status).toBe(401);
  });

  it('GET /overrides — 403 for rep', async () => {
    const res = await request(app)
      .get('/api/v1/admin/feature-flags/mobile_access/overrides')
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('GET /overrides — 200 with empty array for admin', async () => {
    const res = await request(app)
      .get('/api/v1/admin/feature-flags/mobile_access/overrides')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.overrides)).toBe(true);
    expect(res.body.overrides).toHaveLength(0);
  });

  it('PUT /overrides/:userId — 401 when unauthenticated', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/feature-flags/mobile_access/overrides/${overrideUserId}`)
      .send({ override: 'force_enabled' });
    expect(res.status).toBe(401);
  });

  it('PUT /overrides/:userId — creates force_enabled override', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/feature-flags/mobile_access/overrides/${overrideUserId}`)
      .set('Cookie', adminCookie)
      .send({ override: 'force_enabled', reason: 'VIP user' });
    expect(res.status).toBe(200);
    expect(res.body.override.override).toBe('force_enabled');
    expect(res.body.override.reason).toBe('VIP user');
  });

  it('PUT /overrides/:userId — upserts (replaces existing direction)', async () => {
    await request(app)
      .put(`/api/v1/admin/feature-flags/mobile_access/overrides/${overrideUserId}`)
      .set('Cookie', adminCookie)
      .send({ override: 'force_enabled' });

    const res = await request(app)
      .put(`/api/v1/admin/feature-flags/mobile_access/overrides/${overrideUserId}`)
      .set('Cookie', adminCookie)
      .send({ override: 'force_disabled' });
    expect(res.status).toBe(200);
    expect(res.body.override.override).toBe('force_disabled');

    const overrides = await request(app)
      .get('/api/v1/admin/feature-flags/mobile_access/overrides')
      .set('Cookie', adminCookie);
    expect(overrides.body.overrides).toHaveLength(1);
  });

  it('PUT /overrides/:userId — 400 for invalid override direction', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/feature-flags/mobile_access/overrides/${overrideUserId}`)
      .set('Cookie', adminCookie)
      .send({ override: 'invalid_direction' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PUT /overrides/:userId — 404 for unknown user', async () => {
    const res = await request(app)
      .put(
        `/api/v1/admin/feature-flags/mobile_access/overrides/00000000-0000-0000-0000-000000000000`,
      )
      .set('Cookie', adminCookie)
      .send({ override: 'force_enabled' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('DELETE /overrides/:userId — 204 removes override', async () => {
    await request(app)
      .put(`/api/v1/admin/feature-flags/mobile_access/overrides/${overrideUserId}`)
      .set('Cookie', adminCookie)
      .send({ override: 'force_enabled' });

    const res = await request(app)
      .delete(`/api/v1/admin/feature-flags/mobile_access/overrides/${overrideUserId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });

  it('DELETE /overrides/:userId — 404 when no override exists', async () => {
    const res = await request(app)
      .delete(`/api/v1/admin/feature-flags/mobile_access/overrides/${overrideUserId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_OVERRIDE_NOT_FOUND');
  });

  it('/me reflects force_enabled override on a disabled flag', async () => {
    const overrideUserCookie = makeAuthCookie({
      id: overrideUserId,
      email: OVERRIDE_USER_EMAIL,
      name: 'Override Test User',
      role: 'rep',
    });

    const before = await request(app)
      .get('/api/v1/feature-flags/me')
      .set('Cookie', overrideUserCookie);
    expect(before.body.flags['mobile_access']).toBe(false);

    await request(app)
      .put(`/api/v1/admin/feature-flags/mobile_access/overrides/${overrideUserId}`)
      .set('Cookie', adminCookie)
      .send({ override: 'force_enabled' });

    const after = await request(app)
      .get('/api/v1/feature-flags/me')
      .set('Cookie', overrideUserCookie);
    expect(after.body.flags['mobile_access']).toBe(true);
  });

  it('/me reflects force_disabled override on an enabled flag', async () => {
    const overrideUserCookie = makeAuthCookie({
      id: overrideUserId,
      email: OVERRIDE_USER_EMAIL,
      name: 'Override Test User',
      role: 'rep',
    });

    const before = await request(app)
      .get('/api/v1/feature-flags/me')
      .set('Cookie', overrideUserCookie);
    expect(before.body.flags['reporting']).toBe(true);

    await request(app)
      .put(`/api/v1/admin/feature-flags/reporting/overrides/${overrideUserId}`)
      .set('Cookie', adminCookie)
      .send({ override: 'force_disabled' });

    const after = await request(app)
      .get('/api/v1/feature-flags/me')
      .set('Cookie', overrideUserCookie);
    expect(after.body.flags['reporting']).toBe(false);
  });

  it('GET /admin/feature-flags includes override_count per flag', async () => {
    await request(app)
      .put(`/api/v1/admin/feature-flags/mobile_access/overrides/${overrideUserId}`)
      .set('Cookie', adminCookie)
      .send({ override: 'force_enabled' });

    const res = await request(app).get('/api/v1/admin/feature-flags').set('Cookie', adminCookie);
    const mobileFlag = (
      res.body.flags as Array<{
        flag_key: string;
        override_count: { force_enabled: number; force_disabled: number };
      }>
    ).find((f) => f.flag_key === 'mobile_access');
    expect(mobileFlag?.override_count.force_enabled).toBe(1);
    expect(mobileFlag?.override_count.force_disabled).toBe(0);
  });
});

// ── GET /api/v1/admin/feature-flags/groups (MINCRM-491) ───────────────────────

describe('GET /api/v1/admin/feature-flags/groups', () => {
  it('returns 401 with no auth cookie', async () => {
    const res = await request(app).get('/api/v1/admin/feature-flags/groups');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a rep role', async () => {
    const res = await request(app)
      .get('/api/v1/admin/feature-flags/groups')
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('returns 200 with an empty groups array when no groups exist', async () => {
    const res = await request(app)
      .get('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.groups)).toBe(true);
    expect(res.body.groups.length).toBe(0);
  });

  it('returns created groups with member_count and beta_user_count', async () => {
    await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'ff-ctrl-list-group', label: 'List Group' });

    const res = await request(app)
      .get('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const group = (
      res.body.groups as Array<{ group_key: string; member_count: number; beta_user_count: number }>
    ).find((g) => g.group_key === 'ff-ctrl-list-group');
    expect(group).toBeDefined();
    expect(group?.member_count).toBe(0);
    expect(group?.beta_user_count).toBe(0);
  });
});

// ── POST /api/v1/admin/feature-flags/groups (MINCRM-491) ──────────────────────

describe('POST /api/v1/admin/feature-flags/groups', () => {
  it('returns 401 with no auth cookie', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .send({ group_key: 'test-group', label: 'Test' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a rep role', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', repCookie)
      .send({ group_key: 'test-group', label: 'Test' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when group_key is missing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ label: 'No Key' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when label is missing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'no-label' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when group_key contains uppercase letters', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'UPPERCASE', label: 'Bad Key' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a group and returns 201 with the new group', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'ff-ctrl-create', label: 'Created Group', description: 'A group' });
    expect(res.status).toBe(201);
    expect(res.body.group.group_key).toBe('ff-ctrl-create');
    expect(res.body.group.label).toBe('Created Group');
    expect(res.body.group.enabled).toBe(true);
    expect(res.body.group.member_count).toBe(0);
  });

  it('returns 409 when group_key already exists', async () => {
    await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'ff-ctrl-dup', label: 'First' });

    const res = await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'ff-ctrl-dup', label: 'Second' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FLAG_GROUP_DUPLICATE_KEY');
  });
});

// ── PATCH /api/v1/admin/feature-flags/groups/:key (MINCRM-491) ────────────────

describe('PATCH /api/v1/admin/feature-flags/groups/:key', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'ff-ctrl-patch-group', label: 'Patch Group' });
  });

  it('returns 401 with no auth cookie', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/groups/ff-ctrl-patch-group')
      .send({ enabled: false });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a rep role', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/groups/ff-ctrl-patch-group')
      .set('Cookie', repCookie)
      .send({ enabled: false });
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown group key', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/groups/totally-unknown')
      .set('Cookie', adminCookie)
      .send({ enabled: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('FLAG_GROUP_NOT_FOUND');
  });

  it('disables a group and returns 200 with updated group', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/groups/ff-ctrl-patch-group')
      .set('Cookie', adminCookie)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.group.enabled).toBe(false);
    expect(res.body.group.group_key).toBe('ff-ctrl-patch-group');
  });

  it('updates the label', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/groups/ff-ctrl-patch-group')
      .set('Cookie', adminCookie)
      .send({ label: 'Renamed Group' });
    expect(res.status).toBe(200);
    expect(res.body.group.label).toBe('Renamed Group');
  });

  it('returns 400 when body is empty (at least one field required)', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/groups/ff-ctrl-patch-group')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── DELETE /api/v1/admin/feature-flags/groups/:key (MINCRM-491) ──────────────

describe('DELETE /api/v1/admin/feature-flags/groups/:key', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'ff-ctrl-del-group', label: 'Delete Group' });
  });

  it('returns 401 with no auth cookie', async () => {
    const res = await request(app).delete('/api/v1/admin/feature-flags/groups/ff-ctrl-del-group');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a rep role', async () => {
    const res = await request(app)
      .delete('/api/v1/admin/feature-flags/groups/ff-ctrl-del-group')
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown group key', async () => {
    const res = await request(app)
      .delete('/api/v1/admin/feature-flags/groups/not-a-real-group')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('FLAG_GROUP_NOT_FOUND');
  });

  it('deletes an empty group and returns 204', async () => {
    const res = await request(app)
      .delete('/api/v1/admin/feature-flags/groups/ff-ctrl-del-group')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });

  it('returns 409 when the group has member flags', async () => {
    await pool.query(
      `UPDATE feature_flags SET group_key = 'ff-ctrl-del-group' WHERE flag_key = 'mobile_access'`,
    );
    const res = await request(app)
      .delete('/api/v1/admin/feature-flags/groups/ff-ctrl-del-group')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FLAG_GROUP_HAS_MEMBERS');
  });
});

// ── GET /api/v1/admin/feature-flags/groups/:key/beta-users (MINCRM-491) ───────

describe('GET /api/v1/admin/feature-flags/groups/:key/beta-users', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'ff-ctrl-gbeta-group', label: 'Group Beta Group' });
  });

  it('returns 401 with no auth cookie', async () => {
    const res = await request(app).get(
      '/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-group/beta-users',
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for a rep role', async () => {
    const res = await request(app)
      .get('/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-group/beta-users')
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('returns 200 with empty users array when none enrolled', async () => {
    const res = await request(app)
      .get('/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-group/beta-users')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBe(0);
  });

  it('returns 404 for unknown group key', async () => {
    const res = await request(app)
      .get('/api/v1/admin/feature-flags/groups/nonexistent-group/beta-users')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('FLAG_GROUP_NOT_FOUND');
  });
});

// ── POST /api/v1/admin/feature-flags/groups/:key/beta-users (MINCRM-491) ──────

describe('POST /api/v1/admin/feature-flags/groups/:key/beta-users', () => {
  let groupBetaTargetId: string;

  beforeAll(async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ($1, 'Group Beta Target Ctrl', 'rep', '$2b$12$placeholder', 'active')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [`${FILE_PREFIX}-gbeta-target@example.com`],
    );
    groupBetaTargetId = result.rows[0].id;
  });

  beforeEach(async () => {
    await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'ff-ctrl-gbeta-enroll', label: 'Enroll Group' });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [
      `${FILE_PREFIX}-gbeta-target@example.com`,
    ]);
  });

  it('enrolls a user in the group beta and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-enroll/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: groupBetaTargetId });
    expect(res.status).toBe(201);
    expect(res.body.user.user_id).toBe(groupBetaTargetId);
  });

  it('returns 400 when userId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-enroll/beta-users')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when user does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-enroll/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns 409 when user is already enrolled', async () => {
    await request(app)
      .post('/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-enroll/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: groupBetaTargetId });

    const res = await request(app)
      .post('/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-enroll/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: groupBetaTargetId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GROUP_BETA_USER_ALREADY_ENROLLED');
  });
});

// ── DELETE /api/v1/admin/feature-flags/groups/:key/beta-users/:userId (MINCRM-491)

describe('DELETE /api/v1/admin/feature-flags/groups/:key/beta-users/:userId', () => {
  let groupBetaRemoveTargetId: string;

  beforeAll(async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ($1, 'Group Beta Remove Ctrl', 'rep', '$2b$12$placeholder', 'active')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [`${FILE_PREFIX}-gbeta-remove@example.com`],
    );
    groupBetaRemoveTargetId = result.rows[0].id;
  });

  beforeEach(async () => {
    await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'ff-ctrl-gbeta-remove', label: 'Remove Group' });

    await request(app)
      .post('/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-remove/beta-users')
      .set('Cookie', adminCookie)
      .send({ userId: groupBetaRemoveTargetId });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [
      `${FILE_PREFIX}-gbeta-remove@example.com`,
    ]);
  });

  it('returns 401 with no auth cookie', async () => {
    const res = await request(app).delete(
      `/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-remove/beta-users/${groupBetaRemoveTargetId}`,
    );
    expect(res.status).toBe(401);
  });

  it('removes the user and returns 204', async () => {
    const res = await request(app)
      .delete(
        `/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-remove/beta-users/${groupBetaRemoveTargetId}`,
      )
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });

  it('returns 404 when user was not enrolled', async () => {
    const res = await request(app)
      .delete(
        '/api/v1/admin/feature-flags/groups/ff-ctrl-gbeta-remove/beta-users/00000000-0000-0000-0000-000000000000',
      )
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('GROUP_BETA_USER_NOT_ENROLLED');
  });

  it('returns 404 FLAG_GROUP_NOT_FOUND for unknown group key', async () => {
    const res = await request(app)
      .delete(
        `/api/v1/admin/feature-flags/groups/nonexistent-group/beta-users/${groupBetaRemoveTargetId}`,
      )
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('FLAG_GROUP_NOT_FOUND');
  });
});

// ── PATCH /:key assigns group_key via existing endpoint (MINCRM-491) ──────────

describe('PATCH /api/v1/admin/feature-flags/:key group assignment', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/v1/admin/feature-flags/groups')
      .set('Cookie', adminCookie)
      .send({ group_key: 'ff-ctrl-assign-group', label: 'Assign Group' });
  });

  it('assigns a flag to an existing group', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, group_key: 'ff-ctrl-assign-group' });
    expect(res.status).toBe(200);
    expect(res.body.flag.group_key).toBe('ff-ctrl-assign-group');
  });

  it('clears group assignment when group_key is null', async () => {
    await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, group_key: 'ff-ctrl-assign-group' });

    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, group_key: null });
    expect(res.status).toBe(200);
    expect(res.body.flag.group_key).toBeNull();
  });

  it('returns 400 when group_key references a non-existent group', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: false, group_key: 'does-not-exist' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FLAG_GROUP_NOT_FOUND');
  });

  it('/me reflects group gate — group disabled blocks member flag for non-beta user', async () => {
    // Assign mobile_access to the group, enable the flag itself.
    await request(app)
      .patch('/api/v1/admin/feature-flags/mobile_access')
      .set('Cookie', adminCookie)
      .send({ enabled: true, group_key: 'ff-ctrl-assign-group' });

    // Disable the group.
    await request(app)
      .patch('/api/v1/admin/feature-flags/groups/ff-ctrl-assign-group')
      .set('Cookie', adminCookie)
      .send({ enabled: false });

    __clearCacheForTest();

    // Rep (repCookie) is not in the group beta — should see mobile_access as false.
    const res = await request(app).get('/api/v1/feature-flags/me').set('Cookie', repCookie);
    expect(res.status).toBe(200);
    expect(res.body.flags['mobile_access']).toBe(false);
  });
});
