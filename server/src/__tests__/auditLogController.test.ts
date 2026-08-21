/**
 * HTTP contract tests for auditLogController.
 * Verifies role enforcement, query parameter handling, and response shapes.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'auditlog-ctrl';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let adminId: string;
let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

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
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// Note: GET /api/v1/audit-log was removed in a later change. The admin audit log page
// now fetches via ConnectRPC (gRPC-Web) instead. The unary ListAuditEvents and
// server-streaming StreamAuditEvents RPCs are tested by the E2E suite.

// ── GET /api/v1/audit-log/record ─────────────────────────────────────────────────

describe('GET /api/v1/audit-log/record', () => {
  it('returns entries for a specific record', async () => {
    const recordId = '00000000-0000-0000-0000-000000000001';

    await pool.query(
      `INSERT INTO audit_log (record_type, record_id, record_name, event_type, changed_by_id, changed_by_name)
       VALUES ('contact', $1, 'Test Contact', 'created', $2, 'Audit Admin')`,
      [recordId, adminId],
    );

    const res = await request(app)
      .get(`/api/v1/audit-log/record?record_type=contact&record_id=${recordId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThan(0);
  });

  it('returns 400 when record_type is missing', async () => {
    const res = await request(app)
      .get('/api/v1/audit-log/record?record_id=00000000-0000-0000-0000-000000000001')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when record_id is not a UUID', async () => {
    const res = await request(app)
      .get('/api/v1/audit-log/record?record_type=contact&record_id=not-a-uuid')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is accessible to authenticated reps', async () => {
    const res = await request(app)
      .get(
        '/api/v1/audit-log/record?record_type=contact&record_id=00000000-0000-0000-0000-000000000001',
      )
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });
});

// ── GET /api/v1/audit-log/actors ─────────────────────────────────────────────────

describe('GET /api/v1/audit-log/actors', () => {
  it('returns an actors array', async () => {
    const res = await request(app).get('/api/v1/audit-log/actors').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.actors)).toBe(true);
    if (res.body.actors.length > 0) {
      expect(res.body.actors[0]).toHaveProperty('id');
      expect(res.body.actors[0]).toHaveProperty('name');
    }
  });

  it('returns 403 when a rep requests actors', async () => {
    const res = await request(app).get('/api/v1/audit-log/actors').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});
