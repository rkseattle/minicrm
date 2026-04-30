/**
 * Server integration tests for the tag creation restriction setting (MINCRM-263).
 *
 * Covers:
 * - Rep blocked when tags_restrict_creation is true
 * - Admin allowed when tags_restrict_creation is true
 * - All users allowed when tags_restrict_creation is false
 * - GET /api/settings/tags-restrict-creation accessible to authenticated reps
 * - PATCH /api/settings/tags-restrict-creation restricted to admins
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { getTagsRestrictCreation, setTagsRestrictCreation } from '../services/settingsService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const ADMIN_EMAIL = 'admin-tag-restrict@example.com';
const REP_EMAIL = 'rep-tag-restrict@example.com';

let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Tag Restrict Admin',
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
    name: 'Tag Restrict Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

beforeEach(async () => {
  // Reset setting to false before each test to ensure isolation
  await setTagsRestrictCreation(false);
  // Clean up tags created during tests
  await pool.query('DELETE FROM tags WHERE name LIKE $1', ['test-restrict-%']);
});

afterAll(async () => {
  await setTagsRestrictCreation(false);
  await pool.query('DELETE FROM tags WHERE name LIKE $1', ['test-restrict-%']);
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);
});

// ── GET /api/settings/tags-restrict-creation ─────────────────────────────────

describe('GET /api/settings/tags-restrict-creation', () => {
  it('returns the current setting (false by default)', async () => {
    const res = await request(app)
      .get('/api/v1/settings/tags-restrict-creation')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.restricted).toBe(false);
  });

  it('returns true when restriction is enabled', async () => {
    await setTagsRestrictCreation(true);
    const res = await request(app)
      .get('/api/v1/settings/tags-restrict-creation')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.restricted).toBe(true);
  });

  it('is accessible to authenticated reps', async () => {
    const res = await request(app)
      .get('/api/v1/settings/tags-restrict-creation')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/settings/tags-restrict-creation');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/settings/tags-restrict-creation ───────────────────────────────

describe('PATCH /api/settings/tags-restrict-creation', () => {
  it('admin can enable restriction', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/tags-restrict-creation')
      .set('Cookie', adminCookie)
      .send({ restricted: true });

    expect(res.status).toBe(200);
    expect(res.body.restricted).toBe(true);
    expect(await getTagsRestrictCreation()).toBe(true);
  });

  it('admin can disable restriction', async () => {
    await setTagsRestrictCreation(true);
    const res = await request(app)
      .patch('/api/v1/settings/tags-restrict-creation')
      .set('Cookie', adminCookie)
      .send({ restricted: false });

    expect(res.status).toBe(200);
    expect(res.body.restricted).toBe(false);
  });

  it('returns 400 when restricted is not a boolean', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/tags-restrict-creation')
      .set('Cookie', adminCookie)
      .send({ restricted: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep attempts to update', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/tags-restrict-creation')
      .set('Cookie', repCookie)
      .send({ restricted: true });

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/tags-restrict-creation')
      .send({ restricted: true });

    expect(res.status).toBe(401);
  });
});

// ── POST /api/tags — tag creation restriction enforcement ─────────────────────

describe('POST /api/tags with restriction enabled', () => {
  it('rep is blocked with TAG_CREATION_RESTRICTED when restriction is true', async () => {
    await setTagsRestrictCreation(true);

    const res = await request(app)
      .post('/api/v1/tags')
      .set('Cookie', repCookie)
      .send({ name: 'test-restrict-blocked' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TAG_CREATION_RESTRICTED');
  });

  it('admin can create tags even when restriction is true', async () => {
    await setTagsRestrictCreation(true);

    const res = await request(app)
      .post('/api/v1/tags')
      .set('Cookie', adminCookie)
      .send({ name: 'test-restrict-admin-ok' });

    expect(res.status).toBe(201);
    expect(res.body.tag.name).toBe('test-restrict-admin-ok');
  });
});

describe('POST /api/tags with restriction disabled', () => {
  it('rep can create tags when restriction is false', async () => {
    const res = await request(app)
      .post('/api/v1/tags')
      .set('Cookie', repCookie)
      .send({ name: 'test-restrict-rep-allowed' });

    expect(res.status).toBe(201);
    expect(res.body.tag.name).toBe('test-restrict-rep-allowed');
  });

  it('admin can create tags when restriction is false', async () => {
    const res = await request(app)
      .post('/api/v1/tags')
      .set('Cookie', adminCookie)
      .send({ name: 'test-restrict-admin-allowed' });

    expect(res.status).toBe(201);
    expect(res.body.tag.name).toBe('test-restrict-admin-allowed');
  });
});
