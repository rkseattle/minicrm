/**
 * The admin endpoints for email sync's org settings: the excluded-domain list and the
 * backfill window. Serial, since both are global rows other suites read.
 */

import 'dotenv/config';
import request from 'supertest';

import app from '../app.js';
import pool from '../db.js';
import { EMAIL_SYNC_BACKFILL_DAYS_DEFAULT } from '@minicrm/shared/schemas/settingsSchema.js';
import { createUser } from '../services/userService.js';
import { clearAuditLogFor, makeAuthCookie, purgeFixtureUsers } from './testUtils.js';

const FILE_PREFIX = 'emailsyncsettings';

let adminId: string;
let adminCookie: string;
let repCookie: string;

async function person(suffix: string, role: 'admin' | 'rep') {
  const user = await createUser({
    email: `${FILE_PREFIX}-${suffix}@example.com`,
    name: `Sync Settings ${suffix}`,
    role,
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  return {
    id: user.id,
    cookie: makeAuthCookie({ id: user.id, email: user.email, name: user.name, role: user.role }),
  };
}

async function restoreDefaults(): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('email_sync_excluded_domains', '[]', now()),
            ('email_sync_backfill_days', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [String(EMAIL_SYNC_BACKFILL_DAYS_DEFAULT)],
  );
}

async function settingsAudits(): Promise<{ field_name: string; new_value: string }[]> {
  const rows = await pool.query<{ field_name: string; new_value: string }>(
    `SELECT field_name, new_value FROM audit_log
      WHERE record_type = 'system_settings' AND changed_by_id = $1 ORDER BY created_at`,
    [adminId],
  );
  return rows.rows;
}

beforeAll(async () => {
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
  const admin = await person('admin', 'admin');
  adminId = admin.id;
  adminCookie = admin.cookie;
  repCookie = (await person('rep', 'rep')).cookie;
});

beforeEach(async () => {
  await restoreDefaults();
  await clearAuditLogFor(adminId);
});

afterAll(async () => {
  await restoreDefaults();
  await clearAuditLogFor(adminId);
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
  await pool.end();
});

describe('/api/v1/settings/email-sync-excluded-domains', () => {
  it('lets an admin replace the list, normalized, and audits the change', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/email-sync-excluded-domains')
      .set('Cookie', adminCookie)
      .send({ domains: ['HR.example', 'hr.example', 'family.example'] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ domains: ['hr.example', 'family.example'] });
    const read = await request(app)
      .get('/api/v1/settings/email-sync-excluded-domains')
      .set('Cookie', adminCookie);
    expect(read.body).toEqual({ domains: ['hr.example', 'family.example'] });
    expect(await settingsAudits()).toEqual([
      { field_name: 'Email Sync Excluded Domains', new_value: '["hr.example","family.example"]' },
    ]);
  });

  it('writes no audit entry when the list does not change', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/email-sync-excluded-domains')
      .set('Cookie', adminCookie)
      .send({ domains: [] });

    expect(res.status).toBe(200);
    expect(await settingsAudits()).toEqual([]);
  });

  it('keeps the list from reps, since it may name HR or legal domains', async () => {
    const res = await request(app)
      .get('/api/v1/settings/email-sync-excluded-domains')
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('refuses a rep with 403', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/email-sync-excluded-domains')
      .set('Cookie', repCookie)
      .send({ domains: ['hr.example'] });
    expect(res.status).toBe(403);
  });

  it.each([
    ['an address', { domains: ['someone@hr.example'] }],
    ['a missing list', {}],
  ])('answers 400 to %s', async (_label, body) => {
    const res = await request(app)
      .patch('/api/v1/settings/email-sync-excluded-domains')
      .set('Cookie', adminCookie)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 401 without a session', async () => {
    const res = await request(app).get('/api/v1/settings/email-sync-excluded-domains');
    expect(res.status).toBe(401);
  });
});

describe('/api/v1/settings/email-sync-backfill-days', () => {
  it('lets an admin set the window and audits the change', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/email-sync-backfill-days')
      .set('Cookie', adminCookie)
      .send({ days: 30 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ days: 30 });
    const read = await request(app)
      .get('/api/v1/settings/email-sync-backfill-days')
      .set('Cookie', repCookie);
    expect(read.body).toEqual({ days: 30 });
    expect(await settingsAudits()).toEqual([
      { field_name: 'Email Sync Backfill Window (days)', new_value: '30' },
    ]);
  });

  it('writes no audit entry when the window does not change', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/email-sync-backfill-days')
      .set('Cookie', adminCookie)
      .send({ days: EMAIL_SYNC_BACKFILL_DAYS_DEFAULT });

    expect(res.status).toBe(200);
    expect(await settingsAudits()).toEqual([]);
  });

  it('answers 401 without a session', async () => {
    const res = await request(app).get('/api/v1/settings/email-sync-backfill-days');
    expect(res.status).toBe(401);
  });

  it('refuses a rep with 403', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/email-sync-backfill-days')
      .set('Cookie', repCookie)
      .send({ days: 30 });
    expect(res.status).toBe(403);
  });

  it.each([
    ['zero', { days: 0 }],
    ['above a year', { days: 366 }],
    ['a fraction', { days: 1.5 }],
    ['text', { days: '30' }],
  ])('answers 400 to %s', async (_label, body) => {
    const res = await request(app)
      .patch('/api/v1/settings/email-sync-backfill-days')
      .set('Cookie', adminCookie)
      .send(body);
    expect(res.status).toBe(400);
  });
});
