/**
 * HTTP contract tests for AI usage dashboard endpoints. (MINCRM-459)
 *
 * Covers:
 *  - GET /admin/ai/usage/summary: admin-only, returns summary shape, validates date range
 *  - GET /admin/ai/usage/daily: admin-only, returns daily series shape
 *  - GET /admin/ai/usage/export and /export.pdf: admin-only, correct content type (MINCRM-601)
 *  - Role enforcement: reps receive 403 on all routes
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
let adminUserId: string;
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
  adminUserId = admin.id;
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

  it('GET /admin/ai/usage/export returns 403 for reps', async () => {
    const res = await request(app).get('/api/v1/admin/ai/usage/export').set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('GET /admin/ai/usage/export.pdf returns 403 for reps', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/export.pdf')
      .set('Cookie', repCookie);
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
    // Date-only strings are what the client's date pickers send.
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/summary')
      .query({ start: '2026-01-01', end: '2026-01-31' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
  });

  it('still accepts full ISO timestamps, as the OpenAPI spec advertises', async () => {
    // routes/ai.ts declares start/end as `format: date-time`, and before
    // boundary validation existed these reached `new Date(value)` directly, so
    // any parseable timestamp worked. Narrowing to date-only would have been a
    // silent break for non-first-party API consumers. MINCRM-700.
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/summary')
      .query({ start: '2026-01-01T00:00:00Z', end: '2026-01-31T23:59:59Z' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
  });

  it('returns 400 for a malformed date that no format accepts', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/summary')
      .query({ start: '2026-13-45', end: '2026-01-31' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('treats the end date as inclusive — usage recorded on the end date itself is included', async () => {
    // Regression test for the exclusive-end-date bug: resolveDateRange must
    // advance a date-only `end` param by one day internally so the caller's
    // selected end day's own data is included, not silently excluded.
    await pool.query(
      `INSERT INTO ai_token_usage_daily (user_id, usage_date, feature, input_tokens, output_tokens)
       VALUES ($1, '2099-03-15', 'nli_chat', 500, 200)
       ON CONFLICT (user_id, usage_date, feature) DO UPDATE
         SET input_tokens = 500, output_tokens = 200`,
      [adminUserId],
    );

    const res = await request(app)
      .get('/api/v1/admin/ai/usage/summary')
      .query({ start: '2099-03-15', end: '2099-03-15' })
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.input_tokens).toBeGreaterThanOrEqual(500);
    expect(res.body.output_tokens).toBeGreaterThanOrEqual(200);

    await pool.query(
      `DELETE FROM ai_token_usage_daily WHERE user_id = $1 AND usage_date = '2099-03-15'`,
      [adminUserId],
    );
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
      .query({ start: '2026-02-01', end: '2026-01-01' })
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

  it('resolves preset ranges to UTC midnight boundaries', async () => {
    // Pins the controller→service wiring: the boundaries reaching the client
    // must be UTC-midnight instants, not local-midnight ones. A local-time
    // constructor would emit a non-midnight UTC instant (e.g.
    // 2026-08-01T07:00:00.000Z from PDT), shifting the chart's day bucketing
    // for every deployment whose process timezone isn't UTC. MINCRM-700.
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/daily')
      .query({ preset: 'current_month' })
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    // A UTC month boundary is always midnight on the first of the month.
    expect(res.body.range_start).toMatch(/-01T00:00:00\.000Z$/);
    expect(res.body.range_end).toMatch(/-01T00:00:00\.000Z$/);
  });
});

describe('GET /admin/ai/usage/export', () => {
  it('returns CSV with correct headers', async () => {
    const res = await request(app).get('/api/v1/admin/ai/usage/export').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('returns 400 when start is after end', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/export')
      .query({ start: '2026-02-01', end: '2026-01-01' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/v1/admin/ai/usage/export');
    expect(res.status).toBe(401);
  });

  // The export handlers share resolveAiUsageExportData rather than the summary/
  // daily path, so the boundary validation needs its own coverage here — the
  // summary tests above exercise a different call path and would stay green if
  // the export path stopped validating. MINCRM-700.
  it('returns 400 for an unknown preset', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/export')
      .query({ preset: 'not_a_preset' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a malformed start date', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/export')
      .query({ start: 'not-a-date', end: '2026-01-31' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });
});

// ── GET /admin/ai/usage/export.pdf ────────────────────────────────────────── (MINCRM-601)

describe('GET /admin/ai/usage/export.pdf', () => {
  it('returns a PDF file with the correct Content-Type and Content-Disposition headers', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/export.pdf')
      .set('Cookie', adminCookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('returns 400 for an unknown preset', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/export.pdf')
      .query({ preset: 'not_a_preset' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when start is after end', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/usage/export.pdf')
      .query({ start: '2026-02-01', end: '2026-01-01' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/v1/admin/ai/usage/export.pdf');
    expect(res.status).toBe(401);
  });
});
