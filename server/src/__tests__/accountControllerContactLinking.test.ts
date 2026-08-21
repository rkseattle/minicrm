/**
 * Integration tests for contact-linking via the account controller endpoints.
 *
 * Verifies that POST /api/v1/accounts and PATCH /api/v1/accounts/:id correctly
 * link and unlink contacts when contact_ids is provided.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'acct-link-ctrl';

let repId: string;
let repCookie: string;

/** Helper — inserts a bare contact row and returns its id */
async function insertContact(email: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Test', 'Contact', $1, $2)
     RETURNING id`,
    [email, repId],
  );
  return result.rows[0].id;
}

/** Helper — fetches account_id for a contact */
async function getContactAccountId(contactId: string): Promise<string | null> {
  const result = await pool.query<{ account_id: string | null }>(
    'SELECT account_id FROM contacts WHERE id = $1',
    [contactId],
  );
  return result.rows[0]?.account_id ?? null;
}

beforeAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Rep User',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── POST /api/v1/accounts — contact_ids ────────────────────────────────────────────

describe('POST /api/v1/accounts — contact_ids', () => {
  it('links contacts to the new account when contact_ids is provided', async () => {
    const contactId = await insertContact('post-link@example.com');

    const res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', repCookie)
      .send({ name: 'New Corp', contact_ids: [contactId] });

    expect(res.status).toBe(201);
    expect(res.body.account.id).toBeDefined();
    expect(await getContactAccountId(contactId)).toBe(res.body.account.id);
  });

  it('creates account without linking when contact_ids is omitted', async () => {
    const contactId = await insertContact('post-no-link@example.com');

    const res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', repCookie)
      .send({ name: 'No Link Corp' });

    expect(res.status).toBe(201);
    expect(await getContactAccountId(contactId)).toBeNull();
  });

  it('returns 400 when contact_ids contains a non-UUID value', async () => {
    const res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', repCookie)
      .send({ name: 'Bad Corp', contact_ids: ['not-a-uuid'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('links multiple contacts atomically', async () => {
    const contactA = await insertContact('post-multi-a@example.com');
    const contactB = await insertContact('post-multi-b@example.com');

    const res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', repCookie)
      .send({ name: 'Multi Link Corp', contact_ids: [contactA, contactB] });

    expect(res.status).toBe(201);
    expect(await getContactAccountId(contactA)).toBe(res.body.account.id);
    expect(await getContactAccountId(contactB)).toBe(res.body.account.id);
  });
});

// ── PATCH /api/v1/accounts/:id — contact_ids ────────────────────────────────────────

describe('PATCH /api/v1/accounts/:id — contact_ids', () => {
  it('links new contacts when contact_ids is provided', async () => {
    const createRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', repCookie)
      .send({ name: 'Patch Corp' });
    const accountId: string = createRes.body.account.id;

    const contactId = await insertContact('patch-link@example.com');
    const version: number = createRes.body.account.version;

    const res = await request(app)
      .patch(`/api/v1/accounts/${accountId}`)
      .set('Cookie', repCookie)
      .send({ contact_ids: [contactId], version });

    expect(res.status).toBe(200);
    expect(await getContactAccountId(contactId)).toBe(accountId);
  });

  it('unlinks contacts removed from contact_ids', async () => {
    const contactA = await insertContact('patch-unlink-a@example.com');
    const contactB = await insertContact('patch-unlink-b@example.com');

    const createRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', repCookie)
      .send({ name: 'Unlink Corp', contact_ids: [contactA, contactB] });
    const accountId: string = createRes.body.account.id;
    const version: number = createRes.body.account.version;

    // Update to keep only contactA
    const res = await request(app)
      .patch(`/api/v1/accounts/${accountId}`)
      .set('Cookie', repCookie)
      .send({ contact_ids: [contactA], version });

    expect(res.status).toBe(200);
    expect(await getContactAccountId(contactA)).toBe(accountId);
    expect(await getContactAccountId(contactB)).toBeNull();
  });

  it('updates account fields and contact links together', async () => {
    const contactId = await insertContact('patch-combined@example.com');

    const createRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', repCookie)
      .send({ name: 'Combined Corp' });
    const accountId: string = createRes.body.account.id;
    const version: number = createRes.body.account.version;

    const res = await request(app)
      .patch(`/api/v1/accounts/${accountId}`)
      .set('Cookie', repCookie)
      .send({ name: 'Renamed Corp', contact_ids: [contactId], version });

    expect(res.status).toBe(200);
    expect(res.body.account.name).toBe('Renamed Corp');
    expect(await getContactAccountId(contactId)).toBe(accountId);
  });

  it('does not change contact links when contact_ids is omitted', async () => {
    const contactId = await insertContact('patch-preserve@example.com');

    const createRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', repCookie)
      .send({ name: 'Preserve Corp', contact_ids: [contactId] });
    const accountId: string = createRes.body.account.id;
    const version: number = createRes.body.account.version;

    // Update name only — contact link must be preserved
    const res = await request(app)
      .patch(`/api/v1/accounts/${accountId}`)
      .set('Cookie', repCookie)
      .send({ name: 'Still Linked Corp', version });

    expect(res.status).toBe(200);
    expect(await getContactAccountId(contactId)).toBe(accountId);
  });
});
