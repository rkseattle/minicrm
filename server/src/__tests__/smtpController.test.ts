/**
 * HTTP contract tests for smtpController.
 *
 * Covers GET /api/v1/settings/smtp, PUT /api/v1/settings/smtp, and auth-boundary enforcement.
 * POST /api/v1/settings/smtp/test is not integration-tested here because it requires a
 * reachable SMTP server; the 400 validation path is covered.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const ADMIN_EMAIL = 'smtp-admin@example.com';
const REP_EMAIL = 'smtp-rep@example.com';

let adminCookie: string;
let repCookie: string;

async function resetSmtpSettings(): Promise<void> {
  // smtpController reads/writes the smtp_configuration singleton table (migration 087),
  // not system_settings — smtp_* keys in system_settings are pre-migration-087 legacy
  // remnants and are no longer consulted by getSmtpConfig/setSmtpConfig.
  await pool.query(
    `UPDATE smtp_configuration SET
       host = '', port = 587, username = '', pass_encrypted = '', enabled = false, updated_at = now()
     WHERE singleton = true`,
  );
}

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'smtp-%@example.com'");

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'SMTP Admin',
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
    name: 'SMTP Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

beforeEach(async () => {
  await resetSmtpSettings();
});

afterAll(async () => {
  await resetSmtpSettings();
  await pool.query("DELETE FROM users WHERE email LIKE 'smtp-%@example.com'");
  await pool.end();
});

describe('GET /api/v1/settings/smtp', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/settings/smtp');
    expect(res.status).toBe(401);
  });

  it('returns config for admin', async () => {
    const res = await request(app).get('/api/v1/settings/smtp').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      smtp_host: '',
      smtp_port: 587,
      smtp_user: '',
      smtp_pass_set: false,
      smtp_enabled: false,
    });
  });

  it('returns config for rep (read-only access)', async () => {
    const res = await request(app).get('/api/v1/settings/smtp').set('Cookie', repCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('smtp_pass_set');
  });

  it('never returns smtp_pass_encrypted or smtp_pass in the response', async () => {
    const res = await request(app).get('/api/v1/settings/smtp').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('smtp_pass_encrypted');
    expect(res.body).not.toHaveProperty('smtp_pass');
  });
});

describe('PUT /api/v1/settings/smtp', () => {
  it('returns 403 for rep', async () => {
    const res = await request(app)
      .put('/api/v1/settings/smtp')
      .set('Cookie', repCookie)
      .send({ smtp_host: 'smtp.example.com', smtp_port: 587, smtp_user: '', smtp_enabled: false });
    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .put('/api/v1/settings/smtp')
      .send({ smtp_host: 'smtp.example.com', smtp_port: 587, smtp_user: '', smtp_enabled: false });
    expect(res.status).toBe(401);
  });

  it('saves config and returns public view for admin', async () => {
    const res = await request(app).put('/api/v1/settings/smtp').set('Cookie', adminCookie).send({
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      smtp_user: 'user@example.com',
      smtp_pass: 'secretpass',
      smtp_enabled: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      smtp_user: 'user@example.com',
      smtp_pass_set: true,
      smtp_enabled: true,
    });
    expect(res.body).not.toHaveProperty('smtp_pass');
    expect(res.body).not.toHaveProperty('smtp_pass_encrypted');
  });

  it('returns 400 for invalid port', async () => {
    const res = await request(app).put('/api/v1/settings/smtp').set('Cookie', adminCookie).send({
      smtp_host: 'smtp.example.com',
      smtp_port: 99999,
      smtp_user: '',
      smtp_enabled: false,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('preserves password when smtp_pass is omitted', async () => {
    // First save with a password
    await request(app).put('/api/v1/settings/smtp').set('Cookie', adminCookie).send({
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_user: 'original@example.com',
      smtp_pass: 'keepthis',
      smtp_enabled: false,
    });

    // Update without smtp_pass
    const res = await request(app).put('/api/v1/settings/smtp').set('Cookie', adminCookie).send({
      smtp_host: 'smtp.updated.com',
      smtp_port: 587,
      smtp_user: 'updated@example.com',
      smtp_enabled: false,
    });
    expect(res.status).toBe(200);
    // smtp_pass_set should still be true
    expect(res.body.smtp_pass_set).toBe(true);
  });
});

describe('POST /api/v1/settings/smtp/test — validation', () => {
  it('returns 400 for invalid email address', async () => {
    const res = await request(app)
      .post('/api/v1/settings/smtp/test')
      .set('Cookie', adminCookie)
      .send({ to: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 for rep', async () => {
    const res = await request(app)
      .post('/api/v1/settings/smtp/test')
      .set('Cookie', repCookie)
      .send({ to: 'someone@example.com' });
    expect(res.status).toBe(403);
  });

  it('returns { success: false } when smtp_host is not configured', async () => {
    // No host is set (reset in beforeEach)
    // We need smtp_enabled = true to reach the send attempt
    await request(app)
      .put('/api/v1/settings/smtp')
      .set('Cookie', adminCookie)
      .send({ smtp_host: '', smtp_port: 587, smtp_user: '', smtp_enabled: true });

    const res = await request(app)
      .post('/api/v1/settings/smtp/test')
      .set('Cookie', adminCookie)
      .send({ to: 'test@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });
});
