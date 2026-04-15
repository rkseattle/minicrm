/**
 * HTTP contract tests for demoController.
 * Verifies seed/reset/remove lifecycle, 409 conflict cases, and role enforcement.
 * (MINCRM-195)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const ADMIN_EMAIL = 'admin-demo-ctrl@example.com';
const REP_EMAIL = 'rep-demo-ctrl@example.com';

let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Demo Admin',
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
    name: 'Demo Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

/**
 * Removes all demo-flagged records directly via SQL before each test.
 * Using direct DB queries (rather than the HTTP DELETE endpoint) ensures teardown
 * succeeds even if the route is broken, avoiding cascading test failures.
 */
async function clearDemoData(): Promise<void> {
  await pool.query('DELETE FROM activities WHERE is_demo = true');
  await pool.query(
    `DELETE FROM deal_contacts
     WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)
        OR contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await pool.query('DELETE FROM deals WHERE is_demo = true');
  await pool.query('DELETE FROM contacts WHERE is_demo = true');
  await pool.query('DELETE FROM accounts WHERE is_demo = true');
}

beforeEach(async () => {
  await clearDemoData();
});

afterAll(async () => {
  await clearDemoData();
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);
});

// ── GET /api/admin/demo/status ────────────────────────────────────────────────

describe('GET /api/admin/demo/status', () => {
  it('returns 200 with a status object', async () => {
    const res = await request(app).get('/api/admin/demo/status').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.active).toBe('boolean');
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app).get('/api/admin/demo/status').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/admin/demo/status');

    expect(res.status).toBe(401);
  });
});

// ── POST /api/admin/demo/seed ─────────────────────────────────────────────────

describe('POST /api/admin/demo/seed', () => {
  it('seeds demo data and returns 200 with success:true', async () => {
    const res = await request(app).post('/api/admin/demo/seed').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 409 DEMO_ALREADY_EXISTS when demo data is already present', async () => {
    // First seed succeeds
    await request(app).post('/api/admin/demo/seed').set('Cookie', adminCookie);

    // Second seed should conflict
    const res = await request(app).post('/api/admin/demo/seed').set('Cookie', adminCookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEMO_ALREADY_EXISTS');
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app).post('/api/admin/demo/seed').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/admin/demo/seed');

    expect(res.status).toBe(401);
  });
});

// ── POST /api/admin/demo/reset ────────────────────────────────────────────────

describe('POST /api/admin/demo/reset', () => {
  it('resets demo data and returns 200 with success:true', async () => {
    // Seed first so there is something to reset
    await request(app).post('/api/admin/demo/seed').set('Cookie', adminCookie);

    const res = await request(app).post('/api/admin/demo/reset').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app).post('/api/admin/demo/reset').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/admin/demo/reset');

    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/admin/demo ────────────────────────────────────────────────────

describe('DELETE /api/admin/demo', () => {
  it('removes demo data and returns 200 with success:true', async () => {
    await request(app).post('/api/admin/demo/seed').set('Cookie', adminCookie);

    const res = await request(app).delete('/api/admin/demo').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 409 DEMO_NOT_PRESENT when no demo data exists', async () => {
    const res = await request(app).delete('/api/admin/demo').set('Cookie', adminCookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEMO_NOT_PRESENT');
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app).delete('/api/admin/demo').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).delete('/api/admin/demo');

    expect(res.status).toBe(401);
  });
});
