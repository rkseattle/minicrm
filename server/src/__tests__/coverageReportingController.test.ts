/**
 * Integration tests for the coverage reporting query API. (MINCRM-629/630/631)
 * Covers: auth boundaries (401/403-role/403-flag), Zod validation, and the
 * query happy path for each endpoint.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { __clearCacheForTest } from '../services/featureFlagService.js';
import pool from '../db.js';
import coverageDb from '../coverageDb.js';
import { upsertCoverageUnits } from '../services/coverageModelService.js';
import { upsertBuildSummaryForCommit } from '../services/coverageBuildSummaryService.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'coverage-reporting-ctrl';

let adminCookie: string;
let repCookie: string;

async function setFlagEnabled(flagKey: string, enabled: boolean): Promise<void> {
  await pool.query(`UPDATE feature_flags SET enabled = $1 WHERE flag_key = $2`, [enabled, flagKey]);
  __clearCacheForTest();
}

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
  await setFlagEnabled('coverage_reporting_query', false);
});

describe('coverage reporting API — auth boundaries', () => {
  beforeEach(async () => {
    await setFlagEnabled('coverage_reporting_query', true);
  });

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

  it('returns 403 FEATURE_DISABLED when the flag is off, even for an admin', async () => {
    await setFlagEnabled('coverage_reporting_query', false);
    const res = await request(app)
      .get('/api/v1/admin/coverage/reporting/summary')
      .set('Cookie', adminCookie)
      .query({ commitSha: 'abc' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });
});

describe('coverage reporting API — validation', () => {
  beforeEach(async () => {
    await setFlagEnabled('coverage_reporting_query', true);
  });

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
    await setFlagEnabled('coverage_reporting_query', true);
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
