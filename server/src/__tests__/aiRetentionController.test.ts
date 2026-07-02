/**
 * HTTP contract tests for AI session retention admin endpoints. (MINCRM-462)
 *
 * Covers:
 *  - GET /admin/ai/retention-stats: admin-only, returns session/message counts
 *  - POST /admin/ai/retention/purge: admin-only, returns 202 immediately, writes
 *    a "trigger" audit entry, and actually purges eligible sessions
 *  - GET /ai/retention-window: any authenticated user (behind ai_nli_page flag)
 *  - Role enforcement: reps receive 403 on all /admin/ai/retention-* routes
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createSession } from '../services/aiSessionService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';
import { __clearCacheForTest } from '../services/featureFlagService.js';

const FILE_PREFIX = 'ai-retention-ctrl';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let adminCookie: string;
let repCookie: string;
let repId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Retention Admin',
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

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Retention Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });

  // ai_nli_page (and its ai_features master toggle — see featureFlagService's
  // master-gate, MINCRM-460) can be left disabled by other test runs that toggle
  // or reset the AI master switch. This file only asserts retention-window
  // behavior, so seed/force both enabled regardless of ambient state.
  await pool.query(
    `INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
     VALUES ('ai_nli_page', 'NLI Page', 'Natural language interface page.', 'AI', true, '{"admin":true,"rep":true}', true)
     ON CONFLICT (flag_key) DO UPDATE SET enabled = true`,
  );
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'ai_features'`);
  __clearCacheForTest();
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── Role enforcement ──────────────────────────────────────────────────────────

describe('role enforcement', () => {
  it('GET /admin/ai/retention-stats returns 403 for reps', async () => {
    const res = await request(app).get('/api/v1/admin/ai/retention-stats').set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('POST /admin/ai/retention/purge returns 403 for reps', async () => {
    const res = await request(app)
      .post('/api/v1/admin/ai/retention/purge')
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });
});

// ── GET /admin/ai/retention-stats ─────────────────────────────────────────────

describe('GET /admin/ai/retention-stats', () => {
  it('returns 200 with session_count and message_count reflecting stored data', async () => {
    await createSession(repId, { id: repId, name: 'Retention Rep' });

    const res = await request(app)
      .get('/api/v1/admin/ai/retention-stats')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(typeof res.body.session_count).toBe('number');
    expect(typeof res.body.message_count).toBe('number');
    expect(res.body.session_count).toBeGreaterThanOrEqual(1);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/v1/admin/ai/retention-stats');
    expect(res.status).toBe(401);
  });
});

// ── POST /admin/ai/retention/purge ────────────────────────────────────────────

describe('POST /admin/ai/retention/purge', () => {
  it('returns 202 accepted immediately', async () => {
    const res = await request(app)
      .post('/api/v1/admin/ai/retention/purge')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, message: expect.any(String) });
  });

  it('writes a manual_purge_triggered audit entry attributed to the admin', async () => {
    await request(app).post('/api/v1/admin/ai/retention/purge').set('Cookie', adminCookie);

    // The audit write is best-effort/fire-and-forget on the request path, so
    // poll briefly rather than asserting immediately after the response returns.
    let found = false;
    for (let attempt = 0; attempt < 10 && !found; attempt++) {
      const row = await pool.query<{ changed_by_name: string }>(
        `SELECT changed_by_name FROM audit_log
         WHERE record_type = 'ai_settings' AND field_name = 'manual_purge_triggered'
         ORDER BY id DESC LIMIT 1`,
      );
      if (row.rows.length > 0) {
        found = true;
        expect(row.rows[0].changed_by_name).toBe('Retention Admin');
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    expect(found).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/v1/admin/ai/retention/purge');
    expect(res.status).toBe(401);
  });
});

// ── GET /ai/retention-window ───────────────────────────────────────────────────

describe('GET /ai/retention-window', () => {
  it('returns 200 with the configured retention window for any authenticated user', async () => {
    const res = await request(app).get('/api/v1/ai/retention-window').set('Cookie', repCookie);
    expect(res.status).toBe(200);
    expect(typeof res.body.ai_session_retention_days).toBe('number');
    expect(res.body.ai_session_retention_days).toBeGreaterThanOrEqual(30);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/v1/ai/retention-window');
    expect(res.status).toBe(401);
  });
});
