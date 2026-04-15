/**
 * HTTP contract tests for settingsController.
 * Verifies GET/PATCH for default language, nav layout, and email notifications,
 * plus role enforcement on write operations.
 * (MINCRM-195)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const ADMIN_EMAIL = 'admin-settings-ctrl@example.com';
const REP_EMAIL = 'rep-settings-ctrl@example.com';

let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Settings Admin',
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
    name: 'Settings Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);
});

// ── GET /api/settings/default-language ───────────────────────────────────────

describe('GET /api/settings/default-language', () => {
  it('returns 200 with a language string (public endpoint)', async () => {
    const res = await request(app).get('/api/settings/default-language');

    expect(res.status).toBe(200);
    expect(typeof res.body.language).toBe('string');
  });
});

// ── PATCH /api/settings/default-language ─────────────────────────────────────

describe('PATCH /api/settings/default-language', () => {
  it('updates the default language and returns 200', async () => {
    const res = await request(app)
      .patch('/api/settings/default-language')
      .set('Cookie', adminCookie)
      .send({ language: 'es' });

    expect(res.status).toBe(200);
    expect(res.body.language).toBe('es');

    // Restore to English
    await request(app)
      .patch('/api/settings/default-language')
      .set('Cookie', adminCookie)
      .send({ language: 'en' });
  });

  it('returns 400 when language is invalid', async () => {
    const res = await request(app)
      .patch('/api/settings/default-language')
      .set('Cookie', adminCookie)
      .send({ language: 'klingon' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep attempts to update', async () => {
    const res = await request(app)
      .patch('/api/settings/default-language')
      .set('Cookie', repCookie)
      .send({ language: 'fr' });

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).patch('/api/settings/default-language').send({ language: 'fr' });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/settings/nav-layout ─────────────────────────────────────────────

describe('GET /api/settings/nav-layout', () => {
  it('returns 200 with a layout string (public endpoint)', async () => {
    const res = await request(app).get('/api/settings/nav-layout');

    expect(res.status).toBe(200);
    expect(typeof res.body.layout).toBe('string');
  });
});

// ── PATCH /api/settings/nav-layout ───────────────────────────────────────────

describe('PATCH /api/settings/nav-layout', () => {
  it('updates the nav layout and returns 200', async () => {
    const res = await request(app)
      .patch('/api/settings/nav-layout')
      .set('Cookie', adminCookie)
      .send({ layout: 'left' });

    expect(res.status).toBe(200);
    expect(res.body.layout).toBe('left');
  });

  it('returns 400 when layout value is invalid', async () => {
    const res = await request(app)
      .patch('/api/settings/nav-layout')
      .set('Cookie', adminCookie)
      .send({ layout: 'unknown-layout' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep attempts to update', async () => {
    const res = await request(app)
      .patch('/api/settings/nav-layout')
      .set('Cookie', repCookie)
      .send({ layout: 'sidebar' });

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).patch('/api/settings/nav-layout').send({ layout: 'left' });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/settings/email-notifications ────────────────────────────────────

describe('GET /api/settings/email-notifications', () => {
  it('returns 200 with an enabled boolean', async () => {
    const res = await request(app)
      .get('/api/settings/email-notifications')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.enabled).toBe('boolean');
  });

  it('is accessible to authenticated reps', async () => {
    const res = await request(app)
      .get('/api/settings/email-notifications')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.enabled).toBe('boolean');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/settings/email-notifications');

    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/settings/email-notifications ───────────────────────────────────

describe('PATCH /api/settings/email-notifications', () => {
  it('enables email notifications and returns 200', async () => {
    const res = await request(app)
      .patch('/api/settings/email-notifications')
      .set('Cookie', adminCookie)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it('disables email notifications and returns 200', async () => {
    const res = await request(app)
      .patch('/api/settings/email-notifications')
      .set('Cookie', adminCookie)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const res = await request(app)
      .patch('/api/settings/email-notifications')
      .set('Cookie', adminCookie)
      .send({ enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep attempts to update', async () => {
    const res = await request(app)
      .patch('/api/settings/email-notifications')
      .set('Cookie', repCookie)
      .send({ enabled: false });

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .patch('/api/settings/email-notifications')
      .send({ enabled: true });

    expect(res.status).toBe(401);
  });
});
