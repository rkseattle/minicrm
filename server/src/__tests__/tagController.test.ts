/**
 * Integration tests for the tag controller. (MINCRM-295)
 *
 * Covers: global tag CRUD (list, create, rename, delete, get by id) and
 * entity-scoped tag endpoints for contacts.
 *
 * Note: the MINCRM-263 tag creation restriction setting is covered by
 * tagCreationRestriction.test.ts — those tests are not duplicated here.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

const FILE_PREFIX = 'tag-ctrl';

let repId: string;
let repCookie: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Tag Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Tag Admin',
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
  await pool.query('DELETE FROM tags WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM tags WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── GET /api/tags ─────────────────────────────────────────────────────────────

describe('GET /api/tags', () => {
  it('returns 200 with a tags array', async () => {
    const res = await request(app).get('/api/v1/tags').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tags)).toBe(true);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/tags');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/tags ────────────────────────────────────────────────────────────

describe('POST /api/tags', () => {
  it('creates a tag and returns 201', async () => {
    const name = `${FILE_PREFIX}-${uid()}`;

    const res = await request(app).post('/api/v1/tags').set('Cookie', repCookie).send({ name });

    expect(res.status).toBe(201);
    expect(res.body.tag.name).toBe(name);
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const res = await request(app).post('/api/v1/tags').set('Cookie', repCookie).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns the existing tag (201) when the same name is submitted twice (idempotent)', async () => {
    const name = `${FILE_PREFIX}-${uid()}-idem`;

    const first = await request(app).post('/api/v1/tags').set('Cookie', repCookie).send({ name });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/v1/tags').set('Cookie', repCookie).send({ name });
    expect(second.status).toBe(201);
    expect(second.body.tag.id).toBe(first.body.tag.id);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/v1/tags')
      .send({ name: `${FILE_PREFIX}-unauth` });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/tags/:id ─────────────────────────────────────────────────────────

describe('GET /api/tags/:id', () => {
  it('returns 200 with the tag body', async () => {
    const name = `${FILE_PREFIX}-${uid()}-get`;
    const createRes = await request(app)
      .post('/api/v1/tags')
      .set('Cookie', adminCookie)
      .send({ name });
    const tagId: string = createRes.body.tag.id;

    const res = await request(app).get(`/api/v1/tags/${tagId}`).set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.tag.id).toBe(tagId);
    expect(res.body.tag.name).toBe(name);
  });

  it('returns 404 for a non-existent tag', async () => {
    const res = await request(app)
      .get('/api/v1/tags/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── PATCH /api/tags/:id ───────────────────────────────────────────────────────

describe('PATCH /api/tags/:id — admin only rename', () => {
  it('renames a tag and returns 200', async () => {
    const origName = `${FILE_PREFIX}-${uid()}-rename-orig`;
    const newName = `${FILE_PREFIX}-${uid()}-rename-new`;

    const createRes = await request(app)
      .post('/api/v1/tags')
      .set('Cookie', adminCookie)
      .send({ name: origName });
    const tagId: string = createRes.body.tag.id;

    const res = await request(app)
      .patch(`/api/v1/tags/${tagId}`)
      .set('Cookie', adminCookie)
      .send({ name: newName });

    expect(res.status).toBe(200);
    expect(res.body.tag.name).toBe(newName);
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const createRes = await request(app)
      .post('/api/v1/tags')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-${uid()}-rename-val` });
    const tagId: string = createRes.body.tag.id;

    const res = await request(app)
      .patch(`/api/v1/tags/${tagId}`)
      .set('Cookie', adminCookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep attempts to rename a tag', async () => {
    const createRes = await request(app)
      .post('/api/v1/tags')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-${uid()}-rename-403` });
    const tagId: string = createRes.body.tag.id;

    const res = await request(app)
      .patch(`/api/v1/tags/${tagId}`)
      .set('Cookie', repCookie)
      .send({ name: 'HijackedName' });

    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent tag', async () => {
    const res = await request(app)
      .patch('/api/v1/tags/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/tags/:id ──────────────────────────────────────────────────────

describe('DELETE /api/tags/:id — admin only delete', () => {
  it('deletes a tag and returns 204', async () => {
    const createRes = await request(app)
      .post('/api/v1/tags')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-${uid()}-del` });
    const tagId: string = createRes.body.tag.id;

    const res = await request(app).delete(`/api/v1/tags/${tagId}`).set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 403 when a rep attempts to delete a tag', async () => {
    const createRes = await request(app)
      .post('/api/v1/tags')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-${uid()}-del-403` });
    const tagId: string = createRes.body.tag.id;

    const res = await request(app).delete(`/api/v1/tags/${tagId}`).set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent tag', async () => {
    const res = await request(app)
      .delete('/api/v1/tags/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── GET /api/contacts/:id/tags ────────────────────────────────────────────────

describe('GET /api/contacts/:id/tags', () => {
  it('returns 200 with an empty tags array for a contact with no tags', async () => {
    const contact = await createContact({
      first_name: 'Tag',
      last_name: 'Test',
      email: `${FILE_PREFIX}-${uid()}-notagcontact@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .get(`/api/v1/contacts/${contact.id}/tags`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual([]);
  });
});

// ── POST /api/contacts/:id/tags ───────────────────────────────────────────────

describe('POST /api/contacts/:id/tags', () => {
  it('attaches a tag by name and returns 201', async () => {
    const contact = await createContact({
      first_name: 'Tag',
      last_name: 'Attach',
      email: `${FILE_PREFIX}-${uid()}-attachcontact@example.com`,
      owner_id: repId,
    });
    const tagName = `${FILE_PREFIX}-${uid()}-attach`;

    const res = await request(app)
      .post(`/api/v1/contacts/${contact.id}/tags`)
      .set('Cookie', repCookie)
      .send({ name: tagName });

    expect(res.status).toBe(201);
    expect(res.body.tag.name).toBe(tagName);
  });

  it('returns 400 when name is missing', async () => {
    const contact = await createContact({
      first_name: 'Tag',
      last_name: 'NoName',
      email: `${FILE_PREFIX}-${uid()}-noname@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .post(`/api/v1/contacts/${contact.id}/tags`)
      .set('Cookie', repCookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── DELETE /api/contacts/:id/tags/:tagId ──────────────────────────────────────

describe('DELETE /api/contacts/:id/tags/:tagId', () => {
  it('detaches a tag from a contact and returns 204', async () => {
    const contact = await createContact({
      first_name: 'Tag',
      last_name: 'Detach',
      email: `${FILE_PREFIX}-${uid()}-detachcontact@example.com`,
      owner_id: repId,
    });
    const tagName = `${FILE_PREFIX}-${uid()}-detach`;

    const attachRes = await request(app)
      .post(`/api/v1/contacts/${contact.id}/tags`)
      .set('Cookie', repCookie)
      .send({ name: tagName });
    const tagId: string = attachRes.body.tag.id;

    const res = await request(app)
      .delete(`/api/v1/contacts/${contact.id}/tags/${tagId}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(204);
  });
});
