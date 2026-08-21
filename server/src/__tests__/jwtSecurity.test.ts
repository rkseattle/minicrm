/**
 * JWT security tests.
 *
 * Verifies that the auth middleware correctly rejects:
 *   1. Tokens signed with a wrong secret (forged tokens)
 *   2. Tokens with a tampered payload (role escalation without re-signing)
 *   3. Expired tokens
 *   4. Malformed cookie values (not valid JWT structure)
 *   5. Requests with no cookie at all
 *
 * These tests make the JWT signature contract an explicitly verified guarantee —
 * any future change to auth middleware (library swap, algorithm change, bypass)
 * would immediately fail these tests.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';

const BASE_USER = {
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let repUserId: string;
let repUserEmail: string;
let repUserName: string;

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'jwt-sec-%'");

  const repUser = await createUser({
    ...BASE_USER,
    email: 'jwt-sec-rep@example.com',
    name: 'JWT Security Rep',
    role: 'rep',
  });
  repUserId = repUser.id;
  repUserEmail = repUser.email;
  repUserName = repUser.name;
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'jwt-sec-%'");
});

// ── Test 1: Forged JWT (wrong secret) ────────────────────────────────────────

describe('forged JWT (wrong secret)', () => {
  it('returns 401 when the token is signed with a different secret', async () => {
    const forgedToken = jwt.sign(
      { id: repUserId, email: repUserEmail, name: repUserName, role: 'rep' },
      'wrong-secret',
      { expiresIn: '1h' },
    );
    const forgedCookie = `${AUTH_COOKIE_NAME}=${forgedToken}`;

    const res = await request(app).get('/api/v1/auth/me').set('Cookie', forgedCookie);

    expect(res.status).toBe(401);
  });
});

// ── Test 2: Tampered payload (role escalation) ───────────────────────────────

describe('tampered payload (role escalation)', () => {
  it('returns 401 when the payload role is mutated from rep to admin without re-signing', async () => {
    // Create a valid rep token
    const validToken = jwt.sign(
      { id: repUserId, email: repUserEmail, name: repUserName, role: 'rep' },
      process.env.JWT_SECRET ?? '',
      { expiresIn: '1h' },
    );

    // Split into header.payload.signature
    const [header, payload, signature] = validToken.split('.');

    // Decode payload, escalate role, re-encode
    const payloadJson = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    payloadJson.role = 'admin';
    const tamperedPayload = Buffer.from(JSON.stringify(payloadJson)).toString('base64url');

    // Reconstruct with the original signature — signature no longer matches the new payload
    const tamperedToken = `${header}.${tamperedPayload}.${signature}`;
    const tamperedCookie = `${AUTH_COOKIE_NAME}=${tamperedToken}`;

    // GET /api/v1/users is admin-only; must return 401 (signature mismatch), not 200 or 403
    const res = await request(app).get('/api/v1/users').set('Cookie', tamperedCookie);

    expect(res.status).toBe(401);
  });
});

// ── Test 3: Expired JWT ──────────────────────────────────────────────────────

describe('expired JWT', () => {
  it('returns 401 when the token has a past expiry', async () => {
    const expiredToken = jwt.sign(
      { id: repUserId, email: repUserEmail, name: repUserName, role: 'rep' },
      process.env.JWT_SECRET ?? '',
      { expiresIn: '-1s' }, // expired one second ago
    );
    const expiredCookie = `${AUTH_COOKIE_NAME}=${expiredToken}`;

    const res = await request(app).get('/api/v1/auth/me').set('Cookie', expiredCookie);

    expect(res.status).toBe(401);
  });
});

// ── Test 4: Malformed token ──────────────────────────────────────────────────

describe('malformed cookie values', () => {
  const malformedValues = [
    'not-a-jwt-at-all',
    'only.two-segments',
    Buffer.from('random base64 noise!').toString('base64'),
    'eyJhbGciOiJIUzI1NiJ9', // only header segment, no dots
  ];

  it.each(malformedValues)(
    'returns 401 (not 500) for malformed cookie value: "%s"',
    async (value) => {
      const malformedCookie = `${AUTH_COOKIE_NAME}=${value}`;

      const res = await request(app).get('/api/v1/auth/me').set('Cookie', malformedCookie);

      expect(res.status).toBe(401);
      // Must not throw an unhandled exception (which would produce 500)
      expect(res.status).not.toBe(500);
    },
  );
});

// ── Test 5: No cookie at all ─────────────────────────────────────────────────

describe('no cookie', () => {
  it('returns 401 on an authenticated endpoint when no cookie is sent', async () => {
    const res = await request(app).get('/api/v1/contacts');

    expect(res.status).toBe(401);
  });
});
