/**
 * HTTP contract tests for rep coaching insights endpoints. (MINCRM-474)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createTeam, addTeamMember } from '../services/teamService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

const FILE_PREFIX = 'rep-coaching-ctrl';
const ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

let repCookie: string;
let repId: string;
let otherRepId: string;
let managerCookie: string;
let managerId: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query(
    `DELETE FROM team_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(`DELETE FROM teams WHERE name LIKE $1`, [`${FILE_PREFIX}%`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Coaching Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });

  const otherRep = await createUser({
    email: `${FILE_PREFIX}-other-rep@example.com`,
    name: 'Other Coaching Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherRepId = otherRep.id;

  const manager = await createUser({
    email: `${FILE_PREFIX}-manager@example.com`,
    name: 'Coaching Manager',
    role: 'manager',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  managerId = manager.id;
  managerCookie = makeAuthCookie({
    id: manager.id,
    email: manager.email,
    role: manager.role,
    name: manager.name,
  });

  const team = await createTeam(
    { name: `${FILE_PREFIX} Team ${uid()}`, manager_id: managerId },
    ACTOR,
  );
  await addTeamMember(team.id, repId, 'member', ACTOR);
  // otherRep is deliberately NOT added to the manager's team.

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Coaching Admin',
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
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM team_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(`DELETE FROM teams WHERE name LIKE $1`, [`${FILE_PREFIX}%`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('GET /api/v1/insights/coaching/me', () => {
  it('returns 401 without authentication', async () => {
    await request(app).get('/api/v1/insights/coaching/me').expect(401);
  });

  it('returns the authenticated rep’s own insights (insufficient data by default)', async () => {
    const res = await request(app)
      .get('/api/v1/insights/coaching/me')
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.rep_id).toBe(repId);
    expect(res.body.has_sufficient_data).toBe(false);
  });
});

describe('GET /api/v1/insights/coaching/team', () => {
  it('returns 403 for a rep (manager/admin only)', async () => {
    await request(app).get('/api/v1/insights/coaching/team').set('Cookie', repCookie).expect(403);
  });

  it('scopes to team members for a manager', async () => {
    const res = await request(app)
      .get('/api/v1/insights/coaching/team')
      .set('Cookie', managerCookie)
      .expect(200);

    const repIds = res.body.reps.map((r: { rep_id: string }) => r.rep_id);
    expect(repIds).toContain(repId);
    expect(repIds).toContain(managerId);
    expect(repIds).not.toContain(otherRepId);
  });

  it('returns org-wide reps for an admin', async () => {
    const res = await request(app)
      .get('/api/v1/insights/coaching/team')
      .set('Cookie', adminCookie)
      .expect(200);

    const repIds = res.body.reps.map((r: { rep_id: string }) => r.rep_id);
    expect(repIds).toContain(repId);
    expect(repIds).toContain(otherRepId);
  });
});

describe('GET /api/v1/insights/coaching/:repId', () => {
  it('returns 403 for a rep role (managers/admins only — reps use /me)', async () => {
    await request(app)
      .get(`/api/v1/insights/coaching/${repId}`)
      .set('Cookie', repCookie)
      .expect(403);
  });

  it('allows a manager to view a rep within their own team', async () => {
    await request(app)
      .get(`/api/v1/insights/coaching/${repId}`)
      .set('Cookie', managerCookie)
      .expect(200);
  });

  it('returns 403 when a manager requests a rep outside their team', async () => {
    await request(app)
      .get(`/api/v1/insights/coaching/${otherRepId}`)
      .set('Cookie', managerCookie)
      .expect(403);
  });

  it('allows an admin to view any rep', async () => {
    await request(app)
      .get(`/api/v1/insights/coaching/${otherRepId}`)
      .set('Cookie', adminCookie)
      .expect(200);
  });
});

describe('GET/PATCH /api/v1/admin/ai/coaching-config', () => {
  it('returns 403 for a non-admin', async () => {
    await request(app)
      .get('/api/v1/admin/ai/coaching-config')
      .set('Cookie', managerCookie)
      .expect(403);
  });

  it('allows an admin to read the current configuration', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/coaching-config')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body).toHaveProperty('min_closed_deals');
  });

  it('rejects a PATCH with an out-of-range ratio', async () => {
    await request(app)
      .patch('/api/v1/admin/ai/coaching-config')
      .set('Cookie', adminCookie)
      .send({
        min_closed_deals: 10,
        stage_time_outlier_ratio: 0.5, // must be > 1
        activity_frequency_outlier_ratio: 0.5,
        response_time_outlier_hours: 48,
        win_rate_outlier_delta: 0.15,
      })
      .expect(400);
  });

  it('allows an admin to persist a valid configuration update', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/coaching-config')
      .set('Cookie', adminCookie)
      .send({
        min_closed_deals: 8,
        stage_time_outlier_ratio: 1.5,
        activity_frequency_outlier_ratio: 0.5,
        response_time_outlier_hours: 48,
        win_rate_outlier_delta: 0.15,
      })
      .expect(200);

    expect(res.body.min_closed_deals).toBe(8);

    // Restore default for subsequent test runs.
    await request(app)
      .patch('/api/v1/admin/ai/coaching-config')
      .set('Cookie', adminCookie)
      .send({
        min_closed_deals: 10,
        stage_time_outlier_ratio: 1.5,
        activity_frequency_outlier_ratio: 0.5,
        response_time_outlier_hours: 48,
        win_rate_outlier_delta: 0.15,
      })
      .expect(200);
  });
});

describe('POST /api/v1/admin/ai/coaching/run', () => {
  it('returns 403 for a non-admin', async () => {
    await request(app)
      .post('/api/v1/admin/ai/coaching/run')
      .set('Cookie', managerCookie)
      .expect(403);
  });

  it('accepts the request and returns 202 for an admin', async () => {
    const res = await request(app)
      .post('/api/v1/admin/ai/coaching/run')
      .set('Cookie', adminCookie)
      .expect(202);

    expect(res.body.accepted).toBe(true);
  });
});
