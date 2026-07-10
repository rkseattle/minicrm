/**
 * HTTP contract tests for warm introduction path endpoints. (MINCRM-468)
 *
 * Covers:
 *  - GET /contacts/:id/warm-paths: authenticated, flag-gated
 *  - Unauthenticated requests are rejected
 *  - 404 for a non-existent contact
 */

import 'dotenv/config';
import { vi } from 'vitest';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  class AuthenticationError extends Error {}
  class APIConnectionError extends Error {}
  class APIError extends Error {}
  return {
    default: Object.assign(MockAnthropic, { AuthenticationError, APIConnectionError, APIError }),
  };
});

import request from 'supertest';
import app from '../app.js';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'warm-intro-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let repCookie: string;
let repId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Warm Intro Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

async function createTestContact(): Promise<string> {
  const contact = await createContact(
    {
      first_name: 'Jane',
      last_name: `Doe-${Date.now()}-${Math.random()}`,
      email: `jane-${Date.now()}-${Math.random()}@example.com`,
      owner_id: repId,
    },
    { id: repId, name: 'Warm Intro Rep' },
  );
  return contact.id;
}

describe('GET /api/v1/contacts/:id/warm-paths', () => {
  it('returns 401 without authentication', async () => {
    const contactId = await createTestContact();
    await request(app).get(`/api/v1/contacts/${contactId}/warm-paths`).expect(401);
  });

  it('returns an empty paths array for a contact with no candidates', async () => {
    const contactId = await createTestContact();
    const res = await request(app)
      .get(`/api/v1/contacts/${contactId}/warm-paths`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body).toEqual({ target_contact_id: contactId, paths: [] });
  });

  it('returns 404 for a non-existent contact', async () => {
    await request(app)
      .get('/api/v1/contacts/00000000-0000-0000-0000-000000000000/warm-paths')
      .set('Cookie', repCookie)
      .expect(404);
  });
});
