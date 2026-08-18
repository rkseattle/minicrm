/**
 * Rate limiter tests.
 *
 * Verifies that the login, forgot-password, and reset-password rate limiters
 * fire at their configured thresholds. Normally the limiters are bypassed via
 * isE2E in test mode; TEST_RATE_LIMIT=true overrides that bypass so these
 * tests can exercise the actual limiter logic.
 *
 * The E2E bypass is unaffected — existing E2E tests continue to skip limiters.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';

// Enable the rate limiters for this test file — normally bypassed in test mode.
// Must be set before any requests are made (shouldSkip() reads it at call time).
beforeAll(() => {
  process.env.TEST_RATE_LIMIT = 'true';
});

afterAll(() => {
  delete process.env.TEST_RATE_LIMIT;
});

// ── Login rate limiter (max: 10) ─────────────────────────────────────────────

describe('login rate limiter', () => {
  it('allows exactly 10 login attempts then blocks the 11th with 429', async () => {
    // Send 10 failed login attempts — all should return 401 (wrong credentials),
    // not 429 (the limiter has not fired yet).
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '10.0.0.1')
        .send({ email: 'ratelimit-test@example.com', password: 'WrongPass1' });

      expect(res.status).toBe(401);
    }

    // 11th attempt must be blocked by the rate limiter
    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ email: 'ratelimit-test@example.com', password: 'WrongPass1' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.body.error.message).toBe('Too many login attempts, please try again later.');
  });

  it('includes standard rate limit headers on the 429 response', async () => {
    // Use a different IP so this test is independent of the one above.
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '10.0.0.2')
        .send({ email: 'ratelimit-test@example.com', password: 'WrongPass1' });
    }

    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ email: 'ratelimit-test@example.com', password: 'WrongPass1' });

    expect(blocked.status).toBe(429);
    expect(blocked.headers['ratelimit-limit']).toBeDefined();
    expect(blocked.headers['ratelimit-remaining']).toBeDefined();
    expect(blocked.headers['ratelimit-reset']).toBeDefined();
  });
});

// ── Forgot-password rate limiter (max: 5) ────────────────────────────────────

describe('forgot-password rate limiter', () => {
  it('allows exactly 5 requests then blocks the 6th with 429', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .set('X-Forwarded-For', '10.0.1.1')
        .send({ email: 'nobody@example.com' });

      // Always 200 — even for unknown email (user enumeration prevention)
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('X-Forwarded-For', '10.0.1.1')
      .send({ email: 'nobody@example.com' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('includes standard rate limit headers on the 429 response', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/v1/auth/forgot-password')
        .set('X-Forwarded-For', '10.0.1.2')
        .send({ email: 'nobody@example.com' });
    }

    const blocked = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('X-Forwarded-For', '10.0.1.2')
      .send({ email: 'nobody@example.com' });

    expect(blocked.status).toBe(429);
    expect(blocked.headers['ratelimit-limit']).toBeDefined();
    expect(blocked.headers['ratelimit-remaining']).toBeDefined();
    expect(blocked.headers['ratelimit-reset']).toBeDefined();
  });
});

// ── Reset-password rate limiter (max: 10) ────────────────────────────────────

describe('reset-password rate limiter', () => {
  it('allows exactly 10 requests then blocks the 11th with 429', async () => {
    // Send 10 reset attempts with an invalid token — all should return 400
    // (invalid token), not 429.
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .set('X-Forwarded-For', '10.0.2.1')
        .send({ token: 'invalid-token', password: 'NewPass1!' });

      expect(res.status).not.toBe(429);
    }

    const blocked = await request(app)
      .post('/api/v1/auth/reset-password')
      .set('X-Forwarded-For', '10.0.2.1')
      .send({ token: 'invalid-token', password: 'NewPass1!' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('includes standard rate limit headers on the 429 response', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/api/v1/auth/reset-password')
        .set('X-Forwarded-For', '10.0.2.2')
        .send({ token: 'invalid-token', password: 'NewPass1!' });
    }

    const blocked = await request(app)
      .post('/api/v1/auth/reset-password')
      .set('X-Forwarded-For', '10.0.2.2')
      .send({ token: 'invalid-token', password: 'NewPass1!' });

    expect(blocked.status).toBe(429);
    expect(blocked.headers['ratelimit-limit']).toBeDefined();
    expect(blocked.headers['ratelimit-remaining']).toBeDefined();
    expect(blocked.headers['ratelimit-reset']).toBeDefined();
  });
});
