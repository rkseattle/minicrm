/**
 * HTTP contract tests for AI field exclusion admin endpoints.
 *
 * Covers:
 *  - GET /admin/ai/field-exclusions: admin-only, returns the effective exclusion list
 *  - PATCH /admin/ai/field-exclusions: admin-only, validates body, persists, rejects unknown fields
 *  - Role enforcement: reps receive 403 on both routes
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';
import { invalidateFieldExclusionCache } from '../ai/piiFilter.js';

const FILE_PREFIX = 'ai-field-excl-ctrl';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Field Excl Admin',
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

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Field Excl Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

beforeEach(async () => {
  await pool.query('DELETE FROM ai_field_exclusions');
  invalidateFieldExclusionCache();
});

describe('role enforcement', () => {
  it('GET /admin/ai/field-exclusions returns 403 for reps', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/field-exclusions')
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('PATCH /admin/ai/field-exclusions returns 403 for reps', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/field-exclusions')
      .set('Cookie', repCookie)
      .send({ entity_type: 'contact', field_name: 'department', excluded: true });
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/ai/field-exclusions', () => {
  it('returns 200 with always_excluded, standard_fields, and custom_fields', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/field-exclusions')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.always_excluded)).toBe(true);
    expect(Array.isArray(res.body.standard_fields)).toBe(true);
    expect(Array.isArray(res.body.custom_fields)).toBe(true);
    expect(res.body.always_excluded).toContain('password_hash');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/v1/admin/ai/field-exclusions');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /admin/ai/field-exclusions', () => {
  it('sets a standard field exclusion', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/field-exclusions')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'contact', field_name: 'department', excluded: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      entity_type: 'contact',
      field_name: 'department',
      excluded: true,
    });
  });

  it('returns 400 for an unknown field name', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/field-exclusions')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'contact', field_name: 'not_a_real_field', excluded: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('returns 400 for an invalid entity_type', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/field-exclusions')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'widget', field_name: 'name', excluded: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when excluded is missing', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/field-exclusions')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'contact', field_name: 'department' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
