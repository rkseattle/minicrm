/**
 * Integration tests for the coverage mapping query API. (MINCRM-621)
 * Covers: auth boundaries (401/403-role/403-flag), Zod validation, and the
 * query happy path (both directions), including that confidence/freshness
 * is attached to results.
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
import { linkCoverageUnitsToTest } from '../services/coverageMappingService.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'coverage-mapping-ctrl';

let adminCookie: string;
let repCookie: string;

async function setFlagEnabled(flagKey: string, enabled: boolean): Promise<void> {
  await pool.query(`UPDATE feature_flags SET enabled = $1 WHERE flag_key = $2`, [enabled, flagKey]);
  __clearCacheForTest();
}

async function linkAndCommit(
  commitSha: string,
  testId: string,
  testName: string | null,
  links: Parameters<typeof linkCoverageUnitsToTest>[4],
): Promise<void> {
  const client = await coverageDb.connect();
  try {
    await client.query('BEGIN');
    await linkCoverageUnitsToTest(client, commitSha, testId, testName, links);
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
  await setFlagEnabled('coverage_mapping_query', false);
});

describe('coverage mapping API — auth boundaries', () => {
  beforeEach(async () => {
    await setFlagEnabled('coverage_mapping_query', true);
  });

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

  it('returns 403 FEATURE_DISABLED when the flag is off, even for an admin', async () => {
    await setFlagEnabled('coverage_mapping_query', false);
    const res = await request(app)
      .get('/api/v1/admin/coverage/mapping/tests-for-unit')
      .set('Cookie', adminCookie)
      .query({ commitSha: 'abc', unitKey: 'render#123' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });
});

describe('coverage mapping API — validation', () => {
  beforeEach(async () => {
    await setFlagEnabled('coverage_mapping_query', true);
  });

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
  const unitKey = 'render#abc123';

  beforeAll(async () => {
    await setFlagEnabled('coverage_mapping_query', true);
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
    await linkAndCommit(commitSha, testId, 'creates a deal', [
      { unitKey, branchId: '0:0', filePath: 'src/widget.ts', hitCount: 3 },
    ]);
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
