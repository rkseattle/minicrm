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

  // Boot with a MIXED gate configuration, not all-off (MINCRM-685). This file
  // owns this worker's single app boot, and the health report's `routers` block
  // is a snapshot taken during it.
  //
  // Mixed specifically because uniform values cannot catch a permuted mapping.
  // Every environment sets these three to the SAME value — .env.test all true,
  // CI all "true", docker-compose.test.yml all 'true' — so if this file also
  // set them uniformly, swapping `pipeline:` and `mapping:` in
  // coverageHealthService would be observationally identical and every
  // assertion here would still pass. Verified by mutation: with a uniform
  // setup, a swapped mapping passed 19/19 across all three health test files.
  //
  // COVERAGE_MAPPING_QUERY off, the other two on, gives each field a distinct
  // expected value and makes the key→env-var mapping falsifiable.
  const previous = new Map<string, string | undefined>(
    COVERAGE_ROUTE_GATE_ENV_VARS.map((key) => [key, process.env[key]]),
  );
  for (const key of COVERAGE_ROUTE_GATE_ENV_VARS) {
    delete process.env[key];
  }
  process.env.COVERAGE_PIPELINE_INGESTION = 'true';
  process.env.COVERAGE_REPORTING_QUERY = 'true';

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
  // This app booted with COVERAGE_MAPPING_QUERY unset and the other two set,
  // so each field has a DIFFERENT expected value. That asymmetry is the whole
  // point: it is what makes a permuted key→env-var mapping in
  // coverageHealthService fail here instead of passing silently.
  it('reports each router independently, matching the gates it actually booted with', async () => {
    const res = await request(appWithInstrumentationDisabled)
      .get('/api/v1/admin/coverage/health')
      .set('Cookie', adminCookie);

    expect([200, 503]).toContain(res.status);
    expect(res.body.routers).toEqual({ pipeline: true, mapping: false, reporting: true });

    // The snapshot this app's route modules registered against agrees field for
    // field — the report is not merely coincidentally right.
    expect(gatesAtBootForDisabledApp['COVERAGE_MAPPING_QUERY']).toBe(false);
    expect(gatesAtBootForDisabledApp['COVERAGE_REPORTING_QUERY']).toBe(true);
    expect(gatesAtBootForDisabledApp['COVERAGE_PIPELINE_INGESTION']).toBe(true);
  });

  it('and the unregistered router really is absent, while the registered ones are reachable', async () => {
    // The negative half: mapping was gated off, so its path does not exist.
    const absent = await request(appWithInstrumentationDisabled)
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .query({ commitSha: 'abc123', unitKey: 'x' })
      .set('Cookie', adminCookie);
    expect(absent.status).toBe(404);
    // The app-level handler's code, not a handler's own "not found" — proving
    // the route does not exist rather than ran and found nothing.
    expect(absent.body.error.code).toBe('NOT_FOUND');

    // The positive half, on the same app instance: reporting WAS gated on, so
    // its route exists and reaches its handler. Without this, the assertion
    // above could pass on an app where nothing at all registered.
    const present = await request(appWithInstrumentationDisabled)
      .get('/api/v1/admin/coverage/reporting/summary')
      .query({ commitSha: 'coverage-health-route-gating-nonexistent-commit' })
      .set('Cookie', adminCookie);
    expect(present.status).toBe(404);
    expect(present.body.error.code).toBe('COVERAGE_BUILD_NOT_FOUND');
  });
});
