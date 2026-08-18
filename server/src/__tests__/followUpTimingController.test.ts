/**
 * HTTP contract tests for follow-up timing suggestion endpoints.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'followup-timing-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;
const OTHER_REP_EMAIL = `${FILE_PREFIX}-other-rep@example.com`;
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;

let repCookie: string;
let repId: string;
let otherRepCookie: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Follow-up Timing Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
  const otherRep = await createUser({
    email: OTHER_REP_EMAIL,
    name: 'Other Follow-up Timing Rep',
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
  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Follow-up Timing Admin',
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
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('GET /api/v1/contacts/:id/followup-timing', () => {
  it('returns 401 without authentication', async () => {
    const contactResult = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      ['Test', 'Contact', `${FILE_PREFIX}-unauth@example.com`, repId],
    );
    await request(app)
      .get(`/api/v1/contacts/${contactResult.rows[0].id}/followup-timing`)
      .expect(401);
  });

  it('returns null suggestion for a contact with insufficient interaction history', async () => {
    const contactResult = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      ['Sparse', 'Contact', `${FILE_PREFIX}-sparse@example.com`, repId],
    );
    const res = await request(app)
      .get(`/api/v1/contacts/${contactResult.rows[0].id}/followup-timing`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.suggestion).toBeNull();
  });

  it('returns 404 for a non-existent contact', async () => {
    await request(app)
      .get('/api/v1/contacts/00000000-0000-0000-0000-000000000000/followup-timing')
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('returns 403 when a rep requests timing for a contact owned by another rep under a private visibility policy', async () => {
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'contact'`,
    );
    try {
      const contactResult = await pool.query<{ id: string }>(
        `INSERT INTO contacts (first_name, last_name, email, owner_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        ['CrossOwner', 'Contact', `${FILE_PREFIX}-crossowner@example.com`, repId],
      );
      await request(app)
        .get(`/api/v1/contacts/${contactResult.rows[0].id}/followup-timing`)
        .set('Cookie', otherRepCookie)
        .expect(403);
    } finally {
      await pool.query(
        `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'contact'`,
      );
    }
  });

  it('allows an admin to view timing for a contact owned by a rep', async () => {
    const contactResult = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      ['AdminViewable', 'Contact', `${FILE_PREFIX}-adminviewable@example.com`, repId],
    );
    await request(app)
      .get(`/api/v1/contacts/${contactResult.rows[0].id}/followup-timing`)
      .set('Cookie', adminCookie)
      .expect(200);
  });
});

describe('GET/PATCH /api/v1/settings/default-timezone', () => {
  it('is readable without authentication (public endpoint)', async () => {
    const res = await request(app).get('/api/v1/settings/default-timezone').expect(200);
    expect(res.body).toHaveProperty('timezone');
  });

  it('rejects a PATCH from a non-admin rep', async () => {
    await request(app)
      .patch('/api/v1/settings/default-timezone')
      .set('Cookie', repCookie)
      .send({ timezone: 'America/Chicago' })
      .expect(403);
  });

  it('rejects an invalid IANA timezone identifier', async () => {
    await request(app)
      .patch('/api/v1/settings/default-timezone')
      .set('Cookie', adminCookie)
      .send({ timezone: 'Not/A_Real_Zone' })
      .expect(400);
  });

  it('allows an admin to persist a valid IANA timezone', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/default-timezone')
      .set('Cookie', adminCookie)
      .send({ timezone: 'America/Chicago' })
      .expect(200);

    expect(res.body.timezone).toBe('America/Chicago');

    // Restore default for subsequent test runs.
    await request(app)
      .patch('/api/v1/settings/default-timezone')
      .set('Cookie', adminCookie)
      .send({ timezone: 'UTC' })
      .expect(200);
  });
});
