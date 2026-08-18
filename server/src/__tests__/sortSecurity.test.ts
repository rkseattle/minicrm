/**
 * Security regression tests for ORDER BY injection.
 *
 * Verification finding: all list endpoints use hardcoded ORDER BY clauses in
 * their service functions — no client-supplied sort column is ever interpolated
 * into SQL. These tests confirm that:
 *   1. Arbitrary `sort` and `dir` query parameters do not cause DB errors.
 *   2. The endpoints return successful responses regardless of injected values.
 *   3. A SQL injection attempt via `sort` does not produce a 500 error or leak
 *      DB error details.
 *
 * If a future change introduces dynamic ORDER BY, these tests will catch unsafe
 * interpolation (a DB error from injected SQL would return 500, failing the
 * assertions below).
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const BASE_USER = {
  name: 'Sort Security Test User',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Payloads that would cause a DB error if interpolated directly into ORDER BY */
const INJECTION_PAYLOADS = [
  '1; DROP TABLE contacts--',
  "' OR '1'='1",
  'created_at; SELECT 1--',
  '(SELECT password_hash FROM users LIMIT 1)',
  'nonexistent_column',
  '',
  '   ',
];

const DIRECTION_PAYLOADS = ['asc', 'desc', 'ASC', 'DESC', 'invalid', '; DROP TABLE--', ''];

let authCookie: string;

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE email = 'sort-sec-test@example.com'");

  const user = await createUser({
    ...BASE_USER,
    email: 'sort-sec-test@example.com',
  });

  authCookie = makeAuthCookie({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email = 'sort-sec-test@example.com'");
});

// ── Contacts ─────────────────────────────────────────────────────────────────

describe('GET /api/contacts sort injection', () => {
  it.each(INJECTION_PAYLOADS)('does not return 500 when sort="%s"', async (sortPayload) => {
    const res = await request(app)
      .get('/api/v1/contacts')
      .query({ sort: sortPayload })
      .set('Cookie', authCookie);

    // A 500 would indicate a DB error from injected SQL; 400/422 for validation is acceptable
    expect(res.status).not.toBe(500);
  });

  it.each(DIRECTION_PAYLOADS)('does not return 500 when dir="%s"', async (dirPayload) => {
    const res = await request(app)
      .get('/api/v1/contacts')
      .query({ dir: dirPayload })
      .set('Cookie', authCookie);

    // A 500 would indicate a DB error from injected SQL; 400/422 for validation is acceptable
    expect(res.status).not.toBe(500);
  });

  it('returns a contacts array regardless of injected sort params', async () => {
    const res = await request(app)
      .get('/api/v1/contacts')
      .query({ sort: '1; DROP TABLE contacts--', dir: "'; SELECT 1--" })
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── Accounts ──────────────────────────────────────────────────────────────────

describe('GET /api/accounts sort injection', () => {
  it.each(INJECTION_PAYLOADS)('does not return 500 when sort="%s"', async (sortPayload) => {
    const res = await request(app)
      .get('/api/v1/accounts')
      .query({ sort: sortPayload })
      .set('Cookie', authCookie);

    // A 500 would indicate a DB error from injected SQL; 400/422 for validation is acceptable
    expect(res.status).not.toBe(500);
  });

  it.each(DIRECTION_PAYLOADS)('does not return 500 when dir="%s"', async (dirPayload) => {
    const res = await request(app)
      .get('/api/v1/accounts')
      .query({ dir: dirPayload })
      .set('Cookie', authCookie);

    // A 500 would indicate a DB error from injected SQL; 400/422 for validation is acceptable
    expect(res.status).not.toBe(500);
  });

  it('returns an accounts array regardless of injected sort params', async () => {
    const res = await request(app)
      .get('/api/v1/accounts')
      .query({ sort: '1; DROP TABLE accounts--', dir: 'invalid' })
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── Deals ─────────────────────────────────────────────────────────────────────

describe('GET /api/deals sort injection', () => {
  it.each(INJECTION_PAYLOADS)('does not return 500 when sort="%s"', async (sortPayload) => {
    const res = await request(app)
      .get('/api/v1/deals')
      .query({ sort: sortPayload })
      .set('Cookie', authCookie);

    // A 500 would indicate a DB error from injected SQL; 400/422 for validation is acceptable
    expect(res.status).not.toBe(500);
  });

  it.each(DIRECTION_PAYLOADS)('does not return 500 when dir="%s"', async (dirPayload) => {
    const res = await request(app)
      .get('/api/v1/deals')
      .query({ dir: dirPayload })
      .set('Cookie', authCookie);

    // A 500 would indicate a DB error from injected SQL; 400/422 for validation is acceptable
    expect(res.status).not.toBe(500);
  });

  it('returns a deals array regardless of injected sort params', async () => {
    const res = await request(app)
      .get('/api/v1/deals')
      .query({ sort: "'; DROP TABLE deals--", dir: 'invalid' })
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── Activities ────────────────────────────────────────────────────────────────

describe('GET /api/activities sort injection', () => {
  it.each(INJECTION_PAYLOADS)('does not return 500 when sort="%s"', async (sortPayload) => {
    const res = await request(app)
      .get('/api/v1/activities')
      .query({ sort: sortPayload })
      .set('Cookie', authCookie);

    // A 500 would indicate a DB error from injected SQL; 400/422 for validation is acceptable
    expect(res.status).not.toBe(500);
  });

  it.each(DIRECTION_PAYLOADS)('does not return 500 when dir="%s"', async (dirPayload) => {
    const res = await request(app)
      .get('/api/v1/activities')
      .query({ dir: dirPayload })
      .set('Cookie', authCookie);

    // A 500 would indicate a DB error from injected SQL; 400/422 for validation is acceptable
    expect(res.status).not.toBe(500);
  });

  it('returns an activities array regardless of injected sort params', async () => {
    const res = await request(app)
      .get('/api/v1/activities')
      .query({ sort: "'; DROP TABLE activities--", dir: 'invalid' })
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
