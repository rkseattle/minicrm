/**
 * HTTP contract tests for noteController. (MINCRM-352)
 *
 * Covers paths that are not exercised by noteService.test.ts (service-layer unit tests):
 *   - listNotes: pagination params validated with safeParse → 400 on bad input (not 500)
 *   - listNotes: invalid entityType → 400
 *   - listNotes: invalid entityId UUID → 400
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'note-ctrl';

let adminCookie: string;
let contactId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Note Ctrl Admin',
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

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Note', 'Ctrl', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-contact@example.com`, admin.id],
  );
  contactId = contactResult.rows[0]!.id;
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.end();
});

describe('GET /api/v1/:entityType/:entityId/notes', () => {
  it('returns 400 with VALIDATION_ERROR when page is not a number', async () => {
    const res = await request(app)
      .get(`/api/v1/contact/${contactId}/notes?page=abc`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 with VALIDATION_ERROR when limit is zero', async () => {
    const res = await request(app)
      .get(`/api/v1/contact/${contactId}/notes?limit=0`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 with VALIDATION_ERROR when entityType is unknown', async () => {
    const res = await request(app)
      .get(`/api/v1/invoice/${contactId}/notes`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 with VALIDATION_ERROR when entityId is not a UUID', async () => {
    const res = await request(app)
      .get('/api/v1/contact/not-a-uuid/notes')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with paginated notes for a valid contact entity', async () => {
    const res = await request(app)
      .get(`/api/v1/contact/${contactId}/notes?page=1&limit=5`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get(`/api/v1/contact/${contactId}/notes`);
    expect(res.status).toBe(401);
  });
});
