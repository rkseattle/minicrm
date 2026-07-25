/**
 * Regression test for MINCRM-663: with COVERAGE_INSTRUMENTATION and
 * COVERAGE_SESSION_MANAGEMENT unset (the production default — an admin with
 * full CRM access and no special env/build context), every path under
 * /api/v1/admin/coverage/* (control API) and
 * /api/v1/admin/coverage/sessions/* (session management API) must 404, not
 * 403 — there is nothing registered on those routers to discover at all,
 * not merely a gate that reports "off" (see routes/coverage.ts and
 * routes/coverageSessions.ts's own docblocks for the full rationale).
 *
 * COVERAGE_INSTRUMENTATION/COVERAGE_SESSION_MANAGEMENT are read at MODULE
 * LOAD time (a top-level `if` in each route file, not a per-request
 * middleware check), so the rest of this suite's .env.test setting both to
 * 'true' would make app.ts's already-cached module graph register the
 * routes regardless of what this file does — vi.resetModules() +
 * process.env deletion + a dynamic re-import of app.js, BEFORE any other
 * test file's import of app.ts has happened to run in this same worker
 * process, is required to actually exercise the unset-env-var boot path.
 * Same precedent as aiSessionService.test.ts's own E2E-stub module
 * re-import.
 */

import request from 'supertest';
import type { Application } from 'express';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'coverage-route-gating';

let adminCookie: string;
let appWithGatingDisabled: Application;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Coverage Route Gating Admin',
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

  const previousInstrumentation = process.env.COVERAGE_INSTRUMENTATION;
  const previousSessionManagement = process.env.COVERAGE_SESSION_MANAGEMENT;
  delete process.env.COVERAGE_INSTRUMENTATION;
  delete process.env.COVERAGE_SESSION_MANAGEMENT;

  vi.resetModules();
  const freshAppModule = await import('../app.js');
  appWithGatingDisabled = freshAppModule.default;

  // Restore immediately so every OTHER test file in this worker (which
  // expects the routes to exist, per .env.test) is unaffected — only this
  // file's own already-captured appWithGatingDisabled reference keeps its
  // env-unset module snapshot.
  if (previousInstrumentation !== undefined) {
    process.env.COVERAGE_INSTRUMENTATION = previousInstrumentation;
  }
  if (previousSessionManagement !== undefined) {
    process.env.COVERAGE_SESSION_MANAGEMENT = previousSessionManagement;
  }
  vi.resetModules();
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('coverage control API — routes absent when COVERAGE_INSTRUMENTATION is unset', () => {
  it('returns 404, not 403, on POST /reset for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .post('/api/v1/admin/coverage/reset')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(404);
  });

  it('returns 404, not 403, on POST /snapshot for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .post('/api/v1/admin/coverage/snapshot')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(404);
  });

  it('returns 404, not 403, on POST /dump for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .post('/api/v1/admin/coverage/dump')
      .set('Cookie', adminCookie)
      .send({ label: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 404, not 403, on GET /dumps/:dumpId for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .get('/api/v1/admin/coverage/dumps/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});

describe('coverage session management API — routes absent when COVERAGE_SESSION_MANAGEMENT is unset', () => {
  it('returns 404, not 403, on POST /sessions for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send({ label: 'x', source: 'manual', buildSha: 'sha', environment: 'test' });
    expect(res.status).toBe(404);
  });

  it('returns 404, not 403, on GET /sessions for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .get('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});
