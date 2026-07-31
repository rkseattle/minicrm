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
import { COVERAGE_ROUTE_GATE_ENV_VARS } from '../coverageAgent/coverageBootGate.js';

const FILE_PREFIX = 'coverage-health-route-gating';

let adminCookie: string;
let repCookie: string;
let appWithInstrumentationDisabled: Application;
let gatesAtBootForDisabledApp: Readonly<Record<string, boolean>>;

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

  // Every coverage gate, not just COVERAGE_INSTRUMENTATION (MINCRM-685): this
  // file's boot is the only one in this worker, and the health report's
  // `routers` block is a snapshot taken during it — so unsetting the query
  // gates here is what lets the report be checked against real registration
  // below.
  const previous = new Map<string, string | undefined>(
    COVERAGE_ROUTE_GATE_ENV_VARS.map((key) => [key, process.env[key]]),
  );
  for (const key of COVERAGE_ROUTE_GATE_ENV_VARS) {
    delete process.env[key];
  }

  vi.resetModules();
  const freshAppModule = await import('../app.js');
  appWithInstrumentationDisabled = freshAppModule.default;
  // Captured from the SAME module graph the app was built from, so it is the
  // snapshot that graph's route modules registered against.
  gatesAtBootForDisabledApp = (await import('../coverageAgent/coverageBootGate.js'))
    .COVERAGE_ROUTE_GATES_AT_BOOT;

  // Restore immediately so every OTHER test file in this worker (which
  // expects the gates set per .env.test) is unaffected — only this file's own
  // already-captured references keep their env-unset module snapshot.
  for (const [key, value] of previous) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
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

/**
 * The report must agree with what actually registered (MINCRM-685).
 *
 * This is the guarantee no unit test can give: it needs an app instance whose
 * routers really did or did not register, and the health report read from the
 * same module graph. The regression it guards is concrete — an earlier revision
 * read process.env per request, so with the gates deleted, booted, and the
 * environment restored (exactly what this file's beforeAll does), the report
 * answered {pipeline: true, mapping: true, reporting: true} while every one of
 * those paths 404'd. An operator debugging "why is coverage not working" would
 * have been told everything was fine.
 */
describe('GET /health — the routers block agrees with real registration (MINCRM-685)', () => {
  it('reports every coverage query router as unregistered, matching their 404s', async () => {
    const res = await request(appWithInstrumentationDisabled)
      .get('/api/v1/admin/coverage/health')
      .set('Cookie', adminCookie);

    expect([200, 503]).toContain(res.status);
    expect(res.body.routers).toEqual({ pipeline: false, mapping: false, reporting: false });

    // The snapshot this app's route modules registered against agrees too —
    // the report is not merely coincidentally false.
    expect(gatesAtBootForDisabledApp['COVERAGE_MAPPING_QUERY']).toBe(false);
    expect(gatesAtBootForDisabledApp['COVERAGE_REPORTING_QUERY']).toBe(false);
    expect(gatesAtBootForDisabledApp['COVERAGE_PIPELINE_INGESTION']).toBe(false);
  });

  it('and those routers really are absent — the 404s the report is claiming', async () => {
    for (const path of [
      '/api/v1/admin/coverage/mapping/tests-for-unit',
      '/api/v1/admin/coverage/reporting/summary',
    ]) {
      const res = await request(appWithInstrumentationDisabled)
        .get(path)
        .query({ commitSha: 'abc123', unitKey: 'x' })
        .set('Cookie', adminCookie);
      expect(res.status).toBe(404);
      // The app-level handler's code, not a handler's own "not found" —
      // proving the route does not exist rather than ran and found nothing.
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});
