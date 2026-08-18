/**
 * Regression test for that work: with every COVERAGE_* route
 * gate unset (the production default — an admin with full CRM access and no
 * special env/build context), every path under /api/v1/admin/coverage/*
 * (control API), /sessions/* (session management), /mapping/*, /reporting/*,
 * and /pipeline/* must 404, not 403 — there is nothing registered on those
 * routers to discover at all, not merely a gate that reports "off" (see
 * routes/coverage.ts and routes/coverageSessions.ts's own docblocks for the
 * full rationale).
 *
 * extended this from two routers to five. The mapping/reporting/
 * pipeline routers previously gated on feature_flags rows and returned 403
 * FEATURE_DISABLED when the row was off; those rows are gone, and the
 * flag-disabled assertions that used to live in the E2E specs
 * (coverage-mapping.spec.ts's COVM-02, coverage-pipeline.spec.ts's COVP-02)
 * moved here — a boot-time env var cannot be flipped mid-run by an E2E spec,
 * but it can be by a module re-import, which is exactly what this file does.
 *
 * ONE boot, and it must be the first import of app.ts in this worker. A route
 * module's top-level gate runs on FIRST evaluation only; vi.resetModules()
 * hands back a new `app` object but does not re-evaluate an already-evaluated
 * route module, so a second boot with different env values silently serves the
 * first boot's registrations. Confirmed empirically while writing these tests.
 * That is also why the COVERAGE_DASHBOARD_NO_AUTH interaction is NOT tested
 * here: proving "the bypass does not resurrect an unregistered route" needs a
 * registered-route control in the same worker to avoid passing vacuously, and
 * a control requires a second boot. That guarantee is covered by
 * coverageAccessGate.test.ts's "COVERAGE_DASHBOARD_NO_AUTH bypass scope"
 * describe block instead, at the middleware level, where the chain can be
 * exercised directly without booting the app at all.
 *
 * Every gate is read at MODULE LOAD time (a top-level registerRoutesIfEnabled
 * call in each route file, not a per-request middleware check), so the rest of
 * this suite's .env.test setting them to
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
// Imported, NOT restated: this is the same list registerRoutesIfEnabled gates
// on, so a sixth coverage router is covered by this test the moment it is
// added rather than whenever someone remembers to update a copy here.
import { COVERAGE_ROUTE_GATE_ENV_VARS } from '../coverageAgent/coverageBootGate.js';

const FILE_PREFIX = 'coverage-route-gating';

/**
 * The error code app.ts's terminal 404 handler emits. Asserting it — not just
 * the 404 status — is what makes these tests able to fail.
 *
 * Several coverage handlers answer 404 themselves for a legitimately-missing
 * resource (COVERAGE_BUILD_NOT_FOUND, COVERAGE_DUMP_NOT_FOUND, DUMP_NOT_FOUND),
 * so a bare status check cannot tell "the route was never registered" from
 * "the route ran and found nothing". Verified by mutation: with the boot gate
 * forced open, status-only assertions on /reporting/summary, /pipeline/ingest
 * and /dumps/:dumpId all still passed. Only the code distinguishes the two.
 */
const APP_LEVEL_NOT_FOUND_CODE = 'NOT_FOUND';

let adminCookie: string;
let appWithGatingDisabled: Application;

/**
 * Boots ONE app module with every coverage route gate unset, then restores the
 * previous environment.
 *
 * Exactly one boot per worker process, deliberately. Each route file's gate is a
 * top-level `if` that runs on FIRST evaluation and registers onto a router
 * object that is then reused: `vi.resetModules()` gives you a new `app` object,
 * but it does NOT re-run an already-evaluated route module, so a second boot
 * with different env values silently serves the FIRST boot's registrations.
 * Verified empirically while writing these tests — a "gates off" second boot
 * still reached coverageReportingController. Restoring the environment right
 * after the import matters for the same reason in reverse: every OTHER test
 * file in this worker expects the routes to exist per .env.test.
 *
 * COVERAGE_DASHBOARD_NO_AUTH is deliberately NOT touched here. It is not a
 * boot-time gate — isDashboardNoAuthEnabled reads it per request (see its own
 * docblock) — so a test exercising the bypass sets it around its own requests
 * against this same app instance.
 *
 * Load-bearing subtlety: this works only because `dotenv/config` is already
 * warm in the module registry when the re-import happens. app.ts itself does
 * `import 'dotenv/config'`, and a COLD dotenv after vi.resetModules() re-reads
 * .env.test and puts all five vars straight back — undoing the deletions above
 * before the route modules evaluate. It is warm here because this file
 * statically imports `../db.js`, which imports dotenv at module load, long
 * before this function runs. That became load-bearing in a later change: the three
 * new vars are now ACTIVE in .env.test.example, so they are present in every
 * developer's .env.test, where before there was nothing for a cold dotenv to
 * restore. Keep the `pool` import (or an equivalent eager dotenv import) even
 * if this file stops using it directly.
 */
async function bootAppWithoutCoverageGates(): Promise<Application> {
  const previous = new Map<string, string | undefined>(
    COVERAGE_ROUTE_GATE_ENV_VARS.map((key) => [key, process.env[key]]),
  );

  for (const key of COVERAGE_ROUTE_GATE_ENV_VARS) {
    delete process.env[key];
  }

  vi.resetModules();
  const freshAppModule = await import('../app.js');
  const app = freshAppModule.default;

  for (const [key, value] of previous) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.resetModules();

  return app;
}

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

  appWithGatingDisabled = await bootAppWithoutCoverageGates();
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
    expect(res.body.error.code).toBe(APP_LEVEL_NOT_FOUND_CODE);
  });

  it('returns 404, not 403, on POST /snapshot for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .post('/api/v1/admin/coverage/snapshot')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(APP_LEVEL_NOT_FOUND_CODE);
  });

  it('returns 404, not 403, on POST /dump for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .post('/api/v1/admin/coverage/dump')
      .set('Cookie', adminCookie)
      .send({ label: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(APP_LEVEL_NOT_FOUND_CODE);
  });

  it('returns 404, not 403, on GET /dumps/:dumpId for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .get('/api/v1/admin/coverage/dumps/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(APP_LEVEL_NOT_FOUND_CODE);
  });
});

describe('coverage session management API — routes absent when COVERAGE_SESSION_MANAGEMENT is unset', () => {
  it('returns 404, not 403, on POST /sessions for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send({ label: 'x', source: 'manual', buildSha: 'sha', environment: 'test' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(APP_LEVEL_NOT_FOUND_CODE);
  });

  it('returns 404, not 403, on GET /sessions for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .get('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(APP_LEVEL_NOT_FOUND_CODE);
  });
});

describe('coverage mapping query API — routes absent when COVERAGE_MAPPING_QUERY is unset', () => {
  it('returns 404, not 403 FEATURE_DISABLED, on GET /mapping/tests-for-unit for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .query({ commitSha: 'abc123', unitKey: 'x' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(APP_LEVEL_NOT_FOUND_CODE);
  });

  it('returns 404 on GET /mapping/units-for-test for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .get('/api/v1/admin/coverage/mapping/units-for-test')
      .query({ commitSha: 'abc123', testId: 'x' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(APP_LEVEL_NOT_FOUND_CODE);
  });
});

describe('coverage reporting query API — routes absent when COVERAGE_REPORTING_QUERY is unset', () => {
  it('returns 404, not 403 FEATURE_DISABLED, on GET /reporting/summary for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .get('/api/v1/admin/coverage/reporting/summary')
      .query({ commitSha: 'abc123' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(APP_LEVEL_NOT_FOUND_CODE);
  });

  it('returns 404 on GET /reporting/gaps for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .get('/api/v1/admin/coverage/reporting/gaps')
      .query({ commitSha: 'abc123' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(APP_LEVEL_NOT_FOUND_CODE);
  });
});

describe('coverage pipeline API — routes absent when COVERAGE_PIPELINE_INGESTION is unset', () => {
  it('returns 404, not 403 FEATURE_DISABLED, on POST /pipeline/ingest for an authenticated admin', async () => {
    const res = await request(appWithGatingDisabled)
      .post('/api/v1/admin/coverage/pipeline/ingest')
      .set('Cookie', adminCookie)
      .send({ dumpId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(APP_LEVEL_NOT_FOUND_CODE);
  });
});
