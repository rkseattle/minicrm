/**
 * Integration tests for the custom field controller. (MINCRM-295)
 * Covers: definitions CRUD (list, create, update, delete) and values get/put.
 * All definition mutations are admin-only; value reads/writes are authenticated.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

const FILE_PREFIX = 'cf-ctrl';

let adminCookie: string;
let repCookie: string;
let adminId: string;
let repId: string;

beforeAll(async () => {
  await pool.query(`DELETE FROM custom_field_definitions WHERE name LIKE $1`, [`${FILE_PREFIX}-%`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'CF Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'CF Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query(`DELETE FROM custom_field_definitions WHERE name LIKE $1`, [`${FILE_PREFIX}-%`]);
  await pool.query(
    `DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── GET /api/v1/custom-fields/definitions ────────────────────────────────────

describe('GET /api/v1/custom-fields/definitions', () => {
  it('returns 200 with a definitions array for a valid entity_type', async () => {
    const res = await request(app)
      .get('/api/v1/custom-fields/definitions?entity_type=contact')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.definitions)).toBe(true);
  });

  it('returns 400 VALIDATION_ERROR for an invalid entity_type', async () => {
    const res = await request(app)
      .get('/api/v1/custom-fields/definitions?entity_type=invoice')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when entity_type is missing', async () => {
    const res = await request(app)
      .get('/api/v1/custom-fields/definitions')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/custom-fields/definitions?entity_type=contact');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/custom-fields/definitions ───────────────────────────────────

describe('POST /api/v1/custom-fields/definitions', () => {
  it('creates a definition and returns 201', async () => {
    const name = `${FILE_PREFIX}-field-${uid()}`;
    const res = await request(app)
      .post('/api/v1/custom-fields/definitions')
      .set('Cookie', adminCookie)
      .send({ name, entity_type: 'contact', field_type: 'text' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(name);
    expect(res.body.entity_type).toBe('contact');
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/custom-fields/definitions')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'contact', field_type: 'text' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 CUSTOM_FIELD_NAME_CONFLICT on a duplicate name', async () => {
    const name = `${FILE_PREFIX}-dupe-${uid()}`;
    await request(app)
      .post('/api/v1/custom-fields/definitions')
      .set('Cookie', adminCookie)
      .send({ name, entity_type: 'contact', field_type: 'text' });

    const res = await request(app)
      .post('/api/v1/custom-fields/definitions')
      .set('Cookie', adminCookie)
      .send({ name, entity_type: 'contact', field_type: 'text' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOM_FIELD_NAME_CONFLICT');
  });

  it('returns 403 when a rep tries to create a definition', async () => {
    const res = await request(app)
      .post('/api/v1/custom-fields/definitions')
      .set('Cookie', repCookie)
      .send({ name: `${FILE_PREFIX}-rep-field`, entity_type: 'contact', field_type: 'text' });

    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/v1/custom-fields/definitions/:id ──────────────────────────────

describe('PATCH /api/v1/custom-fields/definitions/:id', () => {
  it('updates the definition sort_order and returns 200', async () => {
    const createRes = await request(app)
      .post('/api/v1/custom-fields/definitions')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-patch-${uid()}`, entity_type: 'contact', field_type: 'text' });
    const id = createRes.body.id as string;

    const res = await request(app)
      .patch(`/api/v1/custom-fields/definitions/${id}`)
      .set('Cookie', adminCookie)
      .send({ sort_order: 99 });

    expect(res.status).toBe(200);
    expect(res.body.sort_order).toBe(99);
  });

  it('returns 404 for a non-existent definition', async () => {
    const res = await request(app)
      .patch('/api/v1/custom-fields/definitions/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .send({ sort_order: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for an invalid field_type', async () => {
    const createRes = await request(app)
      .post('/api/v1/custom-fields/definitions')
      .set('Cookie', adminCookie)
      .send({
        name: `${FILE_PREFIX}-valid-${uid()}`,
        entity_type: 'contact',
        field_type: 'text',
      });
    const id = createRes.body.id as string;

    const res = await request(app)
      .patch(`/api/v1/custom-fields/definitions/${id}`)
      .set('Cookie', adminCookie)
      .send({ field_type: 'invalid_type' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── DELETE /api/v1/custom-fields/definitions/:id ─────────────────────────────

describe('DELETE /api/v1/custom-fields/definitions/:id', () => {
  it('deletes the definition and returns 200', async () => {
    const createRes = await request(app)
      .post('/api/v1/custom-fields/definitions')
      .set('Cookie', adminCookie)
      .send({
        name: `${FILE_PREFIX}-del-${uid()}`,
        entity_type: 'contact',
        field_type: 'text',
      });
    const id = createRes.body.id as string;

    const res = await request(app)
      .delete(`/api/v1/custom-fields/definitions/${id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it('returns 404 for a non-existent definition', async () => {
    const res = await request(app)
      .delete('/api/v1/custom-fields/definitions/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── GET /api/v1/custom-fields/:entityType/:recordId/custom-fields ─────────────

describe('GET /api/v1/custom-fields/:entityType/:recordId/custom-fields', () => {
  it('returns 200 with a values array for a valid record', async () => {
    const contact = await createContact(
      {
        first_name: 'CF',
        last_name: 'Test',
        email: `${FILE_PREFIX}-contact-${uid()}@example.com`,
        owner_id: repId,
      },
      { id: adminId, name: 'CF Admin' },
    );

    const res = await request(app)
      .get(`/api/v1/custom-fields/contact/${contact.id}/custom-fields`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.values)).toBe(true);
  });

  it('returns 400 VALIDATION_ERROR for an invalid entityType', async () => {
    const res = await request(app)
      .get(`/api/v1/custom-fields/invoice/00000000-0000-0000-0000-000000000000/custom-fields`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── PUT /api/v1/custom-fields/:entityType/:recordId/custom-fields ─────────────

describe('PUT /api/v1/custom-fields/:entityType/:recordId/custom-fields', () => {
  it('upserts values and returns 200 with values array', async () => {
    const contact = await createContact(
      {
        first_name: 'CF',
        last_name: 'Put',
        email: `${FILE_PREFIX}-put-${uid()}@example.com`,
        owner_id: repId,
      },
      { id: adminId, name: 'CF Admin' },
    );

    const defRes = await request(app)
      .post('/api/v1/custom-fields/definitions')
      .set('Cookie', adminCookie)
      .send({
        name: `${FILE_PREFIX}-put-field-${uid()}`,
        entity_type: 'contact',
        field_type: 'text',
      });
    const defId = defRes.body.id as string;

    const res = await request(app)
      .put(`/api/v1/custom-fields/contact/${contact.id}/custom-fields`)
      .set('Cookie', repCookie)
      .send([{ definition_id: defId, value: 'hello' }]);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.values)).toBe(true);
  });

  it('returns 400 VALIDATION_ERROR for an invalid entityType', async () => {
    const res = await request(app)
      .put(`/api/v1/custom-fields/invoice/00000000-0000-0000-0000-000000000000/custom-fields`)
      .set('Cookie', repCookie)
      .send([]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when body is not an array', async () => {
    const res = await request(app)
      .put(`/api/v1/custom-fields/contact/00000000-0000-0000-0000-000000000001/custom-fields`)
      .set('Cookie', repCookie)
      .send({ definition_id: 'x', value: 'y' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
