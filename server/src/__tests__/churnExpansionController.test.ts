/**
 * HTTP contract tests for churn/expansion endpoints.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'churn-exp-ctrl';
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
    name: 'Churn Expansion Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
  const otherRep = await createUser({
    email: OTHER_REP_EMAIL,
    name: 'Other Churn Expansion Rep',
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
    name: 'Churn Expansion Admin',
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

describe('GET /api/v1/accounts/:id/churn-expansion-signal', () => {
  it('returns 401 without authentication', async () => {
    const accountResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['Test Account', repId],
    );
    await request(app)
      .get(`/api/v1/accounts/${accountResult.rows[0].id}/churn-expansion-signal`)
      .expect(401);
  });

  it('returns null signal for an account with no active signal', async () => {
    const accountResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['Test Account 2', repId],
    );
    const res = await request(app)
      .get(`/api/v1/accounts/${accountResult.rows[0].id}/churn-expansion-signal`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.signal).toBeNull();
  });

  it('returns 404 for a non-existent account', async () => {
    await request(app)
      .get('/api/v1/accounts/00000000-0000-0000-0000-000000000000/churn-expansion-signal')
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('returns 403 when a rep requests the signal for an account owned by another rep under a private visibility policy', async () => {
    // Default org visibility policy is 'org' (all reps see all records) — this
    // test asserts the private-policy denial path, so it must set that policy
    // explicitly rather than relying on an unstated default.
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'account'`,
    );
    try {
      const accountResult = await pool.query<{ id: string }>(
        `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
        ['Cross-Owner Test Account', repId],
      );
      await request(app)
        .get(`/api/v1/accounts/${accountResult.rows[0].id}/churn-expansion-signal`)
        .set('Cookie', otherRepCookie)
        .expect(403);
    } finally {
      await pool.query(
        `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'account'`,
      );
    }
  });

  it('allows an admin to view the signal for an account owned by a rep', async () => {
    const accountResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['Admin-Viewable Test Account', repId],
    );
    await request(app)
      .get(`/api/v1/accounts/${accountResult.rows[0].id}/churn-expansion-signal`)
      .set('Cookie', adminCookie)
      .expect(200);
  });
});

describe('GET /api/v1/insights/churn-expansion', () => {
  it('returns 401 without authentication', async () => {
    await request(app).get('/api/v1/insights/churn-expansion').expect(401);
  });

  it('returns empty at_risk and expansion lists by default', async () => {
    const res = await request(app)
      .get('/api/v1/insights/churn-expansion')
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body).toHaveProperty('at_risk');
    expect(res.body).toHaveProperty('expansion');
  });

  it('excludes signals for accounts owned by another rep, but an admin sees them', async () => {
    const accountResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['List-Scoping Test Account', repId],
    );
    const accountId = accountResult.rows[0].id;
    await pool.query(
      `INSERT INTO account_churn_expansion_signals (account_id, signal_type, confidence, contributing_factors)
       VALUES ($1, 'churn_risk', 0.9, '[{"description":"No activity in 60 days"}]'::jsonb)`,
      [accountId],
    );

    const otherRepRes = await request(app)
      .get('/api/v1/insights/churn-expansion')
      .set('Cookie', otherRepCookie)
      .expect(200);
    expect(
      otherRepRes.body.at_risk.some((s: { account_id: string }) => s.account_id === accountId),
    ).toBe(false);

    const adminRes = await request(app)
      .get('/api/v1/insights/churn-expansion')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      adminRes.body.at_risk.some((s: { account_id: string }) => s.account_id === accountId),
    ).toBe(true);
  });
});
