/**
 * Integration tests for the bulk controller.
 *
 * Covers: bulk reassign, bulk delete, and bulk stage change for contacts,
 * accounts, and deals — including ownership enforcement and validation errors.
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createContact } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import { createDeal } from '../services/dealService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

const FILE_PREFIX = 'bulk-ctrl';

const VALID_STAGE = 'Prospecting';
const TARGET_STAGE = 'Qualification';

let repId: string;
let repCookie: string;
let otherRepId: string;
let otherRepCookie: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query(
    `DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Bulk Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const otherRep = await createUser({
    email: `${FILE_PREFIX}-other@example.com`,
    name: 'Other Bulk Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherRepId = otherRep.id;
  otherRepCookie = makeAuthCookie({
    id: otherRep.id,
    email: otherRep.email,
    name: otherRep.name,
    role: otherRep.role,
  });

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Bulk Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
});

beforeEach(async () => {
  await pool.query(
    `DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── POST /api/contacts/bulk ───────────────────────────────────────────────────

describe('POST /api/contacts/bulk — reassign', () => {
  it('rep can bulk reassign their own contacts', async () => {
    const c1 = await createContact({
      first_name: 'Bulk',
      last_name: 'One',
      email: `${FILE_PREFIX}-${uid()}-c1@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/contacts/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'reassign', ids: [c1.id], owner_id: otherRepId });

    expect(res.status).toBe(200);
    expect(res.body.affected).toBeGreaterThanOrEqual(1);
  });

  it('rep cannot bulk reassign contacts they do not own (returns 403)', async () => {
    const c1 = await createContact({
      first_name: 'Bulk',
      last_name: 'NotMine',
      email: `${FILE_PREFIX}-${uid()}-notmine@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/contacts/bulk')
      .set('Cookie', otherRepCookie)
      .send({ action: 'reassign', ids: [c1.id], owner_id: repId });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('admin can bulk reassign contacts owned by any rep', async () => {
    const c1 = await createContact({
      first_name: 'Bulk',
      last_name: 'Admin',
      email: `${FILE_PREFIX}-${uid()}-adminbulk@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/contacts/bulk')
      .set('Cookie', adminCookie)
      .send({ action: 'reassign', ids: [c1.id], owner_id: otherRepId });

    expect(res.status).toBe(200);
  });

  it('returns 400 when owner_id is missing for a reassign action', async () => {
    const c1 = await createContact({
      first_name: 'Bulk',
      last_name: 'NoOwner',
      email: `${FILE_PREFIX}-${uid()}-noowner@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/contacts/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'reassign', ids: [c1.id] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when ids is empty', async () => {
    const res = await request(app)
      .post('/api/v1/contacts/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'delete', ids: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/contacts/bulk — delete', () => {
  it('rep can bulk delete their own contacts', async () => {
    const c1 = await createContact({
      first_name: 'Bulk',
      last_name: 'Del',
      email: `${FILE_PREFIX}-${uid()}-del@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/contacts/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'delete', ids: [c1.id] });

    expect(res.status).toBe(200);
    expect(res.body.affected).toBeGreaterThanOrEqual(1);
  });
});

// ── POST /api/accounts/bulk ───────────────────────────────────────────────────

describe('POST /api/accounts/bulk — reassign', () => {
  it('rep can bulk reassign their own accounts', async () => {
    const acct = await createAccount({
      name: `BulkAcct-${uid()}`,
      industry: 'Technology',
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/accounts/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'reassign', ids: [acct.id], owner_id: otherRepId });

    expect(res.status).toBe(200);
    expect(res.body.affected).toBeGreaterThanOrEqual(1);
  });

  it('rep cannot bulk reassign accounts they do not own (returns 403)', async () => {
    const acct = await createAccount({
      name: `BulkAcct-${uid()}-notmine`,
      industry: 'Finance',
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/accounts/bulk')
      .set('Cookie', otherRepCookie)
      .send({ action: 'reassign', ids: [acct.id], owner_id: repId });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 when owner_id is missing for a reassign action', async () => {
    const acct = await createAccount({
      name: `BulkAcct-${uid()}-noowner`,
      industry: 'Technology',
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/accounts/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'reassign', ids: [acct.id] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/accounts/bulk — delete', () => {
  it('rep can bulk delete their own accounts', async () => {
    const acct = await createAccount({
      name: `BulkAcct-${uid()}-del`,
      industry: 'Technology',
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/accounts/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'delete', ids: [acct.id] });

    expect(res.status).toBe(200);
    expect(res.body.affected).toBeGreaterThanOrEqual(1);
  });
});

// ── POST /api/deals/bulk ──────────────────────────────────────────────────────

describe('POST /api/deals/bulk — reassign', () => {
  it('rep can bulk reassign their own deals', async () => {
    const deal = await createDeal({
      name: `BulkDeal-${uid()}`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/deals/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'reassign', ids: [deal.id], owner_id: otherRepId });

    expect(res.status).toBe(200);
    expect(res.body.affected).toBeGreaterThanOrEqual(1);
  });

  it('rep cannot bulk reassign deals they do not own (returns 403)', async () => {
    const deal = await createDeal({
      name: `BulkDeal-${uid()}-notmine`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/deals/bulk')
      .set('Cookie', otherRepCookie)
      .send({ action: 'reassign', ids: [deal.id], owner_id: repId });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/deals/bulk — change_stage', () => {
  it('rep can bulk change stage on their own deals', async () => {
    const deal = await createDeal({
      name: `BulkDeal-${uid()}-stage`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/deals/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'change_stage', ids: [deal.id], stage: TARGET_STAGE });

    expect(res.status).toBe(200);
    expect(res.body.affected).toBeGreaterThanOrEqual(1);
  });

  it('returns 400 when stage is missing for change_stage action', async () => {
    const deal = await createDeal({
      name: `BulkDeal-${uid()}-nostage`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/deals/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'change_stage', ids: [deal.id] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when the target stage does not exist', async () => {
    const deal = await createDeal({
      name: `BulkDeal-${uid()}-badstage`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/deals/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'change_stage', ids: [deal.id], stage: 'NoSuchStage' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/deals/bulk — delete', () => {
  it('rep can bulk delete their own deals', async () => {
    const deal = await createDeal({
      name: `BulkDeal-${uid()}-del`,
      stage: VALID_STAGE,
      currency: 'USD',
      owner_id: repId,
    });

    const res = await request(app)
      .post('/api/v1/deals/bulk')
      .set('Cookie', repCookie)
      .send({ action: 'delete', ids: [deal.id] });

    expect(res.status).toBe(200);
    expect(res.body.affected).toBeGreaterThanOrEqual(1);
  });
});
