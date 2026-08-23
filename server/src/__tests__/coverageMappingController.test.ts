/**
 * Integration tests for the coverage mapping query API.
 * Covers: auth boundaries (401 unauthenticated, 403 non-admin role), Zod validation, and the
 * query happy path (both directions), including that confidence/freshness
 * is attached to results.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import coverageDb from '../coverageDb.js';
import { upsertCoverageUnits } from '../services/coverageModelService.js';
import { linkCoverageUnitsToTest } from '../services/coverageMappingService.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'coverage-mapping-ctrl';

let adminCookie: string;
let repCookie: string;

async function linkAndCommit(
  commitSha: string,
  testId: string,
  testName: string | null,
  links: Parameters<typeof linkCoverageUnitsToTest>[5],
  testFile: string | null = null,
): Promise<void> {
  const client = await coverageDb.connect();
  try {
    await client.query('BEGIN');
    await linkCoverageUnitsToTest(client, commitSha, testId, testName, testFile, links);
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
    name: 'Coverage Mapping Admin',
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
    name: 'Coverage Mapping Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('coverage mapping API — auth boundaries', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .query({ commitSha: 'abc', unitKey: 'render#123' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when a rep (non-admin) calls the API', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .set('Cookie', repCookie)
      .query({ commitSha: 'abc', unitKey: 'render#123' });
    expect(res.status).toBe(403);
  });

  // The former "403 FEATURE_DISABLED when the flag is off" case is gone with
  // the coverage_mapping_query row. Its replacement lives in
  // coverageRouteGating.test.ts, which asserts a 404 when COVERAGE_MAPPING_QUERY
  // is unset at boot — the routes are not registered at all rather than
  // registered-and-refusing. It cannot live here: this file imports app.js
  // once at module load, and a boot-time gate can only be exercised by the
  // vi.resetModules() + dynamic re-import discipline that file is built around.
});

describe('coverage mapping API — COVERAGE_CAPABILITY_GATING=true', () => {
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
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .set('Cookie', adminCookie)
      .query({ commitSha: 'abc', unitKey: 'render#123' });
    // 200 with an empty results array (no coverage data for this commitSha)
    // — proves the request passed coverageAccessGate and reached the
    // handler, not just that it avoided a 403.
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('still 403s a non-admin, non-coverage:admin rep under capability mode', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .set('Cookie', repCookie)
      .query({ commitSha: 'abc', unitKey: 'render#123' });
    expect(res.status).toBe(403);
  });
});

describe('coverage mapping API — COVERAGE_DASHBOARD_NO_AUTH=true', () => {
  const originalNoAuth = process.env.COVERAGE_DASHBOARD_NO_AUTH;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.COVERAGE_DASHBOARD_NO_AUTH = 'true';
  });

  afterEach(async () => {
    if (originalNoAuth !== undefined) {
      process.env.COVERAGE_DASHBOARD_NO_AUTH = originalNoAuth;
    } else {
      delete process.env.COVERAGE_DASHBOARD_NO_AUTH;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('serves an unauthenticated request when the bypass is on', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .query({ commitSha: 'abc', unitKey: 'render#123' });
    // No cookie at all — this is the whole point of the no-auth mode. 200 with
    // an empty array proves the request reached the handler.
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  // The STILL returns 403 FEATURE_DISABLED when the flag is off"
  // case is retired here, and the invariant it pinned is DELIBERATELY DROPPED
  // rather than relocated — with COVERAGE_DASHBOARD_NO_AUTH on,
  // this router now has no per-request gate at all. See the equivalent comment
  // in coverageReportingController.test.ts for the full rationale; the short
  // version is that route registration (COVERAGE_MAPPING_QUERY at boot) is now
  // the gate, which is coarser but harder to defeat, and the bypass still
  // requires a development or test NODE_ENV.

  it('never bypasses auth when NODE_ENV=production, regardless of COVERAGE_DASHBOARD_NO_AUTH', async () => {
    // The hard safety rail a copied .env file could not defeat. Mirrors the
    // same case in coverageReportingController and coverageSessionController —
    // worth pinning per router because buildCoverageAccessGate now makes one
    // isDashboardNoAuthEnabled() branch govern all three, so a regression
    // there would open every one of them at once.
    process.env.NODE_ENV = 'production';
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .query({ commitSha: 'abc', unitKey: 'render#123' });
    expect(res.status).toBe(401);
  });
});

describe('coverage mapping API — validation', () => {
  it('returns 400 VALIDATION_ERROR when unitKey is missing on tests-for-unit', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .set('Cookie', adminCookie)
      .query({ commitSha: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when testId is missing on units-for-test', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/units-for-test')
      .set('Cookie', adminCookie)
      .query({ commitSha: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('coverage mapping API — query happy path', () => {
  const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
  const testId = 'spec:deals.spec.ts::creates a deal';
  const testFile = 'tests/apps/minicrm/functional/deals/deal-creation.spec.ts';
  const unitKey = 'render#abc123';

  beforeAll(async () => {
    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [
      {
        filePath: 'src/widget.ts',
        unitKey,
        branchId: '0:0',
        granularity: 'branch',
        hitCount: 3,
        resolved: true,
        unresolvedReason: null,
      },
    ]);
    await linkAndCommit(
      commitSha,
      testId,
      'creates a deal',
      [{ unitKey, branchId: '0:0', filePath: 'src/widget.ts', hitCount: 3 }],
      testFile,
    );
  });

  afterAll(async () => {
    await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [commitSha]);
    await coverageDb.query('DELETE FROM coverage_units WHERE commit_sha = $1', [commitSha]);
  });

  it('finds tests for a unit, with confidence/freshness attached', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .set('Cookie', adminCookie)
      .query({ commitSha, unitKey, branchId: '0:0' });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      commitSha,
      unitKey,
      branchId: '0:0',
      testId,
      testName: 'creates a deal',
      testFile,
      hitCount: 3,
    });
    expect(typeof res.body.results[0].confidenceScore).toBe('number');
  });

  it('returns an empty array for a unit no test covers', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .set('Cookie', adminCookie)
      .query({ commitSha, unitKey: 'nonexistent#000' });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('finds units for a test, with confidence/freshness attached', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/units-for-test')
      .set('Cookie', adminCookie)
      .query({ commitSha, testId });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      commitSha,
      unitKey,
      testId,
      hitCount: 3,
    });
  });
});

describe('coverage mapping API — unit-key/test-ID typeahead search', () => {
  const commitSha = `${FILE_PREFIX}-search-${randomUUID()}`;

  beforeAll(async () => {
    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [
      {
        filePath: 'src/DealsPage.tsx',
        unitKey: 'handleSubmit#aaa111',
        branchId: null,
        granularity: 'function',
        hitCount: 5,
        resolved: true,
        unresolvedReason: null,
      },
      {
        filePath: 'src/DealsPage.tsx',
        unitKey: 'renderRow#bbb222',
        branchId: null,
        granularity: 'function',
        hitCount: 2,
        resolved: true,
        unresolvedReason: null,
      },
    ]);
    await linkAndCommit(
      commitSha,
      'spec:deals.spec.ts::submits the deal form',
      'submits the deal form',
      [
        {
          unitKey: 'handleSubmit#aaa111',
          branchId: null,
          filePath: 'src/DealsPage.tsx',
          hitCount: 5,
        },
      ],
    );
  });

  afterAll(async () => {
    await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [commitSha]);
    await coverageDb.query('DELETE FROM coverage_units WHERE commit_sha = $1', [commitSha]);
  });

  it('finds a unit key by a case-insensitive substring match', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/unit-keys/search')
      .set('Cookie', adminCookie)
      .query({ commitSha, search: 'handlesubmit' });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unitKey: 'handleSubmit#aaa111', filePath: 'src/DealsPage.tsx' }),
      ]),
    );
    expect(res.body.results).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ unitKey: 'renderRow#bbb222' })]),
    );
  });

  it('returns 400 VALIDATION_ERROR when search is missing', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/unit-keys/search')
      .set('Cookie', adminCookie)
      .query({ commitSha });
    expect(res.status).toBe(400);
  });

  it('finds a test by matching test_name, not just test_id', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/test-ids/search')
      .set('Cookie', adminCookie)
      .query({ commitSha, search: 'submits the deal' });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          testId: 'spec:deals.spec.ts::submits the deal form',
          testName: 'submits the deal form',
        }),
      ]),
    );
  });

  it('returns an empty array for a search term with no matches', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/test-ids/search')
      .set('Cookie', adminCookie)
      .query({ commitSha, search: 'nonexistent-test-xyz' });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });
});
