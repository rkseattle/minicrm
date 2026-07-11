/**
 * HTTP contract tests for AI sentiment tracking endpoints. (MINCRM-472)
 *
 * Covers:
 *  - GET /contacts/:id/sentiment-trend: authenticated, visibility-enforced
 *  - GET /accounts/:id/sentiment-trend: authenticated, visibility-enforced
 *  - POST /activities/:id/sentiment/flag-inaccurate: authenticated, visibility-enforced
 *  - Unauthenticated requests are rejected
 *
 * Trend computation itself (scoring, windowing, aggregation) is covered by
 * sentimentService.test.ts — these tests exercise the controller's
 * request/response shaping and access-control surface only.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'sentiment-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;
const OTHER_REP_EMAIL = `${FILE_PREFIX}-other-rep@example.com`;

let repCookie: string;
let repId: string;
let otherRepCookie: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Sentiment Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
  const otherRep = await createUser({
    email: OTHER_REP_EMAIL,
    name: 'Other Sentiment Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherRepCookie = makeAuthCookie({
    id: otherRep.id,
    email: otherRep.email,
    role: otherRep.role,
    name: otherRep.name,
  });
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

async function createTestContact(ownerId: string): Promise<string> {
  const contact = await createContact(
    {
      first_name: 'Jane',
      last_name: `Doe-${Date.now()}-${Math.random()}`,
      email: `jane-${Date.now()}-${Math.random()}@example.com`,
      owner_id: ownerId,
    },
    { id: ownerId, name: 'Sentiment Rep' },
  );
  return contact.id;
}

async function createTestAccount(ownerId: string): Promise<string> {
  const account = await createAccount(
    { name: `Sentiment-Acct-${Date.now()}-${Math.random()}`, owner_id: ownerId },
    { id: ownerId, name: 'Sentiment Rep' },
  );
  return account.id;
}

describe('GET /api/v1/contacts/:id/sentiment-trend', () => {
  it('returns 401 without authentication', async () => {
    const contactId = await createTestContact(repId);
    await request(app).get(`/api/v1/contacts/${contactId}/sentiment-trend`).expect(401);
  });

  it('returns 404 for a non-existent contact', async () => {
    await request(app)
      .get('/api/v1/contacts/00000000-0000-0000-0000-000000000000/sentiment-trend')
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('allows a rep to view the trend for a contact they own', async () => {
    const contactId = await createTestContact(repId);
    const res = await request(app)
      .get(`/api/v1/contacts/${contactId}/sentiment-trend`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.has_sufficient_data).toBe(false);
  });

  it('returns 403 when a rep requests a contact owned by another rep under a private visibility policy', async () => {
    // Default org visibility policy is 'org' (all reps see all records) — this
    // test asserts the private-policy denial path, so it must set that policy
    // explicitly rather than relying on an unstated default.
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'contact'`,
    );
    try {
      const contactId = await createTestContact(repId);
      await request(app)
        .get(`/api/v1/contacts/${contactId}/sentiment-trend`)
        .set('Cookie', otherRepCookie)
        .expect(403);
    } finally {
      await pool.query(
        `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'contact'`,
      );
    }
  });
});

describe('GET /api/v1/accounts/:id/sentiment-trend', () => {
  it('returns 401 without authentication', async () => {
    const accountId = await createTestAccount(repId);
    await request(app).get(`/api/v1/accounts/${accountId}/sentiment-trend`).expect(401);
  });

  it('returns 404 for a non-existent account', async () => {
    await request(app)
      .get('/api/v1/accounts/00000000-0000-0000-0000-000000000000/sentiment-trend')
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('allows a rep to view the trend for an account they own', async () => {
    const accountId = await createTestAccount(repId);
    const res = await request(app)
      .get(`/api/v1/accounts/${accountId}/sentiment-trend`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.has_sufficient_data).toBe(false);
  });

  it('allows a rep to view the trend for an account owned by another rep under the default org policy', async () => {
    const accountId = await createTestAccount(repId);
    await request(app)
      .get(`/api/v1/accounts/${accountId}/sentiment-trend`)
      .set('Cookie', otherRepCookie)
      .expect(200);
  });

  it('returns 403 when a rep requests an account owned by another rep under a private visibility policy', async () => {
    // Default org visibility policy is 'org' (all reps see all records) — this
    // test asserts the private-policy denial path, so it must set that policy
    // explicitly rather than relying on an unstated default.
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'account'`,
    );
    try {
      const accountId = await createTestAccount(repId);
      await request(app)
        .get(`/api/v1/accounts/${accountId}/sentiment-trend`)
        .set('Cookie', otherRepCookie)
        .expect(403);
    } finally {
      await pool.query(
        `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'account'`,
      );
    }
  });
});

describe('POST /api/v1/activities/:id/sentiment/flag-inaccurate', () => {
  it('returns 401 without authentication', async () => {
    await request(app)
      .post('/api/v1/activities/00000000-0000-0000-0000-000000000000/sentiment/flag-inaccurate')
      .expect(401);
  });

  it('returns 404 for a non-existent activity', async () => {
    await request(app)
      .post('/api/v1/activities/00000000-0000-0000-0000-000000000000/sentiment/flag-inaccurate')
      .set('Cookie', repCookie)
      .expect(404);
  });
});
