/**
 * HTTP contract tests for win/loss insights endpoints.
 *
 * Covers:
 *  - GET /insights/win-loss: authenticated, flag-gated, returns cached shape
 *  - GET /insights/win-loss/export.csv: returns text/csv
 *  - GET /insights/win-loss/export.pdf: returns application/pdf
 *  - Unauthenticated requests are rejected
 *  - Flag-disabled requests are rejected
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { __clearCacheForTest } from '../services/featureFlagService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'wl-insight-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Win Loss Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('GET /api/v1/insights/win-loss', () => {
  it('returns 401 without authentication', async () => {
    await request(app).get('/api/v1/insights/win-loss').expect(401);
  });

  it('returns the cached insights shape for an authenticated user', async () => {
    const res = await request(app)
      .get('/api/v1/insights/win-loss')
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body).toHaveProperty('insights');
    expect(res.body).toHaveProperty('loss_reason_trends');
    expect(res.body).toHaveProperty('has_sufficient_data');
    expect(res.body).toHaveProperty('min_closed_deals_required');
    expect(res.body).toHaveProperty('closed_deals_count');
  });

  it('returns 403 when the ai_win_loss_insights flag is disabled', async () => {
    await pool.query(
      `UPDATE feature_flags SET enabled = false, role_overrides = '{"admin":false,"rep":false}' WHERE flag_key = 'ai_win_loss_insights'`,
    );
    __clearCacheForTest();
    try {
      await request(app).get('/api/v1/insights/win-loss').set('Cookie', repCookie).expect(403);
    } finally {
      await pool.query(
        `UPDATE feature_flags SET enabled = true, role_overrides = '{"admin":true,"rep":true}' WHERE flag_key = 'ai_win_loss_insights'`,
      );
      __clearCacheForTest();
    }
  });
});

describe('GET /api/v1/insights/win-loss/export.csv', () => {
  it('returns a CSV response', async () => {
    const res = await request(app)
      .get('/api/v1/insights/win-loss/export.csv')
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
  });
});

describe('GET /api/v1/insights/win-loss/export.pdf', () => {
  it('returns a PDF response', async () => {
    const res = await request(app)
      .get('/api/v1/insights/win-loss/export.pdf')
      .set('Cookie', repCookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toContain('application/pdf');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    // PDF magic bytes
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });
});
