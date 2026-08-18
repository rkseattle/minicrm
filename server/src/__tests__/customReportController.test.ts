/**
 * Integration tests for customReportController — HTTP layer for custom reports.
 *
 * Covers request/response shaping, auth enforcement, visibility permissions,
 * validation error paths, and the ad-hoc /run and /export endpoints.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'cr-ctrl';

const BASIC_CONFIG = {
  selected_fields: ['first_name', 'last_name'],
  filters: [],
};

let _adminId: string;
let adminCookie: string;
let _repId: string;
let repCookie: string;
let _rep2Id: string;
let rep2Cookie: string;

async function truncateReports(): Promise<void> {
  await pool.query(`DELETE FROM custom_reports WHERE name LIKE $1`, [`${FILE_PREFIX}-%`]);
}

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'CR Ctrl Admin',
    role: 'admin',
    status: 'active',
    passwordHash: null,
  });
  _adminId = admin.id;
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'CR Ctrl Rep',
    role: 'rep',
    status: 'active',
    passwordHash: null,
  });
  _repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const rep2 = await createUser({
    email: `${FILE_PREFIX}-rep2@example.com`,
    name: 'CR Ctrl Rep2',
    role: 'rep',
    status: 'active',
    passwordHash: null,
  });
  _rep2Id = rep2.id;
  rep2Cookie = makeAuthCookie({ id: rep2.id, email: rep2.email, name: rep2.name, role: rep2.role });
});

beforeEach(async () => {
  await truncateReports();
});

afterAll(async () => {
  await truncateReports();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('auth guard', () => {
  it('returns 401 on GET / when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/reports/custom');
    expect(res.status).toBe(401);
  });

  it('returns 401 on POST / when unauthenticated', async () => {
    const res = await request(app).post('/api/v1/reports/custom').send({});
    expect(res.status).toBe(401);
  });
});

// ── GET / ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/reports/custom', () => {
  it('returns empty reports array when none exist', async () => {
    const res = await request(app).get('/api/v1/reports/custom').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const ours = res.body.reports.filter((r: { name: string }) => r.name.startsWith(FILE_PREFIX));
    expect(ours).toHaveLength(0);
  });

  it('admin sees all reports including private ones', async () => {
    await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', repCookie)
      .send({
        name: `${FILE_PREFIX}-private`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'private',
      });

    const res = await request(app).get('/api/v1/reports/custom').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const ours = res.body.reports.filter((r: { name: string }) => r.name.startsWith(FILE_PREFIX));
    expect(ours).toHaveLength(1);
  });

  it('rep does not see another rep private report', async () => {
    await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', repCookie)
      .send({
        name: `${FILE_PREFIX}-rep-private`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'private',
      });

    const res = await request(app).get('/api/v1/reports/custom').set('Cookie', rep2Cookie);
    expect(res.status).toBe(200);
    const ours = res.body.reports.filter((r: { name: string }) => r.name.startsWith(FILE_PREFIX));
    expect(ours).toHaveLength(0);
  });
});

// ── POST / ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/reports/custom', () => {
  it('creates a report and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-create`, entity_type: 'contact', config: BASIC_CONFIG });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(`${FILE_PREFIX}-create`);
    expect(res.body.entity_type).toBe('contact');
  });

  it('returns 400 for invalid entity_type in config', async () => {
    const res = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-bad`, entity_type: 'foobar', config: BASIC_CONFIG });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'contact', config: BASIC_CONFIG });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an invalid report field', async () => {
    const res = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({
        name: `${FILE_PREFIX}-badfield`,
        entity_type: 'contact',
        config: { selected_fields: ['nonexistent_field'], filters: [] },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REPORT_FIELD');
  });

  it('returns 409 on duplicate name', async () => {
    await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-dup`, entity_type: 'contact', config: BASIC_CONFIG });

    const res = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-dup`, entity_type: 'contact', config: BASIC_CONFIG });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOM_REPORT_NAME_CONFLICT');
  });
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

describe('GET /api/v1/reports/custom/:id', () => {
  it('returns a report by id', async () => {
    const createRes = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-get`, entity_type: 'contact', config: BASIC_CONFIG });
    const id = createRes.body.id as string;

    const res = await request(app).get(`/api/v1/reports/custom/${id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/v1/reports/custom/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── PATCH /:id ────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/reports/custom/:id', () => {
  it('updates a report name', async () => {
    const createRes = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-patch-orig`, entity_type: 'contact', config: BASIC_CONFIG });
    const id = createRes.body.id as string;

    const res = await request(app)
      .patch(`/api/v1/reports/custom/${id}`)
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-patch-new` });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(`${FILE_PREFIX}-patch-new`);
  });

  it('returns 400 for invalid config field', async () => {
    const createRes = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({
        name: `${FILE_PREFIX}-patch-badfield`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
      });
    const id = createRes.body.id as string;

    const res = await request(app)
      .patch(`/api/v1/reports/custom/${id}`)
      .set('Cookie', adminCookie)
      .send({ config: { selected_fields: ['nonexistent_field'], filters: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REPORT_FIELD');
  });

  it('returns 403 when rep tries to update another rep private report', async () => {
    const createRes = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', repCookie)
      .send({
        name: `${FILE_PREFIX}-patch-priv`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'private',
      });
    const id = createRes.body.id as string;

    const res = await request(app)
      .patch(`/api/v1/reports/custom/${id}`)
      .set('Cookie', rep2Cookie)
      .send({ name: `${FILE_PREFIX}-patch-priv-hijack` });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REPORT_FORBIDDEN');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .patch('/api/v1/reports/custom/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-patch-404` });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 on name conflict', async () => {
    await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-conflict-a`, entity_type: 'contact', config: BASIC_CONFIG });
    const createRes = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-conflict-b`, entity_type: 'contact', config: BASIC_CONFIG });
    const id = createRes.body.id as string;

    const res = await request(app)
      .patch(`/api/v1/reports/custom/${id}`)
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-conflict-a` });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOM_REPORT_NAME_CONFLICT');
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('DELETE /api/v1/reports/custom/:id', () => {
  it('deletes a report and returns 200', async () => {
    const createRes = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-delete`, entity_type: 'contact', config: BASIC_CONFIG });
    const id = createRes.body.id as string;

    const res = await request(app)
      .delete(`/api/v1/reports/custom/${id}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .delete('/api/v1/reports/custom/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when rep tries to delete another rep private report', async () => {
    const createRes = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', repCookie)
      .send({
        name: `${FILE_PREFIX}-del-priv`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'private',
      });
    const id = createRes.body.id as string;

    const res = await request(app).delete(`/api/v1/reports/custom/${id}`).set('Cookie', rep2Cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REPORT_FORBIDDEN');
  });
});

// ── POST /:id/run ─────────────────────────────────────────────────────────────

describe('POST /api/v1/reports/custom/:id/run', () => {
  it('executes a saved report and returns rows and columns', async () => {
    const createRes = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-run`, entity_type: 'contact', config: BASIC_CONFIG });
    const id = createRes.body.id as string;

    const res = await request(app)
      .post(`/api/v1/reports/custom/${id}/run`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.columns)).toBe(true);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('returns 404 for unknown report id', async () => {
    const res = await request(app)
      .post('/api/v1/reports/custom/00000000-0000-0000-0000-000000000000/run')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── POST /run (ad-hoc) ────────────────────────────────────────────────────────

describe('POST /api/v1/reports/custom/run', () => {
  it('executes an ad-hoc report config and returns rows and columns', async () => {
    const res = await request(app)
      .post('/api/v1/reports/custom/run')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'contact', config: BASIC_CONFIG });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.columns)).toBe(true);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('returns 400 for invalid entity_type', async () => {
    const res = await request(app)
      .post('/api/v1/reports/custom/run')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'notanentity', config: BASIC_CONFIG });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid config', async () => {
    const res = await request(app)
      .post('/api/v1/reports/custom/run')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'contact', config: 'not-an-object' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid report field', async () => {
    const res = await request(app)
      .post('/api/v1/reports/custom/run')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'contact', config: { selected_fields: ['bad_field'], filters: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REPORT_FIELD');
  });

  it('returns 400 for aggregate without group_by', async () => {
    const res = await request(app)
      .post('/api/v1/reports/custom/run')
      .set('Cookie', adminCookie)
      .send({
        entity_type: 'deal',
        config: { selected_fields: ['stage'], filters: [], aggregate: { type: 'count' } },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REPORT_FIELD');
  });
});

// ── GET /:id/export ───────────────────────────────────────────────────────────

describe('GET /api/v1/reports/custom/:id/export', () => {
  it('returns CSV with correct headers', async () => {
    const createRes = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-export`, entity_type: 'contact', config: BASIC_CONFIG });
    const id = createRes.body.id as string;

    const res = await request(app)
      .get(`/api/v1/reports/custom/${id}/export`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.text).toContain('first_name');
    expect(res.text).toContain('last_name');
  });

  it('returns 404 for unknown report id', async () => {
    const res = await request(app)
      .get('/api/v1/reports/custom/00000000-0000-0000-0000-000000000000/export')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── GET /:id/export.pdf ─────────────────────────────────────────────────────

describe('GET /api/v1/reports/custom/:id/export.pdf', () => {
  it('returns a PDF file with the correct Content-Type and Content-Disposition headers', async () => {
    const createRes = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-export-pdf`, entity_type: 'contact', config: BASIC_CONFIG });
    const id = createRes.body.id as string;

    const res = await request(app)
      .get(`/api/v1/reports/custom/${id}/export.pdf`)
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

  it('returns 404 for unknown report id', async () => {
    const res = await request(app)
      .get('/api/v1/reports/custom/00000000-0000-0000-0000-000000000000/export.pdf')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 401 without authentication', async () => {
    const createRes = await request(app)
      .post('/api/v1/reports/custom')
      .set('Cookie', adminCookie)
      .send({
        name: `${FILE_PREFIX}-export-pdf-401`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
      });
    const id = createRes.body.id as string;

    await request(app).get(`/api/v1/reports/custom/${id}/export.pdf`).expect(401);
  });
});
