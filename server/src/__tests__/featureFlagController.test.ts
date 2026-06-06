/**
 * HTTP contract tests for featureFlagController. (MINCRM-463)
 *
 * Verifies auth enforcement, response shapes, validation, and error codes.
 * Business logic is covered by featureFlagService.test.ts.
 *
 * Run: npm test --workspace=minicrm-server
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
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
     updated_by = null,
     updated_at = now()`,
  );
});

afterAll(async () => {
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
});
