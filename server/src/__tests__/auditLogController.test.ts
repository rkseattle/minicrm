/**
 * HTTP contract tests for auditLogController.
 * Verifies role enforcement, query parameter handling, and response shapes.
 * (MINCRM-195)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const ADMIN_EMAIL = 'admin-auditlog-ctrl@example.com';
const REP_EMAIL = 'rep-auditlog-ctrl@example.com';

let adminId: string;
let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Audit Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Audit Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);
});

// ── GET /api/audit-log ────────────────────────────────────────────────────────

describe('GET /api/audit-log', () => {
  it('returns paginated entries with no filters', async () => {
    const res = await request(app).get('/api/audit-log').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('accepts date range filters without error', async () => {
    const res = await request(app)
      .get('/api/audit-log?from=2020-01-01&to=2030-01-01')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filters by userId', async () => {
    // Insert a known audit entry for the admin user directly
    await pool.query(
      `INSERT INTO audit_log (record_type, event_type, changed_by_id, changed_by_name)
       VALUES ('user', 'login', $1, 'Audit Admin')`,
      [adminId],
    );

    const res = await request(app)
      .get(`/api/audit-log?userId=${adminId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.data.length).toBeGreaterThan(0);
    // Every returned entry must be authored by the filtered user
    for (const entry of res.body.data as Array<{ changed_by_id: string }>) {
      expect(entry.changed_by_id).toBe(adminId);
    }
  });

  it('filters by recordType', async () => {
    const res = await request(app).get('/api/audit-log?recordType=user').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const entry of res.body.data as Array<{ record_type: string }>) {
      expect(entry.record_type).toBe('user');
    }
  });

  it('returns 400 for an invalid recordType', async () => {
    const res = await request(app)
      .get('/api/audit-log?recordType=not_valid')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep requests the audit log', async () => {
    const res = await request(app).get('/api/audit-log').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/audit-log');

    expect(res.status).toBe(401);
  });
});

// ── GET /api/audit-log/record ─────────────────────────────────────────────────

describe('GET /api/audit-log/record', () => {
  it('returns entries for a specific record', async () => {
    const recordId = '00000000-0000-0000-0000-000000000001';

    await pool.query(
      `INSERT INTO audit_log (record_type, record_id, record_name, event_type, changed_by_id, changed_by_name)
       VALUES ('contact', $1, 'Test Contact', 'created', $2, 'Audit Admin')`,
      [recordId, adminId],
    );

    const res = await request(app)
      .get(`/api/audit-log/record?record_type=contact&record_id=${recordId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThan(0);
  });

  it('returns 400 when record_type is missing', async () => {
    const res = await request(app)
      .get('/api/audit-log/record?record_id=00000000-0000-0000-0000-000000000001')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when record_id is not a UUID', async () => {
    const res = await request(app)
      .get('/api/audit-log/record?record_type=contact&record_id=not-a-uuid')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is accessible to authenticated reps', async () => {
    const res = await request(app)
      .get(
        '/api/audit-log/record?record_type=contact&record_id=00000000-0000-0000-0000-000000000001',
      )
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });
});

// ── GET /api/audit-log/actors ─────────────────────────────────────────────────

describe('GET /api/audit-log/actors', () => {
  it('returns an actors array', async () => {
    const res = await request(app).get('/api/audit-log/actors').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.actors)).toBe(true);
    if (res.body.actors.length > 0) {
      expect(res.body.actors[0]).toHaveProperty('id');
      expect(res.body.actors[0]).toHaveProperty('name');
    }
  });

  it('returns 403 when a rep requests actors', async () => {
    const res = await request(app).get('/api/audit-log/actors').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});
