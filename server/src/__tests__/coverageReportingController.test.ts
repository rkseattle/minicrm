/**
 * Integration tests for the coverage reporting query API. (MINCRM-629/630/631)
 * Covers: auth boundaries (401 unauthenticated, 403 non-admin role), Zod validation, and the
 * query happy path for each endpoint.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import coverageDb from '../coverageDb.js';
import { upsertCoverageUnits } from '../services/coverageModelService.js';
import { upsertBuildSummaryForCommit } from '../services/coverageBuildSummaryService.js';
import { startCoverageSession, endCoverageSession } from '../services/coverageSessionService.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'coverage-reporting-ctrl';

let adminCookie: string;
let repCookie: string;

async function upsertSummary(commitSha: string): Promise<void> {
  const client = await coverageDb.connect();
  try {
    await client.query('BEGIN');
    await upsertBuildSummaryForCommit(client, commitSha);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Coverage Reporting Admin',
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
    name: 'Coverage Reporting Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('coverage reporting API — auth boundaries', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/summary')
      .query({ commitSha: 'abc' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when a rep (non-admin) calls the API', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/summary')
      .set('Cookie', repCookie)
      .query({ commitSha: 'abc' });
    expect(res.status).toBe(403);
  });

  // The former "403 FEATURE_DISABLED when the flag is off" case is gone with
  // the coverage_reporting_query row (MINCRM-685). Its replacement lives in
  // coverageRouteGating.test.ts, which asserts a 404 when
  // COVERAGE_REPORTING_QUERY is unset at boot — the routes are not registered
  // at all rather than registered-and-refusing. It cannot live here: this file
  // imports app.js once at module load, and a boot-time gate can only be
  // exercised by the vi.resetModules() + dynamic re-import discipline that
  // file is built around.
});

describe('coverage reporting API — COVERAGE_CAPABILITY_GATING=true (MINCRM-637)', () => {
  const originalGating = process.env.COVERAGE_CAPABILITY_GATING;

  beforeEach(async () => {
    process.env.COVERAGE_CAPABILITY_GATING = 'true';
  });

  afterEach(() => {
    if (originalGating !== undefined) {
      process.env.COVERAGE_CAPABILITY_GATING = originalGating;
    } else {
      delete process.env.COVERAGE_CAPABILITY_GATING;
    }
  });

  it('still grants the built-in admin role access via coverage:admin (migration 162), routed through coverageAccessGate', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/summary')
      .set('Cookie', adminCookie)
      .query({ commitSha: 'abc' });
    // 404 COVERAGE_BUILD_NOT_FOUND — the same status the "returns 404 for a
    // commit with no build summary" test above asserts for an unseen
    // commitSha under default gating — proves the request passed
    // coverageAccessGate and reached the handler.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COVERAGE_BUILD_NOT_FOUND');
  });

  it('still 403s a non-admin, non-coverage:admin rep under capability mode', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/summary')
      .set('Cookie', repCookie)
      .query({ commitSha: 'abc' });
    expect(res.status).toBe(403);
  });
});

describe('coverage reporting API — COVERAGE_DASHBOARD_NO_AUTH=true (MINCRM-636/637)', () => {
  const originalNoAuth = process.env.COVERAGE_DASHBOARD_NO_AUTH;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    process.env.COVERAGE_DASHBOARD_NO_AUTH = 'true';
  });

  afterEach(() => {
    if (originalNoAuth !== undefined) {
      process.env.COVERAGE_DASHBOARD_NO_AUTH = originalNoAuth;
    } else {
      delete process.env.COVERAGE_DASHBOARD_NO_AUTH;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('serves an unauthenticated request with no cookie at all — the coverage-dashboard app has no login of its own', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/summary')
      .query({ commitSha: 'abc' });
    // 404 COVERAGE_BUILD_NOT_FOUND, not 401 — proves the request reached
    // the handler with no Cookie header set at all.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COVERAGE_BUILD_NOT_FOUND');
  });

  // MINCRM-694's flag-enforcement-under-the-bypass case is retired here, and the
  // invariant it pinned is DELIBERATELY DROPPED rather than relocated (MINCRM-685;
  // the coverage_reporting_query row it named no longer exists). Stating
  // that plainly because it is a real reduction, not a refactor: with
  // COVERAGE_DASHBOARD_NO_AUTH on, this router now has no per-request gate at
  // all — the org-wide flag column was the last one, and it is gone with the
  // row.
  //
  // What replaces it is a coarser gate one level up: the routes are not
  // registered at all unless COVERAGE_REPORTING_QUERY was 'true' at boot, so
  // the bypass has nothing to expose in a deployment that did not opt in. That
  // is harder to defeat than a mutable row an admin could flip from the product
  // UI, but it is not the same guarantee — it cannot be revoked without a
  // restart, and it is all-or-nothing per deployment rather than per request.
  // Acceptable here because isDashboardNoAuthEnabled additionally requires
  // NODE_ENV !== 'production' (asserted below), so the combination cannot occur
  // in a real deployment.
  //
  // The boot gate itself is covered by coverageRouteGating.test.ts; the bypass
  // predicate's own scope is covered by coverageAccessGate.test.ts.

  it('never bypasses auth when NODE_ENV=production, regardless of the flag — the hard safety rail a copied .env file could not defeat', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/summary')
      .query({ commitSha: 'abc' });
    expect(res.status).toBe(401);
  });
});

describe('coverage reporting API — validation', () => {
  it('returns 400 VALIDATION_ERROR when commitSha is missing on /summary', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/summary')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when fromSha/toSha are missing on /tia-metrics', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/tia-metrics')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('coverage reporting API — query happy path', () => {
  const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

  beforeAll(async () => {
    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [
      {
        filePath: `${FILE_PREFIX}/widget.ts`,
        unitKey: 'render#abc123',
        branchId: null,
        granularity: 'function',
        hitCount: 3,
        resolved: true,
        unresolvedReason: null,
      },
      {
        filePath: `${FILE_PREFIX}/widget.ts`,
        unitKey: 'unused#def456',
        branchId: null,
        granularity: 'function',
        hitCount: 0,
        resolved: true,
        unresolvedReason: null,
      },
    ]);
    await upsertSummary(commitSha);
  });

  afterAll(async () => {
    await coverageDb.query('DELETE FROM coverage_build_summary WHERE commit_sha = $1', [commitSha]);
    await coverageDb.query('DELETE FROM coverage_units WHERE commit_sha = $1', [commitSha]);
  });

  it('GET /summary returns the build coverage summary', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/summary')
      .set('Cookie', adminCookie)
      .query({ commitSha });

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ commitSha, apiUnitCount: 2, apiCoveredUnitCount: 1 });
  });

  it('GET /summary returns 404 for a commit with no build summary', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/summary')
      .set('Cookie', adminCookie)
      .query({ commitSha: `${FILE_PREFIX}-never-ingested` });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COVERAGE_BUILD_NOT_FOUND');
  });

  it('GET /trend returns recent build summaries', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/trend')
      .set('Cookie', adminCookie)
      .query({ limit: 5 });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('GET /gaps returns dead zones and never-taken branches, changedUntestedUnits null without baseSha', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/gaps')
      .set('Cookie', adminCookie)
      .query({ commitSha });

    expect(res.status).toBe(200);
    expect(
      res.body.deadZoneUnits.some((u: { unitKey: string }) => u.unitKey === 'unused#def456'),
    ).toBe(true);
    expect(res.body.changedUntestedUnits).toBeNull();
  });

  it('GET /issues/:issueKey/coverage returns a zeroed rollup for an unknown issue', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/coverage/reporting/issues/MINCRM-999999/coverage`)
      .set('Cookie', adminCookie)
      .query({ commitSha });

    expect(res.status).toBe(200);
    expect(res.body.coverage).toMatchObject({
      issueKey: 'MINCRM-999999',
      sessionCount: 0,
      coveredUnitCount: 0,
    });
  });

  it('GET /tia-metrics returns aggregate metrics over a range', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/tia-metrics')
      .set('Cookie', adminCookie)
      .query({ fromSha: commitSha, toSha: commitSha });

    expect(res.status).toBe(200);
    expect(res.body.metrics.totalBuilds).toBe(1);
  });
});

describe('coverage reporting API — GET /issue-keys (MINCRM-636/637)', () => {
  const commitSha = `${FILE_PREFIX}-issue-keys-${randomUUID()}`;

  beforeAll(async () => {
    const sessionA = await startCoverageSession({
      label: 'manual-testing-a',
      source: 'manual',
      buildSha: commitSha,
      environment: 'test',
      issueKey: 'MINCRM-1001',
    });
    await endCoverageSession(sessionA.id, sessionA.version);
    const sessionB = await startCoverageSession({
      label: 'manual-testing-b',
      source: 'manual',
      buildSha: commitSha,
      environment: 'test',
      issueKey: 'MINCRM-1002',
    });
    await endCoverageSession(sessionB.id, sessionB.version);
    // No issueKey — must never surface as a null/empty entry in the list.
    const sessionNoIssue = await startCoverageSession({
      label: 'manual-testing-no-issue',
      source: 'manual',
      buildSha: commitSha,
      environment: 'test',
    });
    await endCoverageSession(sessionNoIssue.id, sessionNoIssue.version);
  });

  afterAll(async () => {
    await coverageDb.query('DELETE FROM coverage_sessions WHERE build_sha = $1', [commitSha]);
  });

  it('lists distinct issue keys with a coverage session recorded for this build', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/issue-keys')
      .set('Cookie', adminCookie)
      .query({ commitSha });

    expect(res.status).toBe(200);
    expect(res.body.issueKeys).toEqual(['MINCRM-1001', 'MINCRM-1002']);
  });

  it('returns an empty array for a commit with no sessions at all', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/issue-keys')
      .set('Cookie', adminCookie)
      .query({ commitSha: `${FILE_PREFIX}-issue-keys-never-recorded` });

    expect(res.status).toBe(200);
    expect(res.body.issueKeys).toEqual([]);
  });
});
