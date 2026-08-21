/**
 * Integration tests for the password reset flow.
 *
 * Tests cover:
 *   - createPasswordResetToken: generates a token, overwrites an existing one
 *   - findUserByResetToken: finds valid token, rejects expired/missing
 *   - resetPasswordWithToken: happy path, expired token, already-used token
 *   - POST /api/v1/auth/forgot-password: no enumeration (200 for unknown email)
 *   - POST /api/v1/auth/reset-password: success, invalid token, complexity failure
 *   - authenticate middleware: rejects JWT issued before password_changed_at
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import crypto from 'crypto';
import app from '../app.js';
import pool from '../db.js';
import {
  createUser,
  createPasswordResetToken,
  findUserByResetToken,
  resetPasswordWithToken,
} from '../services/userService.js';
import { makeAuthCookie } from './testUtils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_EMAIL_PREFIX = 'reset-test-';

/** Hashes a plaintext token the same way the service does (SHA-256 hex). */
function hashToken(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

/** Creates a minimal active test user for reset tests. */
async function createTestUser(suffix: string) {
  return createUser({
    email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
    name: `Reset Test ${suffix}`,
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await pool.query(`DELETE FROM users WHERE email LIKE '${TEST_EMAIL_PREFIX}%'`);
});

afterAll(async () => {
  await pool.query(`DELETE FROM users WHERE email LIKE '${TEST_EMAIL_PREFIX}%'`);
});

// ---------------------------------------------------------------------------
// createPasswordResetToken
// ---------------------------------------------------------------------------

describe('createPasswordResetToken', () => {
  it('generates a plaintext token and stores its hash in the DB', async () => {
    const user = await createTestUser('token-create');

    const { plaintextToken, expiresAt } = await createPasswordResetToken(user.id);

    expect(plaintextToken).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const row = await pool.query(
      `SELECT password_reset_token_hash, password_reset_expires_at FROM users WHERE id = $1`,
      [user.id],
    );
    expect(row.rows[0].password_reset_token_hash).toBe(hashToken(plaintextToken));
    expect(new Date(row.rows[0].password_reset_expires_at).getTime()).toBeCloseTo(
      expiresAt.getTime(),
      -3,
    );
  });

  it('overwrites an existing unexpired token (invalidates the previous one)', async () => {
    const user = await createTestUser('token-overwrite');

    const { plaintextToken: firstToken } = await createPasswordResetToken(user.id);
    const { plaintextToken: secondToken } = await createPasswordResetToken(user.id);

    // The second token should be stored; first should be gone.
    expect(secondToken).not.toBe(firstToken);

    const row = await pool.query(`SELECT password_reset_token_hash FROM users WHERE id = $1`, [
      user.id,
    ]);
    expect(row.rows[0].password_reset_token_hash).toBe(hashToken(secondToken));
    expect(row.rows[0].password_reset_token_hash).not.toBe(hashToken(firstToken));
  });
});

// ---------------------------------------------------------------------------
// findUserByResetToken
// ---------------------------------------------------------------------------

describe('findUserByResetToken', () => {
  it('returns the user for a valid unexpired token', async () => {
    const user = await createTestUser('find-valid');
    const { plaintextToken } = await createPasswordResetToken(user.id);

    const found = await findUserByResetToken(plaintextToken);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(user.id);
  });

  it('returns null for an unknown token', async () => {
    const found = await findUserByResetToken('0'.repeat(64));
    expect(found).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const user = await createTestUser('find-expired');
    const { plaintextToken } = await createPasswordResetToken(user.id);

    // Manually backdate the expiry.
    await pool.query(
      `UPDATE users SET password_reset_expires_at = now() - interval '1 hour' WHERE id = $1`,
      [user.id],
    );

    const found = await findUserByResetToken(plaintextToken);
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resetPasswordWithToken
// ---------------------------------------------------------------------------

describe('resetPasswordWithToken', () => {
  it('updates the password and clears the token on success', async () => {
    const user = await createTestUser('reset-success');
    const { plaintextToken } = await createPasswordResetToken(user.id);

    const updated = await resetPasswordWithToken(plaintextToken, 'NewP@ssw0rd!');
    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(user.id);

    const row = await pool.query(
      `SELECT password_reset_token_hash, password_reset_expires_at, password_changed_at FROM users WHERE id = $1`,
      [user.id],
    );
    expect(row.rows[0].password_reset_token_hash).toBeNull();
    expect(row.rows[0].password_reset_expires_at).toBeNull();
    expect(row.rows[0].password_changed_at).not.toBeNull();
  });

  it('returns null for an expired token', async () => {
    const user = await createTestUser('reset-expired');
    const { plaintextToken } = await createPasswordResetToken(user.id);

    await pool.query(
      `UPDATE users SET password_reset_expires_at = now() - interval '1 hour' WHERE id = $1`,
      [user.id],
    );

    const updated = await resetPasswordWithToken(plaintextToken, 'NewP@ssw0rd!');
    expect(updated).toBeNull();
  });

  it('returns null when the token has already been used', async () => {
    const user = await createTestUser('reset-used');
    const { plaintextToken } = await createPasswordResetToken(user.id);

    // First use — should succeed.
    const firstAttempt = await resetPasswordWithToken(plaintextToken, 'NewPass1');
    expect(firstAttempt).not.toBeNull();

    // Second use of the same token — must fail (token was cleared).
    const secondAttempt = await resetPasswordWithToken(plaintextToken, 'AnotherPass2');
    expect(secondAttempt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/forgot-password
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/forgot-password', () => {
  it('returns 200 for a known active user email', async () => {
    const user = await createTestUser('forgot-known');

    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it('returns 200 for an unknown email (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'no-such-user-xyz@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it('returns 200 for a known but inactive user (no enumeration)', async () => {
    const user = await createUser({
      email: `${TEST_EMAIL_PREFIX}forgot-inactive@example.com`,
      name: 'Reset Inactive',
      role: 'rep',
      passwordHash: '$2b$12$placeholder_hash',
      status: 'inactive',
    });

    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });

    expect(res.status).toBe(200);
  });

  it('returns 400 for an invalid email address', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/reset-password
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/reset-password', () => {
  it('returns 200 and sets a session cookie on success', async () => {
    const user = await createTestUser('api-reset-success');
    const { plaintextToken } = await createPasswordResetToken(user.id);

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: plaintextToken, password: 'NewP@ssw0rd!' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe(user.id);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith('minicrm_token='))).toBe(true);
  });

  it('returns 400 with RESET_TOKEN_INVALID for an expired token', async () => {
    const user = await createTestUser('api-reset-expired');
    const { plaintextToken } = await createPasswordResetToken(user.id);

    await pool.query(
      `UPDATE users SET password_reset_expires_at = now() - interval '1 hour' WHERE id = $1`,
      [user.id],
    );

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: plaintextToken, password: 'NewP@ssw0rd!' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('returns 400 with RESET_TOKEN_INVALID for an unknown token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: '0'.repeat(64), password: 'NewP@ssw0rd!' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('returns 400 for a password that fails complexity requirements', async () => {
    const user = await createTestUser('api-reset-complexity');
    const { plaintextToken } = await createPasswordResetToken(user.id);

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: plaintextToken, password: 'tooshort' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// authenticate middleware: session invalidation after password reset
// ---------------------------------------------------------------------------

describe('authenticate middleware — session invalidation after password reset', () => {
  it('rejects a JWT issued before password_changed_at with 401', async () => {
    const user = await createTestUser('session-invalidation');

    // Create a cookie with an iat backdated to before the reset.
    const cookie = makeAuthCookie({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    // Simulate a password reset by setting password_changed_at to a future time.
    // A 1-second offset is too tight — under parallel test load the DB clock and the
    // JWT iat can land in the same second. Use 1 hour to guarantee the token predates
    // the "reset" regardless of timing jitter.
    await pool.query(
      `UPDATE users SET password_changed_at = now() + interval '1 hour' WHERE id = $1`,
      [user.id],
    );

    const res = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('allows a JWT issued after password_changed_at', async () => {
    const user = await createTestUser('session-valid-after-reset');

    // Set password_changed_at in the past so our freshly signed token is valid.
    await pool.query(
      `UPDATE users SET password_changed_at = now() - interval '1 hour' WHERE id = $1`,
      [user.id],
    );

    const cookie = makeAuthCookie({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    const res = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
  });
});
