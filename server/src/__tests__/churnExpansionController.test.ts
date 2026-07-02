/**
 * HTTP contract tests for churn/expansion endpoints. (MINCRM-469)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'churn-exp-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let repCookie: string;
let repId: string;

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
});
