/**
 * Tests that production safeguards fail closed on an unrecognized NODE_ENV.
 *
 * app.ts's gates run at module evaluation, so each case re-imports the module
 * with the environment already set. swagger.test.ts covers setupSwagger itself
 * by calling it directly; what is untested there is the gate deciding whether
 * to call it at all, which is the half a deployment gets wrong.
 */

import 'dotenv/config';
import { vi, describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { makeAuthCookie } from './testUtils.js';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const FILE_PREFIX = 'app-env-gating';

// Two SCIM routers mount `authenticate` at the bare /api/v1 prefix, so an
// unauthenticated request to any unmatched path there is challenged with 401
// before reaching the 404 handler. Authenticating is what makes 404 (route not
// registered) distinguishable from 401 (registered, or merely unreachable).
let adminCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Env Gating Admin',
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
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.end();
});

/**
 * Pools created by re-importing app.ts, which pulls in a fresh db.ts each time.
 *
 * Each holds up to DB_POOL_MAX connections and nothing else closes them, so
 * leaving them open exhausts the test database's connection budget for suites
 * running alongside this one.
 */
const loadedPools: Array<{ end: () => Promise<void> }> = [];

/** Loads a fresh app.ts with NODE_ENV set to `value` (or unset when undefined). */
async function loadAppWithNodeEnv(value: string | undefined): Promise<Express> {
  vi.resetModules();
  if (value === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = value;
  }
  const module = (await import('../app.js')) as { default: Express };
  const dbModule = (await import('../db.js')) as { default: { end: () => Promise<void> } };
  loadedPools.push(dbModule.default);
  return module.default;
}

afterEach(async () => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  await Promise.all(loadedPools.splice(0).map((loaded) => loaded.end().catch(() => undefined)));
  vi.resetModules();
});

const UNRECOGNIZED_ENVS: ReadonlyArray<[string, string | undefined]> = [
  ['unset', undefined],
  ['misspelled', 'producton'],
  ['differently cased', 'Production'],
  ['unrecognized', 'qa-box'],
];

describe.each(UNRECOGNIZED_ENVS)('NODE_ENV %s', (_label, value) => {
  it('does not serve the API docs', async () => {
    const app = await loadAppWithNodeEnv(value);

    const res = await request(app).get('/api-docs/');

    expect(res.status).toBe(404);
  });

  it('does not mount the plaintext reset-token endpoint', async () => {
    const app = await loadAppWithNodeEnv(value);

    const res = await request(app)
      .post('/api/v1/auth/dev/reset-token')
      .set('Cookie', adminCookie)
      .send({ email: 'admin@example.com' });

    // Unauthenticated and returns a usable reset token for any active account:
    // the most dangerous of the gated endpoints.
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('token');
  });

  it('does not mount the live TOTP-code endpoint', async () => {
    const app = await loadAppWithNodeEnv(value);

    const res = await request(app).get('/api/v1/auth/mfa/dev/totp-code').set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('code');
  });

  it('does not mount the unauthenticated test-only endpoint', async () => {
    const app = await loadAppWithNodeEnv(value);

    const res = await request(app)
      .post('/api/v1/test/advance-sequences')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body).not.toEqual({ ok: true });
  });
});

describe('NODE_ENV staging', () => {
  it('serves the API docs', async () => {
    const app = await loadAppWithNodeEnv('staging');

    const res = await request(app).get('/api-docs/');

    expect(res.status).not.toBe(404);
  });

  it('does not mount the endpoints that hand out credentials', async () => {
    const app = await loadAppWithNodeEnv('staging');

    // Staging carries real traffic. Serving the docs there is fine; minting a
    // password-reset token or a live TOTP code for any account is not.
    const resetToken = await request(app)
      .post('/api/v1/auth/dev/reset-token')
      .set('Cookie', adminCookie)
      .send({ email: `${FILE_PREFIX}-admin@example.com` });
    expect(resetToken.status).toBe(404);

    const totp = await request(app)
      .get('/api/v1/auth/mfa/dev/totp-code')
      .set('Cookie', adminCookie);
    expect(totp.status).toBe(404);
  });
});

describe('NODE_ENV development', () => {
  it('serves the API docs', async () => {
    const app = await loadAppWithNodeEnv('development');

    const res = await request(app).get('/api-docs/');

    // The docs UI redirects or renders; either way it is not a 404.
    expect(res.status).not.toBe(404);
  });

  it('mounts the gated endpoints', async () => {
    const app = await loadAppWithNodeEnv('development');

    // Not 404: proves the 404s above are the gate closing, not the paths being
    // unreachable for some unrelated reason.
    const resetToken = await request(app)
      .post('/api/v1/auth/dev/reset-token')
      .set('Cookie', adminCookie)
      .send({ email: `${FILE_PREFIX}-admin@example.com` });
    expect(resetToken.status).not.toBe(404);

    const totp = await request(app)
      .get('/api/v1/auth/mfa/dev/totp-code')
      .set('Cookie', adminCookie);
    expect(totp.status).not.toBe(404);
  });
});
