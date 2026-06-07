/**
 * HTTP contract tests for aiConfigController.
 *
 * Covers:
 *  - Role enforcement: reps receive 403 on all /admin/ai/* routes
 *  - GET /admin/ai/config returns config shape (api_key never present)
 *  - PATCH /admin/ai/config persists changes
 *  - PATCH /admin/ai/master-toggle validates body
 *  - POST /admin/ai/dpa-acknowledgment validates body
 *  - POST /admin/ai/test-connection validates body and returns ok/message
 *
 * (MINCRM-457)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'ai-ctrl';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let adminCookie: string;
let repCookie: string;

const AI_KEYS = [
  'ai_enabled',
  'ai_enabled_updated_at',
  'ai_provider',
  'ai_model',
  'ai_api_key',
  'ai_deployment_mode',
  'ai_base_url',
  'ai_dpa_acknowledged',
  'ai_dpa_acknowledged_by',
  'ai_dpa_acknowledged_at',
  'ai_dpa_acknowledged_for_provider',
  'ai_custom_dpa_url',
];

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'AI Admin',
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
    email: REP_EMAIL,
    name: 'AI Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

beforeEach(async () => {
  await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [AI_KEYS]);
});

afterAll(async () => {
  await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [AI_KEYS]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  // Do NOT call pool.end() — this file runs in the parallel Vitest project
  // and pool is a shared singleton. Calling end() here terminates it for all
  // other concurrent test files and causes "Cannot use a pool after calling end".
});

// ── Role enforcement ──────────────────────────────────────────────────────────

describe('role enforcement — rep receives 403', () => {
  it('GET /admin/ai/config', async () => {
    const res = await request(app).get('/api/v1/admin/ai/config').set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('PATCH /admin/ai/config', async () => {
    const res = await request(app).patch('/api/v1/admin/ai/config').set('Cookie', repCookie).send({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      deployment_mode: 'cloud_api',
    });
    expect(res.status).toBe(403);
  });

  it('PATCH /admin/ai/master-toggle', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/master-toggle')
      .set('Cookie', repCookie)
      .send({ enabled: true });
    expect(res.status).toBe(403);
  });

  it('POST /admin/ai/dpa-acknowledgment', async () => {
    const res = await request(app)
      .post('/api/v1/admin/ai/dpa-acknowledgment')
      .set('Cookie', repCookie)
      .send({ acknowledged: true });
    expect(res.status).toBe(403);
  });

  it('POST /admin/ai/test-connection', async () => {
    const res = await request(app)
      .post('/api/v1/admin/ai/test-connection')
      .set('Cookie', repCookie)
      .send({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        deployment_mode: 'cloud_api',
      });
    expect(res.status).toBe(403);
  });
});

// ── Unauthenticated receives 401 ──────────────────────────────────────────────

describe('unauthenticated receives 401', () => {
  it('GET /admin/ai/config', async () => {
    const res = await request(app).get('/api/v1/admin/ai/config');
    expect(res.status).toBe(401);
  });
});

// ── GET /admin/ai/config ──────────────────────────────────────────────────────

describe('GET /admin/ai/config', () => {
  it('returns the AI configuration shape without an api_key field', async () => {
    const res = await request(app).get('/api/v1/admin/ai/config').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: expect.any(Boolean),
      provider: 'anthropic',
      model: expect.any(String),
      api_key_set: false,
      deployment_mode: 'cloud_api',
      dpa_status: 'not_acknowledged',
    });
    expect(res.body).not.toHaveProperty('api_key');
    expect(Array.isArray(res.body.available_models)).toBe(true);
  });
});

// ── PATCH /admin/ai/config ────────────────────────────────────────────────────

describe('PATCH /admin/ai/config', () => {
  it('persists provider and model changes', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/config')
      .set('Cookie', adminCookie)
      .send({
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        deployment_mode: 'cloud_api',
        base_url: '',
        custom_dpa_url: '',
      });
    expect(res.status).toBe(200);
    expect(res.body.model).toBe('claude-opus-4-8');
    expect(res.body).not.toHaveProperty('api_key');
  });

  it('returns 400 when model is missing', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/config')
      .set('Cookie', adminCookie)
      .send({ provider: 'anthropic', deployment_mode: 'cloud_api' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when deployment_mode is private_endpoint without base_url', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/config')
      .set('Cookie', adminCookie)
      .send({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        deployment_mode: 'private_endpoint',
        base_url: '',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('marks api_key_set = true when a key is provided', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/config')
      .set('Cookie', adminCookie)
      .send({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        deployment_mode: 'cloud_api',
        base_url: '',
        custom_dpa_url: '',
        api_key: 'sk-ant-test-key',
      });
    expect(res.status).toBe(200);
    expect(res.body.api_key_set).toBe(true);
    expect(res.body).not.toHaveProperty('api_key');
  });
});

// ── PATCH /admin/ai/master-toggle ─────────────────────────────────────────────

describe('PATCH /admin/ai/master-toggle', () => {
  it('enables and disables AI', async () => {
    const enableRes = await request(app)
      .patch('/api/v1/admin/ai/master-toggle')
      .set('Cookie', adminCookie)
      .send({ enabled: true });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.enabled).toBe(true);
    expect(enableRes.body.enabled_updated_at).not.toBeNull();

    const disableRes = await request(app)
      .patch('/api/v1/admin/ai/master-toggle')
      .set('Cookie', adminCookie)
      .send({ enabled: false });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.enabled).toBe(false);
  });

  it('returns 400 when enabled is missing', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/master-toggle')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── POST /admin/ai/dpa-acknowledgment ─────────────────────────────────────────

describe('POST /admin/ai/dpa-acknowledgment', () => {
  it('records an acknowledgment', async () => {
    const res = await request(app)
      .post('/api/v1/admin/ai/dpa-acknowledgment')
      .set('Cookie', adminCookie)
      .send({ acknowledged: true, custom_dpa_url: '' });
    expect(res.status).toBe(200);
    expect(res.body.dpa_acknowledged).toBe(true);
    expect(res.body.dpa_acknowledged_by).toBe('AI Admin');
  });

  it('returns 400 when acknowledged is missing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/ai/dpa-acknowledgment')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── POST /admin/ai/test-connection ────────────────────────────────────────────

describe('POST /admin/ai/test-connection', () => {
  it('returns ok:false and a message when no API key is configured', async () => {
    const res = await request(app)
      .post('/api/v1/admin/ai/test-connection')
      .set('Cookie', adminCookie)
      .send({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        deployment_mode: 'cloud_api',
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, message: expect.any(String) });
  });

  it('returns 400 when provider is missing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/ai/test-connection')
      .set('Cookie', adminCookie)
      .send({ model: 'claude-sonnet-4-20250514', deployment_mode: 'cloud_api' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when deployment_mode is private_endpoint without base_url', async () => {
    const res = await request(app)
      .post('/api/v1/admin/ai/test-connection')
      .set('Cookie', adminCookie)
      .send({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        deployment_mode: 'private_endpoint',
        base_url: '',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
