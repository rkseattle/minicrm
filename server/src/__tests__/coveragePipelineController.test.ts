/**
 * Integration tests for the coverage pipeline ingestion API. (MINCRM-614)
 * Covers: auth boundaries (401/403-role/403-flag), Zod validation, 404
 * COVERAGE_DUMP_NOT_FOUND, and the ingest happy path via a real
 * browser-origin dump (ingested through the existing /coverage/dump
 * endpoint first, then normalized via /coverage/pipeline/ingest).
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { __clearCacheForTest } from '../services/featureFlagService.js';
import pool from '../db.js';
import coverageDb from '../coverageDb.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'coverage-pipeline-ctrl';

let adminCookie: string;
let repCookie: string;

async function setFlagEnabled(flagKey: string, enabled: boolean): Promise<void> {
  await pool.query(`UPDATE feature_flags SET enabled = $1 WHERE flag_key = $2`, [enabled, flagKey]);
  __clearCacheForTest();
}

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Coverage Pipeline Admin',
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
    name: 'Coverage Pipeline Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await setFlagEnabled('coverage_pipeline_ingestion', false);
  await setFlagEnabled('coverage_instrumentation', false);
});

describe('coverage pipeline API — auth boundaries', () => {
  beforeEach(async () => {
    await setFlagEnabled('coverage_pipeline_ingestion', true);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/pipeline/ingest')
      .send({ dumpId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when a rep (non-admin) calls the API', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/pipeline/ingest')
      .set('Cookie', repCookie)
      .send({ dumpId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(403);
  });

  it('returns 403 FEATURE_DISABLED when the pipeline flag is off, even for an admin', async () => {
    await setFlagEnabled('coverage_pipeline_ingestion', false);
    const res = await request(app)
      .post('/api/v1/admin/coverage/pipeline/ingest')
      .set('Cookie', adminCookie)
      .send({ dumpId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });
});

describe('coverage pipeline API — COVERAGE_CAPABILITY_GATING=true (MINCRM-637)', () => {
  const originalGating = process.env.COVERAGE_CAPABILITY_GATING;

  beforeEach(async () => {
    await setFlagEnabled('coverage_pipeline_ingestion', true);
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
      .post('/api/v1/admin/coverage/pipeline/ingest')
      .set('Cookie', adminCookie)
      .send({ dumpId: '00000000-0000-0000-0000-000000000000' });
    // 404 COVERAGE_DUMP_NOT_FOUND — the same status the "validation" describe
    // block below asserts for this exact request under default gating —
    // proves the request passed coverageAccessGate and reached the handler.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COVERAGE_DUMP_NOT_FOUND');
  });

  it('still 403s a non-admin, non-coverage:admin rep under capability mode', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/pipeline/ingest')
      .set('Cookie', repCookie)
      .send({ dumpId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(403);
  });
});

describe('coverage pipeline API — validation', () => {
  beforeEach(async () => {
    await setFlagEnabled('coverage_pipeline_ingestion', true);
  });

  it('returns 400 VALIDATION_ERROR when dumpId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/pipeline/ingest')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when dumpId is not a UUID', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/pipeline/ingest')
      .set('Cookie', adminCookie)
      .send({ dumpId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('coverage pipeline API — not found', () => {
  beforeEach(async () => {
    await setFlagEnabled('coverage_pipeline_ingestion', true);
  });

  it('returns 404 COVERAGE_DUMP_NOT_FOUND for an unknown dumpId', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/pipeline/ingest')
      .set('Cookie', adminCookie)
      .send({ dumpId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COVERAGE_DUMP_NOT_FOUND');
  });
});

describe('coverage pipeline API — ingest happy path', () => {
  beforeEach(async () => {
    await setFlagEnabled('coverage_pipeline_ingestion', true);
    await setFlagEnabled('coverage_instrumentation', true);
  });

  afterEach(async () => {
    await coverageDb.query('DELETE FROM coverage_units WHERE file_path = $1', ['src/App.tsx']);
  });

  it('ingests a real browser-origin dump into coverage_units', async () => {
    const dumpRes = await request(app)
      .post('/api/v1/admin/coverage/dump')
      .set('Cookie', adminCookie)
      .send({
        label: 'pipeline-integration-test',
        source: 'browser',
        payload: {
          'src/App.tsx': {
            path: 'src/App.tsx',
            statementMap: {},
            fnMap: {
              '0': {
                name: 'App',
                decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
                loc: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
                line: 1,
              },
            },
            branchMap: {},
            s: {},
            f: { '0': 2 },
            b: {},
          },
        },
      });
    expect(dumpRes.status).toBe(201);
    const dumpId = dumpRes.body.dump.dumpId;

    const ingestRes = await request(app)
      .post('/api/v1/admin/coverage/pipeline/ingest')
      .set('Cookie', adminCookie)
      .send({ dumpId });

    expect(ingestRes.status).toBe(201);
    expect(ingestRes.body.result.alreadyIngested).toBe(false);
    expect(ingestRes.body.result.unitCount).toBe(1);

    const again = await request(app)
      .post('/api/v1/admin/coverage/pipeline/ingest')
      .set('Cookie', adminCookie)
      .send({ dumpId });
    // 200, not 201 — a true no-op reports "not created", matching the
    // idempotent-PUT convention (see coveragePipelineController.ts).
    expect(again.status).toBe(200);
    expect(again.body.result.alreadyIngested).toBe(true);
  });
});
