/**
 * HTTP contract tests for demoController.
 * Verifies seed/reset/remove lifecycle, 409 conflict cases, and role enforcement.
 * (MINCRM-195)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import pool from '../db.js';
import { claimAdminResolution, ensureUser, makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'demo-ctrl';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

// Derived from DEMO_WEBHOOK_SUBSCRIPTIONS in demoService.ts
const DEMO_WEBHOOK_URLS_CTRL = [
  'https://hooks.example.com/slack/minicrm-deals',
  'https://hooks.zapier.com/example/minicrm',
];
// Derived from DEMO_CUSTOM_FIELD_DEFINITIONS in demoService.ts
const DEMO_CUSTOM_FIELD_NAMES_CTRL = [
  'LinkedIn URL',
  'Lead Source Detail',
  'Contract Signed Date',
  'Estimated ARR',
];
// Derived from DEMO_CURRENCIES in demoService.ts
const DEMO_CURRENCY_CODES_CTRL = ['GBP', 'EUR', 'CAD'];

let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  // Enable demo_data feature flag for this test suite (default is false in migration seed)
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'demo_data'`);

  // Remove any notes created_by these test users from prior runs before deleting users
  await pool.query(
    `DELETE FROM notes WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM notes WHERE created_by = (SELECT id FROM users WHERE email = $1)', [
    'alex.rivera@demo.minicrm.app',
  ]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  await ensureFixtureUsers();
});

/**
 * Ensures both fixture users exist and re-signs their auth cookies.
 *
 * The cookies must be re-derived whenever the rows are, not just created once:
 * `authenticate` resolves the user live by the token's id and returns 401 USER_INACTIVE
 * when the row is gone (see middleware/auth.ts). So a cookie signed against a deleted
 * row's id turns every admin assertion into a 401 and every rep 403 assertion into a
 * 401, even once the user has been recreated under a new id. (MINCRM-704)
 */
async function ensureFixtureUsers(): Promise<void> {
  // Claims admin resolution rather than assuming it — see claimAdminResolution.
  const adminId = await claimAdminResolution({
    email: ADMIN_EMAIL,
    name: 'Demo Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminCookie = makeAuthCookie({
    id: adminId,
    email: ADMIN_EMAIL,
    name: 'Demo Admin',
    role: 'admin',
  });

  const repId = await ensureUser({
    email: REP_EMAIL,
    name: 'Demo Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: repId, email: REP_EMAIL, name: 'Demo Rep', role: 'rep' });
}

/**
 * Removes all demo-flagged records directly via SQL before each test.
 * Using direct DB queries (rather than the HTTP DELETE endpoint) ensures teardown
 * succeeds even if the route is broken, avoiding cascading test failures.
 */
async function clearDemoData(): Promise<void> {
  // Notes are identified by entity FK, not is_demo — delete before entities
  await pool.query(
    `DELETE FROM notes WHERE entity_id IN (
       SELECT id FROM contacts WHERE is_demo = true
       UNION SELECT id FROM accounts WHERE is_demo = true
       UNION SELECT id FROM deals WHERE is_demo = true
       UNION SELECT id FROM leads WHERE is_demo = true
     )`,
  );
  // Also delete notes left by the demo rep user (no is_demo column on notes)
  await pool.query(`DELETE FROM notes WHERE created_by = (SELECT id FROM users WHERE email = $1)`, [
    'alex.rivera@demo.minicrm.app',
  ]);
  await pool.query(
    `DELETE FROM custom_field_values WHERE record_id IN (
       SELECT id FROM contacts WHERE is_demo = true
       UNION SELECT id FROM deals WHERE is_demo = true
     )`,
  );
  await pool.query(`DELETE FROM custom_field_definitions WHERE name = ANY($1::text[])`, [
    DEMO_CUSTOM_FIELD_NAMES_CTRL,
  ]);
  await pool.query(`DELETE FROM webhook_subscriptions WHERE url = ANY($1::text[])`, [
    DEMO_WEBHOOK_URLS_CTRL,
  ]);
  await pool.query(`DELETE FROM currencies WHERE code = ANY($1::text[]) AND is_home = false`, [
    DEMO_CURRENCY_CODES_CTRL,
  ]);
  await pool.query('DELETE FROM leads WHERE is_demo = true');
  await pool.query(
    `DELETE FROM contact_addresses WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await pool.query(
    `DELETE FROM contact_tags WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await pool.query(
    `DELETE FROM account_tags WHERE account_id IN (SELECT id FROM accounts WHERE is_demo = true)`,
  );
  await pool.query(
    `DELETE FROM deal_tags WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)`,
  );
  await pool.query(
    `DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM contact_tags)
      AND id NOT IN (SELECT tag_id FROM account_tags)
      AND id NOT IN (SELECT tag_id FROM deal_tags)`,
  );
  await pool.query('DELETE FROM automation_rules WHERE is_demo = true');
  await pool.query('DELETE FROM activities WHERE is_demo = true');
  await pool.query(
    `DELETE FROM deal_contacts
     WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)
        OR contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await pool.query('DELETE FROM deals WHERE is_demo = true');
  await pool.query('DELETE FROM contacts WHERE is_demo = true');
  await pool.query('DELETE FROM accounts WHERE is_demo = true');
  // Remove demo rep user created by insertDemoData
  await pool.query(`DELETE FROM users WHERE email = 'alex.rivera@demo.minicrm.app'`);
}

beforeEach(async () => {
  // Fixtures first, matching beforeAll's order: clearDemoData resolves users by email and
  // prunes owned rows, and the owner FKs are ON DELETE RESTRICT — so running it against a
  // database whose fixtures a sibling spec wiped can fail on rows it cannot remove.
  // Re-established every test because that wipe, or an interrupted prior run, removes
  // them. (MINCRM-704)
  await ensureFixtureUsers();
  await clearDemoData();
});

afterAll(async () => {
  await clearDemoData();
  // Remove notes created_by these test users before deleting them
  await pool.query(
    `DELETE FROM notes WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  // Restore demo_data flag to its seeded default
  await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'demo_data'`);
});

// ── GET /api/admin/demo/status ────────────────────────────────────────────────

describe('GET /api/admin/demo/status', () => {
  it('returns 200 with a status object', async () => {
    const res = await request(app).get('/api/v1/admin/demo/status').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.active).toBe('boolean');
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app).get('/api/v1/admin/demo/status').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/admin/demo/status');

    expect(res.status).toBe(401);
  });
});

// ── POST /api/admin/demo/seed ─────────────────────────────────────────────────

describe('POST /api/admin/demo/seed', () => {
  it('seeds demo data and returns 200 with success:true', async () => {
    const res = await request(app).post('/api/v1/admin/demo/seed').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 409 DEMO_ALREADY_EXISTS when demo data is already present', async () => {
    // First seed succeeds
    await request(app).post('/api/v1/admin/demo/seed').set('Cookie', adminCookie);

    // Second seed should conflict
    const res = await request(app).post('/api/v1/admin/demo/seed').set('Cookie', adminCookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEMO_ALREADY_EXISTS');
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app).post('/api/v1/admin/demo/seed').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/v1/admin/demo/seed');

    expect(res.status).toBe(401);
  });
});

// ── POST /api/admin/demo/reset ────────────────────────────────────────────────

describe('POST /api/admin/demo/reset', () => {
  // seed + reset together exercise ~2× the full demo dataset; 300 s covers even slow CI.
  it('resets demo data and returns 200 with success:true', async () => {
    // Seed first so there is something to reset
    await request(app).post('/api/v1/admin/demo/seed').set('Cookie', adminCookie);

    const res = await request(app).post('/api/v1/admin/demo/reset').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  }, 300_000);

  it('returns 403 for a rep', async () => {
    const res = await request(app).post('/api/v1/admin/demo/reset').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/v1/admin/demo/reset');

    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/admin/demo ────────────────────────────────────────────────────

describe('DELETE /api/admin/demo', () => {
  it('removes demo data and returns 200 with success:true', async () => {
    await request(app).post('/api/v1/admin/demo/seed').set('Cookie', adminCookie);

    const res = await request(app).delete('/api/v1/admin/demo').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 409 DEMO_NOT_PRESENT when no demo data exists', async () => {
    const res = await request(app).delete('/api/v1/admin/demo').set('Cookie', adminCookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEMO_NOT_PRESENT');
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app).delete('/api/v1/admin/demo').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).delete('/api/v1/admin/demo');

    expect(res.status).toBe(401);
  });
});
