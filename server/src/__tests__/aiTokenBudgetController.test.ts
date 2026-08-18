/**
 * HTTP contract tests for AI token budget endpoints.
 *
 * Covers:
 *  - GET /admin/ai/token-budgets: admin-only, returns summary shape
 *  - PATCH /admin/ai/token-budgets/org: admin-only, validates body, persists
 *  - PATCH /admin/ai/token-budgets/users/:userId: admin-only, validates body, persists
 *  - GET /ai/token-budget/me: any authenticated user, returns budget status
 *  - Role enforcement: reps receive 403 on all /admin/ai/* routes
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'atb-ctrl';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let adminCookie: string;
let repCookie: string;
let adminId: string;
let repId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Budget Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    name: admin.name,
  });

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Budget Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
});

beforeEach(async () => {
  await pool.query(`UPDATE ai_token_budgets SET monthly_limit = 0 WHERE user_id IS NULL`);
  await pool.query(`DELETE FROM ai_token_budgets WHERE user_id IN ($1, $2)`, [adminId, repId]);
  await pool.query(`DELETE FROM ai_token_usage WHERE user_id IN ($1, $2)`, [adminId, repId]);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── Role enforcement ──────────────────────────────────────────────────────────

describe('role enforcement', () => {
  it('GET /admin/ai/token-budgets returns 403 for reps', async () => {
    const res = await request(app).get('/api/v1/admin/ai/token-budgets').set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('PATCH /admin/ai/token-budgets/org returns 403 for reps', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/token-budgets/org')
      .set('Cookie', repCookie)
      .send({ monthly_limit: 100_000 });
    expect(res.status).toBe(403);
  });

  it('PATCH /admin/ai/token-budgets/users/:userId returns 403 for reps', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/ai/token-budgets/users/${repId}`)
      .set('Cookie', repCookie)
      .send({ monthly_limit: 50_000 });
    expect(res.status).toBe(403);
  });
});

// ── GET /admin/ai/token-budgets ───────────────────────────────────────────────

describe('GET /admin/ai/token-budgets', () => {
  it('returns 200 with the expected shape', async () => {
    const res = await request(app).get('/api/v1/admin/ai/token-budgets').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('org_monthly_limit');
    expect(res.body).toHaveProperty('org_used_this_month');
    expect(res.body).toHaveProperty('users');
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/v1/admin/ai/token-budgets');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /admin/ai/token-budgets/org ────────────────────────────────────────

describe('PATCH /admin/ai/token-budgets/org', () => {
  it('sets the org monthly limit', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/token-budgets/org')
      .set('Cookie', adminCookie)
      .send({ monthly_limit: 500_000 });
    expect(res.status).toBe(200);
    expect(res.body.monthly_limit).toBe(500_000);
  });

  it('accepts 0 (unlimited)', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/token-budgets/org')
      .set('Cookie', adminCookie)
      .send({ monthly_limit: 0 });
    expect(res.status).toBe(200);
    expect(res.body.monthly_limit).toBe(0);
  });

  it('returns 400 when monthly_limit is missing', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/token-budgets/org')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when monthly_limit is negative', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/token-budgets/org')
      .set('Cookie', adminCookie)
      .send({ monthly_limit: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when monthly_limit is not an integer', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/token-budgets/org')
      .set('Cookie', adminCookie)
      .send({ monthly_limit: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── PATCH /admin/ai/token-budgets/users/:userId ───────────────────────────────

describe('PATCH /admin/ai/token-budgets/users/:userId', () => {
  it('sets a per-user monthly limit', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/ai/token-budgets/users/${repId}`)
      .set('Cookie', adminCookie)
      .send({ monthly_limit: 25_000 });
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(repId);
    expect(res.body.monthly_limit).toBe(25_000);
  });

  it('accepts null to remove the per-user override', async () => {
    // First set an override.
    await request(app)
      .patch(`/api/v1/admin/ai/token-budgets/users/${repId}`)
      .set('Cookie', adminCookie)
      .send({ monthly_limit: 25_000 });
    // Then remove it.
    const res = await request(app)
      .patch(`/api/v1/admin/ai/token-budgets/users/${repId}`)
      .set('Cookie', adminCookie)
      .send({ monthly_limit: null });
    expect(res.status).toBe(200);
    expect(res.body.monthly_limit).toBeNull();
  });

  it('returns 400 when monthly_limit is missing', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/ai/token-budgets/users/${repId}`)
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── GET /ai/token-budget/me ───────────────────────────────────────────────────

describe('GET /ai/token-budget/me', () => {
  it('returns 200 with budget status for a rep', async () => {
    const res = await request(app).get('/api/v1/ai/token-budget/me').set('Cookie', repCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('limit');
    expect(res.body).toHaveProperty('used');
    expect(res.body).toHaveProperty('status');
  });

  it('returns 200 with limit=null and status=ok for an admin', async () => {
    const res = await request(app).get('/api/v1/ai/token-budget/me').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.limit).toBeNull();
    expect(res.body.status).toBe('ok');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/v1/ai/token-budget/me');
    expect(res.status).toBe(401);
  });
});
