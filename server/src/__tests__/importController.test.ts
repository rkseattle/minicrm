/**
 * HTTP contract tests for importController.
 * Uses Buffer-based CSV strings (no real file I/O) to keep tests fast.
 * Verifies parse/run endpoints for accounts, contacts, and deals, plus role enforcement.
 * Run endpoints now return 202 + job_id; tests poll GET /jobs/:id until complete.
 * (MINCRM-196, MINCRM-255)
 */

import 'dotenv/config';
import request, { type Response } from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const ADMIN_EMAIL = 'admin-import-ctrl@example.com';
const REP_EMAIL = 'rep-import-ctrl@example.com';

let _adminId: string;
let adminCookie: string;
let repCookie: string;

/** Minimal valid CSV buffers for each entity type */
const ACCOUNTS_CSV = Buffer.from('Name,Industry\nAcme Corp,Technology\nBeta Inc,Finance\n');
const CONTACTS_CSV = Buffer.from(
  'First Name,Last Name,Email\nAlice,Smith,alice.import@example.com\nBob,Jones,bob.import@example.com\n',
);
const DEALS_CSV = Buffer.from('Deal Name,Stage\nDeal One,Prospecting\nDeal Two,Qualification\n');

/** Poll GET /api/admin/import/jobs/:id until status is 'complete' or 'failed'. */
async function waitForJob(jobId: string, cookie: string, timeoutMs = 10000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app).get(`/api/admin/import/jobs/${jobId}`).set('Cookie', cookie);
    if (res.body.status === 'complete' || res.body.status === 'failed') {
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
}

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Import Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  _adminId = admin.id;
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Import Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  // Clean up imported test data in FK-safe order (deals reference accounts/contacts)
  await pool.query(`DELETE FROM deals WHERE name IN ('Deal One','Deal Two')`);
  await pool.query(`DELETE FROM accounts WHERE name IN ('Acme Corp','Beta Inc')`);
  await pool.query(
    `DELETE FROM contacts WHERE email IN ('alice.import@example.com','bob.import@example.com')`,
  );
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);
});

// ── POST /api/admin/import/accounts/parse ─────────────────────────────────────

describe('POST /api/admin/import/accounts/parse', () => {
  it('returns headers, preview, and fields on valid CSV upload', async () => {
    const res = await request(app)
      .post('/api/admin/import/accounts/parse')
      .set('Cookie', adminCookie)
      .attach('file', ACCOUNTS_CSV, { filename: 'accounts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.headers)).toBe(true);
    expect(Array.isArray(res.body.preview)).toBe(true);
    expect(Array.isArray(res.body.fields)).toBe(true);
    expect(res.body.headers).toContain('Name');
  });

  it('returns 400 when no file is provided', async () => {
    const res = await request(app)
      .post('/api/admin/import/accounts/parse')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app)
      .post('/api/admin/import/accounts/parse')
      .set('Cookie', repCookie)
      .attach('file', ACCOUNTS_CSV, { filename: 'accounts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(403);
  });
});

// ── POST /api/admin/import/accounts/run ───────────────────────────────────────

describe('POST /api/admin/import/accounts/run', () => {
  beforeEach(async () => {
    await pool.query(`DELETE FROM accounts WHERE name IN ('Acme Corp','Beta Inc')`);
  });

  it('returns 202 with job_id and completes with created count', async () => {
    const mapping = JSON.stringify({ name: 'Name', industry: 'Industry' });

    const res = await request(app)
      .post('/api/admin/import/accounts/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', ACCOUNTS_CSV, { filename: 'accounts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(202);
    expect(typeof res.body.job_id).toBe('string');
    expect(res.body.status).toBe('pending');

    const jobRes = await waitForJob(res.body.job_id, adminCookie);
    expect(jobRes.body.status).toBe('complete');
    expect(jobRes.body.created).toBe(2);
    expect(typeof jobRes.body.skipped).toBe('number');
  });

  it('returns skipped count when duplicate accounts are re-imported', async () => {
    const mapping = JSON.stringify({ name: 'Name', industry: 'Industry' });

    // First import
    const firstRes = await request(app)
      .post('/api/admin/import/accounts/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', ACCOUNTS_CSV, { filename: 'accounts.csv', contentType: 'text/csv' });
    await waitForJob(firstRes.body.job_id, adminCookie);

    // Second import — should skip duplicates
    const res = await request(app)
      .post('/api/admin/import/accounts/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', ACCOUNTS_CSV, { filename: 'accounts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(202);
    const jobRes = await waitForJob(res.body.job_id, adminCookie);
    expect(jobRes.body.status).toBe('complete');
    expect(jobRes.body.skipped).toBe(2);
    expect(jobRes.body.created).toBe(0);
  });

  it('returns 400 when mapping JSON is invalid', async () => {
    const res = await request(app)
      .post('/api/admin/import/accounts/run')
      .set('Cookie', adminCookie)
      .field('mapping', 'not-valid-json')
      .attach('file', ACCOUNTS_CSV, { filename: 'accounts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when mapping is missing required name field', async () => {
    const mapping = JSON.stringify({ industry: 'Industry' }); // name is required

    const res = await request(app)
      .post('/api/admin/import/accounts/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', ACCOUNTS_CSV, { filename: 'accounts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 for a rep', async () => {
    const mapping = JSON.stringify({ name: 'Name' });

    const res = await request(app)
      .post('/api/admin/import/accounts/run')
      .set('Cookie', repCookie)
      .field('mapping', mapping)
      .attach('file', ACCOUNTS_CSV, { filename: 'accounts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(403);
  });
});

// ── POST /api/admin/import/contacts/parse ─────────────────────────────────────

describe('POST /api/admin/import/contacts/parse', () => {
  it('returns headers, preview, and fields on valid CSV upload', async () => {
    const res = await request(app)
      .post('/api/admin/import/contacts/parse')
      .set('Cookie', adminCookie)
      .attach('file', CONTACTS_CSV, { filename: 'contacts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.headers)).toBe(true);
    expect(Array.isArray(res.body.preview)).toBe(true);
    expect(Array.isArray(res.body.fields)).toBe(true);
  });

  it('returns 400 when no file is provided', async () => {
    const res = await request(app)
      .post('/api/admin/import/contacts/parse')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── POST /api/admin/import/contacts/run ───────────────────────────────────────

describe('POST /api/admin/import/contacts/run', () => {
  beforeEach(async () => {
    await pool.query(
      `DELETE FROM contacts WHERE email IN ('alice.import@example.com','bob.import@example.com')`,
    );
  });

  it('returns 202 with job_id and completes with created count', async () => {
    const mapping = JSON.stringify({
      first_name: 'First Name',
      last_name: 'Last Name',
      email: 'Email',
    });

    const res = await request(app)
      .post('/api/admin/import/contacts/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', CONTACTS_CSV, { filename: 'contacts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(202);
    expect(typeof res.body.job_id).toBe('string');

    const jobRes = await waitForJob(res.body.job_id, adminCookie);
    expect(jobRes.body.status).toBe('complete');
    expect(jobRes.body.created).toBe(2);
    expect(typeof jobRes.body.skipped).toBe('number');
  });

  it('reports failed count when required column data is missing from CSV', async () => {
    const badCsv = Buffer.from('First Name,Last Name,Email\nNoEmail,,\n');
    const mapping = JSON.stringify({
      first_name: 'First Name',
      last_name: 'Last Name',
      email: 'Email',
    });

    const res = await request(app)
      .post('/api/admin/import/contacts/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', badCsv, { filename: 'contacts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(202);
    const jobRes = await waitForJob(res.body.job_id, adminCookie);
    expect(jobRes.body.status).toBe('complete');
    expect(jobRes.body.failed).toBeGreaterThan(0);
  });

  it('skips duplicate emails on second import', async () => {
    const mapping = JSON.stringify({
      first_name: 'First Name',
      last_name: 'Last Name',
      email: 'Email',
    });

    const firstRes = await request(app)
      .post('/api/admin/import/contacts/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', CONTACTS_CSV, { filename: 'contacts.csv', contentType: 'text/csv' });
    await waitForJob(firstRes.body.job_id, adminCookie);

    const res = await request(app)
      .post('/api/admin/import/contacts/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', CONTACTS_CSV, { filename: 'contacts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(202);
    const jobRes = await waitForJob(res.body.job_id, adminCookie);
    expect(jobRes.body.status).toBe('complete');
    expect(jobRes.body.skipped).toBeGreaterThan(0);
  });

  it('returns 400 when required mapping fields are missing', async () => {
    const mapping = JSON.stringify({ first_name: 'First Name' }); // missing last_name and email

    const res = await request(app)
      .post('/api/admin/import/contacts/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', CONTACTS_CSV, { filename: 'contacts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 for a rep', async () => {
    const mapping = JSON.stringify({
      first_name: 'First Name',
      last_name: 'Last Name',
      email: 'Email',
    });

    const res = await request(app)
      .post('/api/admin/import/contacts/run')
      .set('Cookie', repCookie)
      .field('mapping', mapping)
      .attach('file', CONTACTS_CSV, { filename: 'contacts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(403);
  });
});

// ── POST /api/admin/import/deals/parse ────────────────────────────────────────

describe('POST /api/admin/import/deals/parse', () => {
  it('returns headers, preview, and fields on valid CSV upload', async () => {
    const res = await request(app)
      .post('/api/admin/import/deals/parse')
      .set('Cookie', adminCookie)
      .attach('file', DEALS_CSV, { filename: 'deals.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.headers)).toBe(true);
    expect(Array.isArray(res.body.preview)).toBe(true);
    expect(Array.isArray(res.body.fields)).toBe(true);
  });

  it('returns 400 when no file is provided', async () => {
    const res = await request(app).post('/api/admin/import/deals/parse').set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── POST /api/admin/import/deals/run ──────────────────────────────────────────

describe('POST /api/admin/import/deals/run', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM deals WHERE name IN ('Deal One','Deal Two')`);
  });

  it('returns 202 with job_id and completes with created count', async () => {
    const mapping = JSON.stringify({ name: 'Deal Name', stage: 'Stage' });

    const res = await request(app)
      .post('/api/admin/import/deals/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', DEALS_CSV, { filename: 'deals.csv', contentType: 'text/csv' });

    expect(res.status).toBe(202);
    expect(typeof res.body.job_id).toBe('string');

    const jobRes = await waitForJob(res.body.job_id, adminCookie);
    expect(jobRes.body.status).toBe('complete');
    expect(jobRes.body.created).toBe(2);
    expect(typeof jobRes.body.skipped).toBe('number');
  });

  it('returns 400 when required mapping fields are missing', async () => {
    const mapping = JSON.stringify({ name: 'Deal Name' }); // stage is required

    const res = await request(app)
      .post('/api/admin/import/deals/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', DEALS_CSV, { filename: 'deals.csv', contentType: 'text/csv' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 for a rep', async () => {
    const mapping = JSON.stringify({ name: 'Deal Name', stage: 'Stage' });

    const res = await request(app)
      .post('/api/admin/import/deals/run')
      .set('Cookie', repCookie)
      .field('mapping', mapping)
      .attach('file', DEALS_CSV, { filename: 'deals.csv', contentType: 'text/csv' });

    expect(res.status).toBe(403);
  });
});
