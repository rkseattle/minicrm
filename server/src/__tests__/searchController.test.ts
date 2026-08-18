/**
 * Integration tests for the search controller.
 * Covers: validation (query too short), 200 with results shape, 401 unauthenticated.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'search-ctrl';

let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Search Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('GET /api/v1/search', () => {
  it('returns 200 with contacts/accounts/deals arrays for a valid query', async () => {
    const res = await request(app).get('/api/v1/search?q=test').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.contacts)).toBe(true);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(Array.isArray(res.body.deals)).toBe(true);
  });

  it('returns 400 QUERY_TOO_SHORT when q is missing', async () => {
    const res = await request(app).get('/api/v1/search').set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QUERY_TOO_SHORT');
  });

  it('returns 400 QUERY_TOO_SHORT when q is too short', async () => {
    const res = await request(app).get('/api/v1/search?q=a').set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QUERY_TOO_SHORT');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/search?q=test');
    expect(res.status).toBe(401);
  });
});
