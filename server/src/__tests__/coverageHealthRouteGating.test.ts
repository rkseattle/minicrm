/**
 * Regression test for MINCRM-637: GET /api/v1/admin/coverage/health must
 * stay reachable (subject only to auth/coverageAccessGate) even when
 * COVERAGE_INSTRUMENTATION is unset — unlike coverage.ts's OTHER routes
 * (reset/snapshot/dump/dumps/:dumpId), which live inside
 * registerCoverageControlRoutes() and therefore 404 whenever that env var
 * is unset (see coverageRouteGating.test.ts). The health route is
 * registered at module scope, outside that function, specifically so an
 * operator can check coverage-subsystem health in the default deployment
 * where the mapping/reporting/pipeline routers are the ones actually live.
 *
 * Same vi.resetModules() + dynamic re-import discipline as
 * coverageRouteGating.test.ts, for the same reason: COVERAGE_INSTRUMENTATION
 * is read at MODULE LOAD time, and .env.test sets it to 'true' for the rest
 * of this worker's test files.
 */

import request from 'supertest';
import type { Application } from 'express';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'coverage-health-route-gating';

let adminCookie: string;
let repCookie: string;
let appWithInstrumentationDisabled: Application;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Coverage Health Route Gating Admin',
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
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Coverage Health Route Gating Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const previousInstrumentation = process.env.COVERAGE_INSTRUMENTATION;
  delete process.env.COVERAGE_INSTRUMENTATION;

  vi.resetModules();
  const freshAppModule = await import('../app.js');
  appWithInstrumentationDisabled = freshAppModule.default;

  // Restore immediately so every OTHER test file in this worker (which
  // expects COVERAGE_INSTRUMENTATION=true per .env.test) is unaffected —
  // only this file's own already-captured appWithInstrumentationDisabled
  // reference keeps its env-unset module snapshot.
  if (previousInstrumentation !== undefined) {
    process.env.COVERAGE_INSTRUMENTATION = previousInstrumentation;
  }
  vi.resetModules();
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('GET /api/v1/admin/coverage/health — reachable when COVERAGE_INSTRUMENTATION is unset', () => {
  it("returns 200 or 503 (never 404) for an authenticated admin, unlike this router's other routes", async () => {
    const res = await request(appWithInstrumentationDisabled)
      .get('/api/v1/admin/coverage/health')
      .set('Cookie', adminCookie);
    expect(res.status).not.toBe(404);
    expect([200, 503]).toContain(res.status);
  });

  it('still returns 401 when unauthenticated', async () => {
    const res = await request(appWithInstrumentationDisabled).get('/api/v1/admin/coverage/health');
    expect(res.status).toBe(401);
  });

  it('still returns 403 for a non-admin, non-coverage:admin rep', async () => {
    const res = await request(appWithInstrumentationDisabled)
      .get('/api/v1/admin/coverage/health')
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('contrasts with a control-API route on the same router, which DOES 404 when COVERAGE_INSTRUMENTATION is unset', async () => {
    const res = await request(appWithInstrumentationDisabled)
      .post('/api/v1/admin/coverage/reset')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(404);
  });
});
