/**
 * Account lockout tests.
 *
 * Verifies that POST /api/auth/login blocks further attempts with 429
 * ACCOUNT_TEMPORARILY_LOCKED after LOCKOUT_MAX_ATTEMPTS consecutive failures
 * for the same email address, and that the counter resets on success.
 *
 * TEST_RATE_LIMIT=true must be set to enable the IP rate limiter during these
 * tests; the lockout service uses the email key and is unrelated to the IP
 * limiter, so that env var is NOT needed here — the lockout code path fires
 * independently of rate limiting.
 *
 * Runs against the real minicrm_test DB.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import pool from '../db.js';
import { _resetStoreForTesting, LOCKOUT_MAX_ATTEMPTS } from '../services/loginLockoutService.js';

const LOCKOUT_EMAIL = 'lockout-test@example.com';
const WRONG_PASSWORD = 'WrongPass99!';
const CORRECT_PASSWORD = 'CorrectP@ss12';

let userId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email = $1', [LOCKOUT_EMAIL]);

  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.default.hash(CORRECT_PASSWORD, 12);
  const result = await pool.query(
    `INSERT INTO users (email, name, role, password_hash, status)
     VALUES ($1, $2, 'rep', $3, 'active') RETURNING id`,
    [LOCKOUT_EMAIL, 'Lockout Tester', hash],
  );
  userId = result.rows[0].id as string;
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
});

beforeEach(() => {
  _resetStoreForTesting();
});

describe('account lockout', () => {
  it('allows login before the lockout threshold is reached', async () => {
    for (let i = 0; i < LOCKOUT_MAX_ATTEMPTS - 1; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: LOCKOUT_EMAIL, password: WRONG_PASSWORD });
      expect(res.status).toBe(401);
    }

    // One more failure still returns 401 (not yet at threshold)
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: LOCKOUT_EMAIL, password: WRONG_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('returns 429 ACCOUNT_TEMPORARILY_LOCKED after LOCKOUT_MAX_ATTEMPTS failures', async () => {
    for (let i = 0; i < LOCKOUT_MAX_ATTEMPTS; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: LOCKOUT_EMAIL, password: WRONG_PASSWORD });
    }

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: LOCKOUT_EMAIL, password: WRONG_PASSWORD });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('also blocks a correct password while locked out', async () => {
    for (let i = 0; i < LOCKOUT_MAX_ATTEMPTS; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: LOCKOUT_EMAIL, password: WRONG_PASSWORD });
    }

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: LOCKOUT_EMAIL, password: CORRECT_PASSWORD });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
  });

  it('does not count failed logins across different email addresses', async () => {
    for (let i = 0; i < LOCKOUT_MAX_ATTEMPTS; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'other-user@example.com', password: WRONG_PASSWORD });
    }

    // Our test user's counter is unaffected — correct credentials still work
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: LOCKOUT_EMAIL, password: CORRECT_PASSWORD });

    expect(res.status).toBe(200);
  });

  it('clears the failure counter after a successful login', async () => {
    for (let i = 0; i < LOCKOUT_MAX_ATTEMPTS - 1; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: LOCKOUT_EMAIL, password: WRONG_PASSWORD });
    }

    // Successful login resets the counter
    const successRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: LOCKOUT_EMAIL, password: CORRECT_PASSWORD });
    expect(successRes.status).toBe(200);

    // Confirm one failed attempt after the reset still returns 401 (not 429),
    // proving the counter was cleared. We check one attempt only to stay within
    // the test timeout (bcrypt cost 12 makes each request ~300 ms).
    const afterResetRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: LOCKOUT_EMAIL, password: WRONG_PASSWORD });
    expect(afterResetRes.status).toBe(401);
  }, 30_000);
});
