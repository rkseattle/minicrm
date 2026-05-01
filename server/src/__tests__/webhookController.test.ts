/**
 * Integration tests for the webhook controller. (MINCRM-295)
 * Covers: create, list, get, update, delete subscriptions and list delivery logs.
 * All endpoints are admin-only.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'wh-ctrl';

let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'WH Admin',
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

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'WH Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM webhook_subscriptions WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── POST /api/v1/admin/webhooks ───────────────────────────────────────────────

describe('POST /api/v1/admin/webhooks', () => {
  it('creates a subscription and returns 201 with plaintextSecret', async () => {
    const res = await request(app)
      .post('/api/v1/admin/webhooks')
      .set('Cookie', adminCookie)
      .send({ url: 'https://example.com/hook', events: ['contact.created'] });

    expect(res.status).toBe(201);
    expect(res.body.subscription.url).toBe('https://example.com/hook');
    expect(typeof res.body.plaintextSecret).toBe('string');
    expect(res.body.subscription).not.toHaveProperty('secret_hash');
  });

  it('returns 400 VALIDATION_ERROR when url is missing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/webhooks')
      .set('Cookie', adminCookie)
      .send({ events: ['contact.created'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep tries to create a subscription', async () => {
    const res = await request(app)
      .post('/api/v1/admin/webhooks')
      .set('Cookie', repCookie)
      .send({ url: 'https://example.com/hook', events: ['contact.created'] });

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/v1/admin/webhooks')
      .send({ url: 'https://example.com/hook', events: ['contact.created'] });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/admin/webhooks ────────────────────────────────────────────────

describe('GET /api/v1/admin/webhooks', () => {
  it('returns 200 with a subscriptions array', async () => {
    const res = await request(app).get('/api/v1/admin/webhooks').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.subscriptions)).toBe(true);
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app).get('/api/v1/admin/webhooks').set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/v1/admin/webhooks/:id ───────────────────────────────────────────

describe('GET /api/v1/admin/webhooks/:id', () => {
  it('returns 200 with the subscription', async () => {
    const createRes = await request(app)
      .post('/api/v1/admin/webhooks')
      .set('Cookie', adminCookie)
      .send({ url: 'https://example.com/get-test', events: ['deal.created'] });
    const id = createRes.body.subscription.id as string;

    const res = await request(app).get(`/api/v1/admin/webhooks/${id}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.subscription.id).toBe(id);
    expect(res.body.subscription).not.toHaveProperty('secret_hash');
  });

  it('returns 404 for a non-existent subscription', async () => {
    const res = await request(app)
      .get('/api/v1/admin/webhooks/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── PATCH /api/v1/admin/webhooks/:id ─────────────────────────────────────────

describe('PATCH /api/v1/admin/webhooks/:id', () => {
  it('updates the url and returns 200', async () => {
    const createRes = await request(app)
      .post('/api/v1/admin/webhooks')
      .set('Cookie', adminCookie)
      .send({ url: 'https://example.com/before', events: ['contact.created'] });
    const id = createRes.body.subscription.id as string;

    const res = await request(app)
      .patch(`/api/v1/admin/webhooks/${id}`)
      .set('Cookie', adminCookie)
      .send({ url: 'https://example.com/after' });

    expect(res.status).toBe(200);
    expect(res.body.subscription.url).toBe('https://example.com/after');
  });

  it('returns 400 VALIDATION_ERROR for an invalid status value', async () => {
    const createRes = await request(app)
      .post('/api/v1/admin/webhooks')
      .set('Cookie', adminCookie)
      .send({ url: 'https://example.com/status-test', events: ['contact.created'] });
    const id = createRes.body.subscription.id as string;

    const res = await request(app)
      .patch(`/api/v1/admin/webhooks/${id}`)
      .set('Cookie', adminCookie)
      .send({ status: 'broken' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for a non-existent subscription', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/webhooks/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .send({ url: 'https://example.com/nope' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── DELETE /api/v1/admin/webhooks/:id ────────────────────────────────────────

describe('DELETE /api/v1/admin/webhooks/:id', () => {
  it('deletes the subscription and returns 204', async () => {
    const createRes = await request(app)
      .post('/api/v1/admin/webhooks')
      .set('Cookie', adminCookie)
      .send({ url: 'https://example.com/delete-me', events: ['contact.created'] });
    const id = createRes.body.subscription.id as string;

    const res = await request(app)
      .delete(`/api/v1/admin/webhooks/${id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 404 for a non-existent subscription', async () => {
    const res = await request(app)
      .delete('/api/v1/admin/webhooks/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── GET /api/v1/admin/webhooks/:id/logs ──────────────────────────────────────

describe('GET /api/v1/admin/webhooks/:id/logs', () => {
  it('returns 200 with paginated delivery logs for a valid subscription', async () => {
    const createRes = await request(app)
      .post('/api/v1/admin/webhooks')
      .set('Cookie', adminCookie)
      .send({ url: 'https://example.com/logs-test', events: ['contact.created'] });
    const id = createRes.body.subscription.id as string;

    const res = await request(app)
      .get(`/api/v1/admin/webhooks/${id}/logs`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns 404 when the subscription does not exist', async () => {
    const res = await request(app)
      .get('/api/v1/admin/webhooks/00000000-0000-0000-0000-000000000000/logs')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for an invalid pagination param', async () => {
    const createRes = await request(app)
      .post('/api/v1/admin/webhooks')
      .set('Cookie', adminCookie)
      .send({ url: 'https://example.com/logs-page', events: ['contact.created'] });
    const id = createRes.body.subscription.id as string;

    const res = await request(app)
      .get(`/api/v1/admin/webhooks/${id}/logs?limit=999`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
