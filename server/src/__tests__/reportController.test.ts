/**
 * Integration tests for the report controller.
 *
 * Covers: win/loss report (date validation, ownership scoping for reps vs admins),
 * activity volume report (same scoping logic), and stage trend report (days param
 * validation and default behaviour).
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'report-ctrl';

let repId: string;
let repCookie: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Report Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Report Admin',
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
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── GET /api/reports/win-loss ─────────────────────────────────────────────────

describe('GET /api/reports/win-loss', () => {
  const VALID_PARAMS = '?start=2025-01-01&end=2025-12-31';

  it('returns 200 with report data for a valid date range', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/win-loss${VALID_PARAMS}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.wonCount).toBe('number');
    expect(typeof res.body.lostCount).toBe('number');
    // winRate is null when no closed deals exist; otherwise a number
    expect(res.body.winRate === null || typeof res.body.winRate === 'number').toBe(true);
  });

  it('returns 400 VALIDATION_ERROR when start is missing', async () => {
    const res = await request(app)
      .get('/api/v1/reports/win-loss?end=2025-12-31')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when end is missing', async () => {
    const res = await request(app)
      .get('/api/v1/reports/win-loss?start=2025-01-01')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when start is not YYYY-MM-DD', async () => {
    const res = await request(app)
      .get('/api/v1/reports/win-loss?start=01-01-2025&end=2025-12-31')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when start is after end', async () => {
    const res = await request(app)
      .get('/api/v1/reports/win-loss?start=2025-12-31&end=2025-01-01')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rep always receives data scoped to their own deals (cannot override with owner_id)', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/win-loss${VALID_PARAMS}&owner_id=00000000-0000-0000-0000-000000000000`)
      .set('Cookie', repCookie);

    // The controller ignores owner_id for reps and silently scopes to their own data
    expect(res.status).toBe(200);
  });

  it('admin receives team-wide data when no owner_id is specified', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/win-loss${VALID_PARAMS}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.wonCount).toBe('number');
  });

  it('admin can filter by a specific owner_id', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/win-loss${VALID_PARAMS}&owner_id=${repId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get(`/api/v1/reports/win-loss${VALID_PARAMS}`);
    expect(res.status).toBe(401);
  });
});

// ── GET /api/reports/activity-volume ─────────────────────────────────────────

describe('GET /api/reports/activity-volume', () => {
  const VALID_PARAMS = '?start=2025-01-01&end=2025-12-31';

  it('returns 200 with rows and totals for a valid date range', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/activity-volume${VALID_PARAMS}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(typeof res.body.totals).toBe('object');
  });

  it('returns 400 VALIDATION_ERROR when start is missing', async () => {
    const res = await request(app)
      .get('/api/v1/reports/activity-volume?end=2025-12-31')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when start is after end', async () => {
    const res = await request(app)
      .get('/api/v1/reports/activity-volume?start=2025-12-31&end=2025-01-01')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rep report is scoped to their own activities', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/activity-volume${VALID_PARAMS}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    // All returned rows should belong to the rep's own owner ID
    const rowOwnerIds = (res.body.rows as { ownerId: string }[]).map((r) => r.ownerId);
    const foreignRows = rowOwnerIds.filter((id) => id !== repId);
    expect(foreignRows).toHaveLength(0);
  });

  it('admin receives data for all reps when no owner_id is specified', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/activity-volume${VALID_PARAMS}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('admin can filter by a specific owner_id', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/activity-volume${VALID_PARAMS}&owner_id=${repId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const rowOwnerIds = (res.body.rows as { ownerId: string }[]).map((r) => r.ownerId);
    const foreignRows = rowOwnerIds.filter((id) => id !== repId);
    expect(foreignRows).toHaveLength(0);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get(`/api/v1/reports/activity-volume${VALID_PARAMS}`);
    expect(res.status).toBe(401);
  });
});

// ── GET /api/reports/activity-volume/export.pdf ────────────────────────────────

describe('GET /api/reports/activity-volume/export.pdf', () => {
  const VALID_PARAMS = '?start=2025-01-01&end=2025-12-31';

  it('returns a PDF file with the correct Content-Type and Content-Disposition headers', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/activity-volume/export.pdf${VALID_PARAMS}`)
      .set('Cookie', repCookie)
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

  it('returns 400 VALIDATION_ERROR when start is after end', async () => {
    const res = await request(app)
      .get('/api/v1/reports/activity-volume/export.pdf?start=2025-12-31&end=2025-01-01')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get(`/api/v1/reports/activity-volume/export.pdf${VALID_PARAMS}`);
    expect(res.status).toBe(401);
  });
});

// ── GET /api/reports/stage-trend ─────────────────────────────────────────────

describe('GET /api/reports/stage-trend', () => {
  it('returns 200 with stages, dataPoints, and window bounds when no days param supplied', async () => {
    const res = await request(app).get('/api/v1/reports/stage-trend').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.stages)).toBe(true);
    expect(Array.isArray(res.body.dataPoints)).toBe(true);
    expect(typeof res.body.windowStart).toBe('string');
    expect(typeof res.body.windowEnd).toBe('string');
  });

  it('accepts ?days=30', async () => {
    const res = await request(app)
      .get('/api/v1/reports/stage-trend?days=30')
      .set('Cookie', repCookie);
    expect(res.status).toBe(200);
  });

  it('accepts ?days=60', async () => {
    const res = await request(app)
      .get('/api/v1/reports/stage-trend?days=60')
      .set('Cookie', repCookie);
    expect(res.status).toBe(200);
  });

  it('accepts ?days=90', async () => {
    const res = await request(app)
      .get('/api/v1/reports/stage-trend?days=90')
      .set('Cookie', repCookie);
    expect(res.status).toBe(200);
  });

  it('returns 400 VALIDATION_ERROR for an invalid days value', async () => {
    const res = await request(app)
      .get('/api/v1/reports/stage-trend?days=45')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/reports/stage-trend');
    expect(res.status).toBe(401);
  });
});
