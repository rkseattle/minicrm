/**
 * Unit tests for csvUtils, userUtils, and reset-onboarding HTTP endpoint. (MINCRM-295, MINCRM-410)
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { serializeToCsv, csvFilename } from '../utils/csvUtils.js';
import { sanitizeUser } from '../utils/userUtils.js';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

// ── serializeToCsv ────────────────────────────────────────────────────────────

describe('serializeToCsv', () => {
  it('produces a BOM-prefixed CSV with header and data rows', () => {
    const csv = serializeToCsv(['name', 'email'], [{ name: 'Alice', email: 'alice@example.com' }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('name,email');
    expect(csv).toContain('Alice,alice@example.com');
  });

  it('wraps fields containing commas in double-quotes', () => {
    const csv = serializeToCsv(['val'], [{ val: 'a,b' }]);
    expect(csv).toContain('"a,b"');
  });

  it('escapes embedded double-quotes by doubling them', () => {
    const csv = serializeToCsv(['val'], [{ val: 'say "hello"' }]);
    expect(csv).toContain('"say ""hello"""');
  });

  it('wraps fields containing newlines in double-quotes', () => {
    const csv = serializeToCsv(['val'], [{ val: 'line1\nline2' }]);
    expect(csv).toContain('"line1\nline2"');
  });

  it('prefixes formula-trigger characters with a single quote', () => {
    for (const char of ['=', '+', '-', '@']) {
      const csv = serializeToCsv(['val'], [{ val: `${char}CMD` }]);
      expect(csv).toContain(`'${char}CMD`);
    }
  });

  it('renders null and undefined as empty strings', () => {
    const csv = serializeToCsv(['a', 'b'], [{ a: null, b: undefined }]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toBe(',');
  });

  it('formats Date values as ISO-like UTC strings', () => {
    const csv = serializeToCsv(['d'], [{ d: new Date('2025-06-01T12:00:00.000Z') }]);
    expect(csv).toContain('2025-06-01 12:00:00 UTC');
  });

  it('handles numeric values without quoting', () => {
    const csv = serializeToCsv(['n'], [{ n: 42 }]);
    expect(csv).toContain('42');
  });

  it('produces only a header row when rows array is empty', () => {
    const csv = serializeToCsv(['name', 'email'], []);
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('name,email');
  });

  it('uses CRLF line endings between rows', () => {
    const csv = serializeToCsv(['x'], [{ x: '1' }, { x: '2' }]);
    expect(csv).toContain('\r\n');
  });
});

// ── csvFilename ───────────────────────────────────────────────────────────────

describe('csvFilename', () => {
  it('returns a filename in the pattern minicrm-<entity>-YYYY-MM-DD.csv', () => {
    const name = csvFilename('contacts');
    expect(name).toMatch(/^minicrm-contacts-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('includes todays date', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(csvFilename('deals')).toContain(today);
  });
});

// ── POST /api/v1/users/:id/reset-onboarding (MINCRM-410) ─────────────────────

describe('POST /api/v1/users/:id/reset-onboarding', () => {
  const ADMIN_EMAIL = 'utils-test-admin@example.com';
  const REP_EMAIL = 'utils-test-rep@example.com';

  let adminCookie: string;
  let repCookie: string;
  let repUserId: string;

  beforeAll(async () => {
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);

    const admin = await createUser({
      email: ADMIN_EMAIL,
      name: 'Utils Admin',
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
      name: 'Utils Rep',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    repUserId = rep.id;
    repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ADMIN_EMAIL, REP_EMAIL]]);
  });

  it('returns 200 with { success: true } when admin resets another user', async () => {
    const res = await request(app)
      .post(`/api/v1/users/${repUserId}/reset-onboarding`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when target user does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/users/00000000-0000-0000-0000-999999999999/reset-onboarding')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns 403 for a rep (route is under admin-only middleware)', async () => {
    const res = await request(app)
      .post(`/api/v1/users/${repUserId}/reset-onboarding`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });

  it('returns 403 when admin tries to reset their own onboarding', async () => {
    // Retrieve the admin's own ID from the DB so we can pass it as the target.
    const adminRow = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      ADMIN_EMAIL,
    ]);
    const adminId = adminRow.rows[0].id;

    const res = await request(app)
      .post(`/api/v1/users/${adminId}/reset-onboarding`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post(`/api/v1/users/${repUserId}/reset-onboarding`);

    expect(res.status).toBe(401);
  });
});

// ── sanitizeUser ──────────────────────────────────────────────────────────────

describe('sanitizeUser', () => {
  it('strips password_hash from the returned object', () => {
    const row = {
      id: '1',
      email: 'a@b.com',
      name: 'A',
      role: 'rep' as const,
      status: 'active' as const,
      password_hash: 'secret',
      must_change_password: false,
      preferred_language: 'en' as const,
      notify_overdue_tasks: true,
      notify_assignments: true,
      notify_deal_stage_changes: true,
      password_reset_token_hash: null,
      password_reset_expires_at: null,
      password_changed_at: null,
      // MFA fields (MINCRM-392)
      mfa_enabled: false,
      mfa_secret: null,
      mfa_pending_secret: null,
      mfa_recovery_codes: [],
      created_at: new Date(),
      updated_at: new Date(),
    };
    const safe = sanitizeUser(row);
    expect(safe).not.toHaveProperty('password_hash');
    expect(safe).not.toHaveProperty('mfa_secret');
    expect(safe).not.toHaveProperty('mfa_pending_secret');
    expect(safe).not.toHaveProperty('mfa_recovery_codes');
    expect(safe.email).toBe('a@b.com');
  });
});
