/**
 * API-layer password complexity tests (MINCRM-246).
 *
 * Verifies that the server independently enforces password complexity rules on
 * all four password-accepting endpoints. A user bypassing the React form and
 * calling the API directly with a weak password must still get a 400.
 *
 * Endpoints tested:
 *   - POST /api/users/set-password     (invite activation — unauthenticated)
 *   - POST /api/auth/change-password   (authenticated user changes own password)
 *   - POST /api/auth/reset-password    (password reset via token — unauthenticated)
 *   - POST /api/users/:id/admin-set-password  (admin only)
 *
 * PASSWORD_MIN_LENGTH is 12 (from shared/schemas/userSchema.ts — raised by MINCRM-391).
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';
import { PASSWORD_MIN_LENGTH } from '@minicrm/shared/schemas/userSchema.js';

const BASE_USER = {
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** A password that satisfies all complexity requirements (MINCRM-391: 12+ chars, letter, digit, special) */
const VALID_PASSWORD = 'ValidPass1!@#';

/** Passwords that must be rejected by the server */
const WEAK_PASSWORDS = [
  { label: 'too short', value: 'Ab1!' },
  { label: 'letters only', value: 'abcdefghijkl' },
  { label: 'numbers only', value: '123456789012' },
  { label: 'no special character', value: 'ValidPass1234' },
  { label: 'empty string', value: '' },
];

let adminCookie: string;
let repUserId: string;
let repUserEmail: string;
let repUserName: string;
let repCookie: string;
let targetUserId: string;

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'pwdcx-%'");

  // Admin user for admin-set-password and invite endpoints
  const admin = await createUser({
    ...BASE_USER,
    email: 'pwdcx-admin@example.com',
    name: 'PwdCx Admin',
    role: 'admin',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  // Rep user for change-password tests; password_hash must be a real bcrypt hash
  // to get past the credential check (the complexity check fires before it, but
  // the happy-path test needs a real hash so the correct password actually passes).
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.default.hash('CurrentPass1', 12);
  const rep = await pool.query(
    `INSERT INTO users (email, name, role, password_hash, status)
     VALUES ($1, $2, 'rep', $3, 'active') RETURNING *`,
    ['pwdcx-rep@example.com', 'PwdCx Rep', hash],
  );
  repUserId = rep.rows[0].id as string;
  repUserEmail = rep.rows[0].email as string;
  repUserName = rep.rows[0].name as string;
  repCookie = makeAuthCookie({
    id: repUserId,
    email: repUserEmail,
    name: repUserName,
    role: 'rep',
  });

  // A target user for admin-set-password tests (can be any active/invited user)
  const target = await createUser({
    ...BASE_USER,
    email: 'pwdcx-target@example.com',
    name: 'PwdCx Target',
    role: 'rep',
  });
  targetUserId = target.id;

  // Invite a user to warm up the invite flow; fresh tokens are fetched per-test
  await request(app)
    .post('/api/v1/users/invite')
    .set('Cookie', adminCookie)
    .send({ email: 'pwdcx-invited@example.com', name: 'PwdCx Invited', role: 'rep' });
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'pwdcx-%'");
});

// ── Helper to get a fresh invite token ───────────────────────────────────────

async function getFreshInviteToken(): Promise<string> {
  // Re-invite a fresh user each time so the token is valid and unused.
  // We delete and recreate the invited user for each set-password scenario.
  await pool.query("DELETE FROM users WHERE email = 'pwdcx-invited-fresh@example.com'");
  const inviteRes = await request(app)
    .post('/api/v1/users/invite')
    .set('Cookie', adminCookie)
    .send({ email: 'pwdcx-invited-fresh@example.com', name: 'PwdCx Fresh Invite', role: 'rep' });
  return (inviteRes.body as { inviteToken?: string }).inviteToken ?? '';
}

// ── Helper to get a fresh reset token ────────────────────────────────────────

async function getFreshResetToken(): Promise<string> {
  const tokenRes = await request(app)
    .post('/api/v1/auth/dev/reset-token')
    .send({ email: 'pwdcx-rep@example.com' });
  return (tokenRes.body as { token?: string }).token ?? '';
}

// ── POST /api/users/set-password ─────────────────────────────────────────────

describe('MINCRM-246 — POST /api/users/set-password password complexity', () => {
  it.each(WEAK_PASSWORDS)('returns 400 for $label password', async ({ value }) => {
    const token = await getFreshInviteToken();
    const res = await request(app)
      .post('/api/v1/users/set-password')
      .send({ token, password: value });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid password and activates the account', async () => {
    const token = await getFreshInviteToken();
    const res = await request(app)
      .post('/api/v1/users/set-password')
      .send({ token, password: VALID_PASSWORD });

    expect(res.status).toBe(200);
  });
});

// ── POST /api/auth/change-password ───────────────────────────────────────────

describe('MINCRM-246 — POST /api/auth/change-password password complexity', () => {
  it.each(WEAK_PASSWORDS)('returns 400 for $label password', async ({ value }) => {
    // The complexity check fires before the credential check — any currentPassword
    // value is fine here; the response will be 400 before bcrypt is reached.
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Cookie', repCookie)
      .send({ currentPassword: 'anything', newPassword: value });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid password when the current password is also correct', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Cookie', repCookie)
      .send({ currentPassword: 'CurrentPass1', newPassword: VALID_PASSWORD });

    expect(res.status).toBe(200);
  });
});

// ── POST /api/auth/reset-password ────────────────────────────────────────────

describe('MINCRM-246 — POST /api/auth/reset-password password complexity', () => {
  it.each(WEAK_PASSWORDS)('returns 400 for $label password', async ({ value }) => {
    // Zod validates the password field before the token is verified, so any
    // token value triggers a 400 on a weak password.
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'any-token', password: value });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid password with a real reset token', async () => {
    // Re-seed the rep's hash so a fresh reset token is valid
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash('CurrentPass1', 12);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, repUserId]);

    const token = await getFreshResetToken();
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: VALID_PASSWORD });

    expect(res.status).toBe(200);
  });
});

// ── POST /api/users/:id/admin-set-password ────────────────────────────────────

describe('MINCRM-246 — POST /api/users/:id/admin-set-password password complexity', () => {
  it.each(WEAK_PASSWORDS)('returns 400 for $label password', async ({ value }) => {
    const res = await request(app)
      .post(`/api/v1/users/${targetUserId}/admin-set-password`)
      .set('Cookie', adminCookie)
      .send({ password: value });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid password', async () => {
    const res = await request(app)
      .post(`/api/v1/users/${targetUserId}/admin-set-password`)
      .set('Cookie', adminCookie)
      .send({ password: VALID_PASSWORD });

    expect(res.status).toBe(200);
  });
});

// Sanity check: documents that the constant matches the updated NIST 800-63B requirement (MINCRM-391)
test(`PASSWORD_MIN_LENGTH is ${PASSWORD_MIN_LENGTH} (sanity check for test assumptions)`, () => {
  expect(PASSWORD_MIN_LENGTH).toBe(12);
});
