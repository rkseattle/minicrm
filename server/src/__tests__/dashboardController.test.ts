/**
 * HTTP contract tests for dashboardController.
 * Verifies expected response shape and auth enforcement.
 * (MINCRM-195)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const ADMIN_EMAIL = 'admin-dash-ctrl@example.com';
const REP_EMAIL = 'rep-dash-ctrl@example.com';

let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Dash Admin',
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
    name: 'Dash Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);
});

// ── GET /api/dashboard/summary ────────────────────────────────────────────────

describe('GET /api/dashboard/summary', () => {
  it('returns 200 with the expected summary shape for an admin', async () => {
    const res = await request(app).get('/api/dashboard/summary').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.overdueTasks).toBe('number');
    expect(typeof res.body.tasksDueToday).toBe('number');
    expect(typeof res.body.openDealCount).toBe('number');
    expect(typeof res.body.openPipelineValue).toBe('string');
    expect(Array.isArray(res.body.stageBreakdown)).toBe(true);
  });

  it('returns 200 with the expected summary shape for a rep', async () => {
    const res = await request(app).get('/api/dashboard/summary').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.overdueTasks).toBe('number');
    expect(typeof res.body.tasksDueToday).toBe('number');
    expect(typeof res.body.openDealCount).toBe('number');
    expect(typeof res.body.openPipelineValue).toBe('string');
    expect(Array.isArray(res.body.stageBreakdown)).toBe(true);
    expect(Array.isArray(res.body.recentActivities)).toBe(true);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/dashboard/summary');

    expect(res.status).toBe(401);
  });
});
