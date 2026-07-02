/**
 * HTTP contract tests for AI usage dashboard endpoints. (MINCRM-459)
 *
 * Covers:
 *  - GET /admin/ai/usage/summary: admin-only, returns summary shape, validates date range
 *  - GET /admin/ai/usage/daily: admin-only, returns daily series shape
 *  - Role enforcement: reps receive 403 on both routes
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'ai-usage-ctrl';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Usage Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    name: admin.name,
  });

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Usage Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('role enforcement', () => {
  it('GET /admin/ai/usage/summary returns 403 for reps', async () => {
    const res = await request(app).get('/api/v1/admin/ai/usage/summary').set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('GET /admin/ai/usage/daily returns 403 for reps', async () => {
    const res = await request(app).get('/api/v1/admin/ai/usage/daily').set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/ai/usage/summary', () => {
  it('returns 200 with the expected shape for the default preset', async () => {
    const res = await request(app).get('/api/v1/admin/ai/usage/summary').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('input_tokens');
    expect(res.body).toHaveProperty('output_tokens');
    expect(res.body).toHaveProperty('estimated_cost_cents');
    expect(res.body).toHaveProperty('prior_period_estimated_cost_cents');
    expect(Array.isArray(res.body.per_user)).toBe(true);
    expect(Array.isArray(res.body.per_feature)).toBe(true);
  });

  it('accepts each known preset', async () => {
    for (const preset of ['current_month', 'last_month', 'last_3_months']) {
      const res = await request(app)
        .get('/api/v1/admin/ai/usage/summary')
        .query({ preset })
        .set('Cookie', adminCookie);
      expect(res.status).toBe(200);
    }
  });

  it('accepts an explicit start/end range', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/summary')
      .query({ start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
  });

  it('returns 400 for an unknown preset', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/summary')
      .query({ preset: 'not_a_preset' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when start is after end', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/summary')
      .query({ start: '2026-02-01T00:00:00Z', end: '2026-01-01T00:00:00Z' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when only start is provided (no silent preset fallback)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/summary')
      .query({ start: '2026-01-01' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when only end is provided (no silent preset fallback)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/summary')
      .query({ end: '2026-01-31' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('treats a date-only end param as inclusive of that day', async () => {
    // A single-day range (start === end as date-only strings) must be valid,
    // since end is advanced by one day internally to become the exclusive bound.
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/summary')
      .query({ start: '2026-01-01', end: '2026-01-01' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/v1/admin/ai/usage/summary');
    expect(res.status).toBe(401);
  });
});

describe('GET /admin/ai/usage/daily', () => {
  it('returns 200 with a points array', async () => {
    const res = await request(app).get('/api/v1/admin/ai/usage/daily').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.points)).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/v1/admin/ai/usage/daily');
    expect(res.status).toBe(401);
  });
});
