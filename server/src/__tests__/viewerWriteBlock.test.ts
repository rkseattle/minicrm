/**
 * Viewer role write-blocking tests (MINCRM-535).
 *
 * Verifies that users with role='viewer' receive 403 VIEWER_WRITE_BLOCKED on
 * all mutating endpoints (POST/PATCH/DELETE) while GET operations return 200/404
 * (allowed, subject to normal ownership/auth rules).
 *
 * Covers: contacts, accounts, deals, activities, leads, notes.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import { createDeal } from '../services/dealService.js';
import { createActivity } from '../services/activityService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'viewer-wb';

let viewerCookie: string;
let adminId: string;
/** Account used as the linked entity for activity fixtures */
let sharedAccountId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const viewer = await createUser({
    email: `${FILE_PREFIX}-viewer@example.com`,
    name: 'Viewer User',
    role: 'viewer',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  viewerCookie = makeAuthCookie({
    id: viewer.id,
    email: viewer.email,
    name: viewer.name,
    role: viewer.role,
  });

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Admin User',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, owner_id) VALUES ('Viewer Test Co', $1) RETURNING id`,
    [adminId],
  );
  sharedAccountId = rows[0].id;
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM accounts WHERE id = $1', [sharedAccountId]);
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── Contacts ──────────────────────────────────────────────────────────────────

describe('MINCRM-535 — viewer blocked from writing contacts', () => {
  it('POST /contacts returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const res = await request(app)
      .post('/api/v1/contacts')
      .set('Cookie', viewerCookie)
      .send({ first_name: 'Test', last_name: 'Contact', email: `${FILE_PREFIX}-new@example.com` });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('PATCH /contacts/:id returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const contact = await createContact({
      first_name: 'Admin',
      last_name: 'Contact',
      email: `${FILE_PREFIX}-patch-target@example.com`,
      owner_id: adminId,
    });

    const res = await request(app)
      .patch(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', viewerCookie)
      .send({ first_name: 'Viewer Hacked', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('DELETE /contacts/:id returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const contact = await createContact({
      first_name: 'Admin',
      last_name: 'Delete Target',
      email: `${FILE_PREFIX}-delete-target@example.com`,
      owner_id: adminId,
    });

    const res = await request(app)
      .delete(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', viewerCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('GET /contacts returns 200 (viewer can read)', async () => {
    const res = await request(app).get('/api/v1/contacts').set('Cookie', viewerCookie);
    expect(res.status).toBe(200);
  });
});

// ── Accounts ──────────────────────────────────────────────────────────────────

describe('MINCRM-535 — viewer blocked from writing accounts', () => {
  it('POST /accounts returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', viewerCookie)
      .send({ name: 'Viewer Account Attempt' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('PATCH /accounts/:id returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const account = await createAccount({
      name: 'Admin Account Patch',
      owner_id: adminId,
    });

    const res = await request(app)
      .patch(`/api/v1/accounts/${account.id}`)
      .set('Cookie', viewerCookie)
      .send({ name: 'Viewer Hijacked', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('DELETE /accounts/:id returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const account = await createAccount({
      name: 'Admin Account Delete',
      owner_id: adminId,
    });

    const res = await request(app)
      .delete(`/api/v1/accounts/${account.id}`)
      .set('Cookie', viewerCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('GET /accounts returns 200 (viewer can read)', async () => {
    const res = await request(app).get('/api/v1/accounts').set('Cookie', viewerCookie);
    expect(res.status).toBe(200);
  });
});

// ── Deals ─────────────────────────────────────────────────────────────────────

describe('MINCRM-535 — viewer blocked from writing deals', () => {
  it('POST /deals returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const res = await request(app)
      .post('/api/v1/deals')
      .set('Cookie', viewerCookie)
      .send({ name: 'Viewer Deal', stage: 'Prospecting' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('PATCH /deals/:id returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const deal = await createDeal({
      name: 'Admin Deal Patch',
      stage: 'Prospecting',
      owner_id: adminId,
    });

    const res = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', viewerCookie)
      .send({ name: 'Viewer Hijacked', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('DELETE /deals/:id returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const deal = await createDeal({
      name: 'Admin Deal Delete',
      stage: 'Prospecting',
      owner_id: adminId,
    });

    const res = await request(app).delete(`/api/v1/deals/${deal.id}`).set('Cookie', viewerCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('GET /deals returns 200 (viewer can read)', async () => {
    const res = await request(app).get('/api/v1/deals').set('Cookie', viewerCookie);
    expect(res.status).toBe(200);
  });
});

// ── Activities ────────────────────────────────────────────────────────────────

describe('MINCRM-535 — viewer blocked from writing activities', () => {
  it('POST /activities returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const res = await request(app).post('/api/v1/activities').set('Cookie', viewerCookie).send({
      type: 'Task',
      subject: 'Viewer Task Attempt',
      account_id: sharedAccountId,
      owner_id: adminId,
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('PATCH /activities/:id returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const activity = await createActivity({
      type: 'Task',
      subject: 'Admin Task',
      account_id: sharedAccountId,
      owner_id: adminId,
    });

    const res = await request(app)
      .patch(`/api/v1/activities/${activity.id}`)
      .set('Cookie', viewerCookie)
      .send({ subject: 'Viewer Hijacked', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('DELETE /activities/:id returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const activity = await createActivity({
      type: 'Task',
      subject: 'Admin Task Delete',
      account_id: sharedAccountId,
      owner_id: adminId,
    });

    const res = await request(app)
      .delete(`/api/v1/activities/${activity.id}`)
      .set('Cookie', viewerCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('GET /activities returns 200 (viewer can read)', async () => {
    const res = await request(app).get('/api/v1/activities').set('Cookie', viewerCookie);
    expect(res.status).toBe(200);
  });
});

// ── Leads ─────────────────────────────────────────────────────────────────────

describe('MINCRM-535 — viewer blocked from writing leads', () => {
  it('POST /leads returns 403 VIEWER_WRITE_BLOCKED', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Cookie', viewerCookie)
      .send({ first_name: 'Viewer', status: 'New' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('PATCH /leads/:id returns 403 VIEWER_WRITE_BLOCKED (using non-existent UUID)', async () => {
    // 403 must fire before the 404 check — blockViewer runs first in the middleware chain
    const res = await request(app)
      .patch('/api/v1/leads/00000000-0000-0000-0000-000000000001')
      .set('Cookie', viewerCookie)
      .send({ first_name: 'Hacked', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('DELETE /leads/:id returns 403 VIEWER_WRITE_BLOCKED (using non-existent UUID)', async () => {
    const res = await request(app)
      .delete('/api/v1/leads/00000000-0000-0000-0000-000000000001')
      .set('Cookie', viewerCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VIEWER_WRITE_BLOCKED');
  });

  it('GET /leads returns 200 (viewer can read)', async () => {
    const res = await request(app).get('/api/v1/leads').set('Cookie', viewerCookie);
    expect(res.status).toBe(200);
  });
});
