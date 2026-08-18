/**
 * HTTP contract tests for relationship health scoring endpoints.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'rel-health-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;
const OTHER_REP_EMAIL = `${FILE_PREFIX}-other-rep@example.com`;
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;

let repCookie: string;
let repId: string;
let otherRepCookie: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Relationship Health Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
  const otherRep = await createUser({
    email: OTHER_REP_EMAIL,
    name: 'Other Relationship Health Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherRepCookie = makeAuthCookie({
    id: otherRep.id,
    email: otherRep.email,
    role: otherRep.role,
    name: otherRep.name,
  });
  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Relationship Health Admin',
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
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('GET /api/v1/accounts/:id/health-score', () => {
  it('returns 401 without authentication', async () => {
    const accountResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['Test Account', repId],
    );
    await request(app).get(`/api/v1/accounts/${accountResult.rows[0].id}/health-score`).expect(401);
  });

  it('returns null score for an account with no computed score yet', async () => {
    const accountResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['Test Account 2', repId],
    );
    const res = await request(app)
      .get(`/api/v1/accounts/${accountResult.rows[0].id}/health-score`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.score).toBeNull();
  });

  it('returns 404 for a non-existent account', async () => {
    await request(app)
      .get('/api/v1/accounts/00000000-0000-0000-0000-000000000000/health-score')
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('returns 403 when a rep requests the score for an account owned by another rep under a private visibility policy', async () => {
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'account'`,
    );
    try {
      const accountResult = await pool.query<{ id: string }>(
        `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
        ['Cross-Owner Test Account', repId],
      );
      await request(app)
        .get(`/api/v1/accounts/${accountResult.rows[0].id}/health-score`)
        .set('Cookie', otherRepCookie)
        .expect(403);
    } finally {
      await pool.query(
        `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'account'`,
      );
    }
  });

  it('allows an admin to view the score for an account owned by a rep', async () => {
    const accountResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['Admin-Viewable Test Account', repId],
    );
    await request(app)
      .get(`/api/v1/accounts/${accountResult.rows[0].id}/health-score`)
      .set('Cookie', adminCookie)
      .expect(200);
  });
});

describe('GET /api/v1/accounts/:id/health-score/history', () => {
  it('returns an empty points array for an account with no history', async () => {
    const accountResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['History Test Account', repId],
    );
    const res = await request(app)
      .get(`/api/v1/accounts/${accountResult.rows[0].id}/health-score/history`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.points).toEqual([]);
  });

  it('returns 404 for a non-existent account', async () => {
    await request(app)
      .get('/api/v1/accounts/00000000-0000-0000-0000-000000000000/health-score/history')
      .set('Cookie', repCookie)
      .expect(404);
  });
});

describe('GET/PATCH /api/v1/settings/relationship-health-config', () => {
  it('returns 403 for a non-admin rep', async () => {
    await request(app)
      .get('/api/v1/settings/relationship-health-config')
      .set('Cookie', repCookie)
      .expect(403);
  });

  it('allows an admin to read the current configuration', async () => {
    const res = await request(app)
      .get('/api/v1/settings/relationship-health-config')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body).toHaveProperty('min_logged_activities');
  });

  it('rejects a PATCH with weights that do not sum to 1.0', async () => {
    await request(app)
      .patch('/api/v1/settings/relationship-health-config')
      .set('Cookie', adminCookie)
      .send({
        frequency_weight: 0.5,
        recency_weight: 0.5,
        seniority_weight: 0.5,
        sentiment_weight: 0.5,
        breadth_weight: 0.5,
        strong_threshold: 80,
        healthy_threshold: 60,
        cooling_threshold: 40,
        at_risk_threshold: 20,
        min_logged_activities: 3,
        recency_window_days: 90,
        single_threaded_window_days: 90,
      })
      .expect(400);
  });

  it('allows an admin to persist a valid configuration update', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/relationship-health-config')
      .set('Cookie', adminCookie)
      .send({
        frequency_weight: 0.25,
        recency_weight: 0.25,
        seniority_weight: 0.15,
        sentiment_weight: 0.2,
        breadth_weight: 0.15,
        strong_threshold: 80,
        healthy_threshold: 60,
        cooling_threshold: 40,
        at_risk_threshold: 20,
        min_logged_activities: 4,
        recency_window_days: 90,
        single_threaded_window_days: 90,
      })
      .expect(200);

    expect(res.body.min_logged_activities).toBe(4);

    // Restore default for subsequent test runs.
    await request(app)
      .patch('/api/v1/settings/relationship-health-config')
      .set('Cookie', adminCookie)
      .send({
        frequency_weight: 0.25,
        recency_weight: 0.25,
        seniority_weight: 0.15,
        sentiment_weight: 0.2,
        breadth_weight: 0.15,
        strong_threshold: 80,
        healthy_threshold: 60,
        cooling_threshold: 40,
        at_risk_threshold: 20,
        min_logged_activities: 3,
        recency_window_days: 90,
        single_threaded_window_days: 90,
      })
      .expect(200);
  });
});
