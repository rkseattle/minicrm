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
    const res = await request(app).get('/api/v1/settings/default-language');

    expect(res.status).toBe(200);
    expect(typeof res.body.language).toBe('string');
  });
});

// ── PATCH /api/settings/default-language ─────────────────────────────────────

describe('PATCH /api/settings/default-language', () => {
  it('updates the default language and returns 200', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/default-language')
      .set('Cookie', adminCookie)
      .send({ language: 'es' });

    expect(res.status).toBe(200);
    expect(res.body.language).toBe('es');

    // Restore to English
    await request(app)
      .patch('/api/v1/settings/default-language')
      .set('Cookie', adminCookie)
      .send({ language: 'en' });
  });

  it('returns 400 when language is invalid', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/default-language')
      .set('Cookie', adminCookie)
      .send({ language: 'klingon' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep attempts to update', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/default-language')
      .set('Cookie', repCookie)
      .send({ language: 'fr' });

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/default-language')
      .send({ language: 'fr' });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/settings/nav-layout ─────────────────────────────────────────────

describe('GET /api/settings/nav-layout', () => {
  it('returns 200 with a layout string (public endpoint)', async () => {
    const res = await request(app).get('/api/v1/settings/nav-layout');

    expect(res.status).toBe(200);
    expect(typeof res.body.layout).toBe('string');
  });
});

// ── PATCH /api/settings/nav-layout ───────────────────────────────────────────

describe('PATCH /api/settings/nav-layout', () => {
  it('updates the nav layout and returns 200', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/nav-layout')
      .set('Cookie', adminCookie)
      .send({ layout: 'left' });

    expect(res.status).toBe(200);
    expect(res.body.layout).toBe('left');
  });

  it('returns 400 when layout value is invalid', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/nav-layout')
      .set('Cookie', adminCookie)
      .send({ layout: 'unknown-layout' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep attempts to update', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/nav-layout')
      .set('Cookie', repCookie)
      .send({ layout: 'sidebar' });

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).patch('/api/v1/settings/nav-layout').send({ layout: 'left' });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/settings/email-notifications ────────────────────────────────────

describe('GET /api/settings/email-notifications', () => {
  it('returns 200 with an enabled boolean', async () => {
    const res = await request(app)
      .get('/api/v1/settings/email-notifications')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.enabled).toBe('boolean');
  });

  it('is accessible to authenticated reps', async () => {
    const res = await request(app)
      .get('/api/v1/settings/email-notifications')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.enabled).toBe('boolean');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/settings/email-notifications');

    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/settings/email-notifications ───────────────────────────────────

describe('PATCH /api/settings/email-notifications', () => {
  it('enables email notifications and returns 200', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/email-notifications')
      .set('Cookie', adminCookie)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it('disables email notifications and returns 200', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/email-notifications')
      .set('Cookie', adminCookie)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/email-notifications')
      .set('Cookie', adminCookie)
      .send({ enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep attempts to update', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/email-notifications')
      .set('Cookie', repCookie)
      .send({ enabled: false });

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/email-notifications')
      .send({ enabled: true });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/settings/onboarding (MINCRM-256, MINCRM-379) ────────────────────

describe('GET /api/settings/onboarding', () => {
  it('returns 200 with is_first_run, onboarding_completed, and tasks for admin', async () => {
    const res = await request(app).get('/api/v1/settings/onboarding').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.is_first_run).toBe('boolean');
    expect(typeof res.body.onboarding_completed).toBe('boolean');
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body.tasks).toHaveLength(5);
    for (const task of res.body.tasks as { id: string; completed: boolean }[]) {
      expect(typeof task.id).toBe('string');
      expect(typeof task.completed).toBe('boolean');
    }
  });

  it('returns 403 when a rep attempts to access', async () => {
    const res = await request(app).get('/api/v1/settings/onboarding').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/settings/onboarding');

    expect(res.status).toBe(401);
  });
});

// ── PUT /api/settings/onboarding (MINCRM-256) ─────────────────────────────────

describe('PUT /api/settings/onboarding', () => {
  afterEach(async () => {
    // Reset flag after each test
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('onboarding_completed', 'false', now())
       ON CONFLICT (key) DO UPDATE SET value = 'false', updated_at = now()`,
    );
  });

  it('sets onboarding_completed to true and returns 200', async () => {
    const res = await request(app)
      .put('/api/v1/settings/onboarding')
      .set('Cookie', adminCookie)
      .send({ onboarding_completed: true });

    expect(res.status).toBe(200);
    expect(res.body.onboarding_completed).toBe(true);
  });

  it('returns 400 when onboarding_completed is not a boolean', async () => {
    const res = await request(app)
      .put('/api/v1/settings/onboarding')
      .set('Cookie', adminCookie)
      .send({ onboarding_completed: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep attempts to update', async () => {
    const res = await request(app)
      .put('/api/v1/settings/onboarding')
      .set('Cookie', repCookie)
      .send({ onboarding_completed: true });

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .put('/api/v1/settings/onboarding')
      .send({ onboarding_completed: true });

    expect(res.status).toBe(401);
  });
});
