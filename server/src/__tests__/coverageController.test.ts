/**
 * Integration tests for the coverage control API. (MINCRM-606, MINCRM-663)
 * Covers: auth boundaries (401/403-role), Zod validation, 409
 * COVERAGE_NOT_ENABLED, 404 DUMP_NOT_FOUND, and the browser-ingestion
 * happy path. The backend-agent happy path (reset/dump/snapshot with the
 * agent actually running) is covered by coverageDumpService.test.ts and
 * NodeV8CoverageAgent.test.ts — this file does not re-verify agent
 * internals, only the HTTP layer wrapping it.
 *
 * MINCRM-663: this router's routes are now registered only when
 * COVERAGE_INSTRUMENTATION='true' at process boot (see routes/coverage.ts's
 * own docblock) — no longer gated by a coverage_instrumentation
 * feature_flags row, so there is no flag to toggle on/off within a test
 * anymore. .env.test sets COVERAGE_INSTRUMENTATION=true so these routes
 * exist for this file's own auth/validation/happy-path assertions; the
 * "route doesn't exist at all when the env var is unset" case itself is
 * covered by coverageRouteGating.test.ts, which spawns a real subprocess
 * with the env var unset (module-load-time gating can't be tested by
 * toggling anything within THIS already-imported process).
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'coverage-ctrl';

let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Coverage Admin',
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
    name: 'Coverage Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('coverage control API — auth boundaries', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/v1/admin/coverage/reset').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 when a rep (non-admin) calls the API', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/reset')
      .set('Cookie', repCookie)
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('coverage control API — COVERAGE_CAPABILITY_GATING=true (MINCRM-637)', () => {
  const originalGating = process.env.COVERAGE_CAPABILITY_GATING;

  beforeEach(() => {
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
      .post('/api/v1/admin/coverage/reset')
      .set('Cookie', adminCookie)
      .send({});
    // 409 COVERAGE_NOT_ENABLED (agent never started in this test process) —
    // the exact status the "agent not started" describe block above
    // asserts for this same request under default gating — proves the
    // request passed coverageAccessGate and reached the handler.
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COVERAGE_NOT_ENABLED');
  });

  it('still 403s a non-admin, non-coverage:admin rep under capability mode', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/reset')
      .set('Cookie', repCookie)
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('coverage control API — agent not started', () => {
  it('returns 409 COVERAGE_NOT_ENABLED on reset when the backend agent never started', async () => {
    // The test server process boots without COVERAGE_INSTRUMENTATION=true,
    // so no agent is registered — this exercises the flag-on/agent-off gap.
    const res = await request(app)
      .post('/api/v1/admin/coverage/reset')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COVERAGE_NOT_ENABLED');
  });

  it('returns 409 COVERAGE_NOT_ENABLED on dump when no source/payload is given', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/dump')
      .set('Cookie', adminCookie)
      .send({ label: 'test-label' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COVERAGE_NOT_ENABLED');
  });
});

describe('coverage control API — validation', () => {
  it('returns 400 VALIDATION_ERROR when label is missing on dump', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/dump')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when source is "browser" but payload is missing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/dump')
      .set('Cookie', adminCookie)
      .send({ label: 'browser-dump', source: 'browser' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('coverage control API — browser dump ingestion', () => {
  it('ingests a browser-origin dump and it is retrievable via GET /dumps/:dumpId', async () => {
    const createRes = await request(app)
      .post('/api/v1/admin/coverage/dump')
      .set('Cookie', adminCookie)
      .send({
        label: 'browser-integration-test',
        source: 'browser',
        payload: { 'src/App.tsx': { path: 'src/App.tsx', s: { '0': 1 } } },
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.dump.agent).toBe('browser-istanbul');
    expect(createRes.body.dump.format).toBe('istanbul');

    const dumpId = createRes.body.dump.dumpId;
    const getRes = await request(app)
      .get(`/api/v1/admin/coverage/dumps/${dumpId}`)
      .set('Cookie', adminCookie);

    expect(getRes.status).toBe(200);
    expect(getRes.body.dump.dumpId).toBe(dumpId);
  });

  it('returns 404 DUMP_NOT_FOUND for an unknown dumpId', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/dumps/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DUMP_NOT_FOUND');
  });
});
