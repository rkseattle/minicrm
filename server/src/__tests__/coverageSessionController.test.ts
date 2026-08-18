/**
 * Integration tests for the coverage session control API.
 * Covers: auth boundaries (401/403-role), Zod validation, invalid
 * sessionId path params, the ended-session conflict paths (double-end,
 * dump attribution after end), and duplicate-dumpId rejection.
 *
 * this router's routes are now registered only when
 * COVERAGE_SESSION_MANAGEMENT='true' at process boot (see
 * routes/coverageSessions.ts's own docblock) — no longer gated by a
 * coverage_session_management feature_flags row. .env.test sets
 * COVERAGE_SESSION_MANAGEMENT=true so these routes exist for this file's own
 * assertions; the "route doesn't exist at all when the env var is unset"
 * case is covered by coverageRouteGating.test.ts.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import coverageDb from '../coverageDb.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'coverage-session-ctrl';

let adminCookie: string;
let repCookie: string;
let adminId: string;

function baseSessionBody(label: string) {
  return {
    label,
    source: 'automated-e2e',
    buildSha: 'ctrl-test-sha',
    environment: 'test',
  };
}

beforeAll(async () => {
  // Cannot look up product-DB users by email to scope coverage_sessions
  // cleanup here (coverage_sessions.started_by is a plain uuid with no
  // cross-database foreign key into users — see
  // qa/migrations/001_coverage_baseline.js) — cleanup instead filters
  // coverage_sessions directly by adminId once it's known, in afterAll.
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Coverage Session Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Coverage Session Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await coverageDb.query(
    'DELETE FROM coverage_session_dumps WHERE session_id IN (SELECT id FROM coverage_sessions WHERE started_by = $1)',
    [adminId],
  );
  await coverageDb.query('DELETE FROM coverage_sessions WHERE started_by = $1', [adminId]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('coverage session control API — auth boundaries', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .send(baseSessionBody('auth-401'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when a rep (non-admin) calls the API', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', repCookie)
      .send(baseSessionBody('auth-403-role'));
    expect(res.status).toBe(403);
  });
});

describe('coverage session control API — COVERAGE_CAPABILITY_GATING=true', () => {
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
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send(baseSessionBody('capability-gating-admin'));
    // 201 with a minted session — proves the request passed
    // coverageAccessGate and reached the handler, not just that it avoided
    // a 403. Cleaned up by this file's own afterAll, which deletes every
    // coverage_sessions row started_by adminId.
    expect(res.status).toBe(201);
    expect(res.body.session).toMatchObject({ label: 'capability-gating-admin', status: 'active' });
  });

  it('still 403s a non-admin, non-coverage:admin rep under capability mode', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', repCookie)
      .send(baseSessionBody('capability-gating-rep'));
    expect(res.status).toBe(403);
  });
});

describe('coverage session control API — COVERAGE_DASHBOARD_NO_AUTH=true', () => {
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
    // Cleans up sessions this describe block starts with no adminId to
    // scope by (requests carry no cookie at all under the bypass) — the
    // dashboard-recognizable label prefix is the only handle available.
    await coverageDb.query(
      "DELETE FROM coverage_session_dumps WHERE session_id IN (SELECT id FROM coverage_sessions WHERE label LIKE 'no-auth-%')",
    );
    await coverageDb.query("DELETE FROM coverage_sessions WHERE label LIKE 'no-auth-%'");
  });

  it('starts and lists a session with no cookie at all — the coverage-dashboard app has no login of its own', async () => {
    const startRes = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .send(baseSessionBody('no-auth-lifecycle'));
    expect(startRes.status).toBe(201);
    expect(startRes.body.session).toMatchObject({ label: 'no-auth-lifecycle', status: 'active' });

    const listRes = await request(app).get('/api/v1/admin/coverage/sessions');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'no-auth-lifecycle' })]),
    );
  });

  it('never bypasses auth when NODE_ENV=production, regardless of COVERAGE_DASHBOARD_NO_AUTH — the hard safety rail a copied .env file could not defeat', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .send(baseSessionBody('no-auth-production-guard'));
    expect(res.status).toBe(401);
  });
});

describe('coverage session control API — validation', () => {
  it('returns 400 VALIDATION_ERROR when label is missing on start', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send({ source: 'automated-e2e', buildSha: 'sha', environment: 'test' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for an invalid (non-UUID) sessionId path param on GET', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/sessions/not-a-uuid')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for an invalid (non-UUID) sessionId path param on end', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/sessions/not-a-uuid/end')
      .set('Cookie', adminCookie)
      .send({ version: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for an invalid (non-UUID) sessionId path param on record-dump', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/sessions/not-a-uuid/dumps')
      .set('Cookie', adminCookie)
      .send({
        dumpId: '11111111-1111-1111-1111-111111111111',
        correlationId: '22222222-2222-2222-2222-222222222222',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('coverage session control API — lifecycle', () => {
  it('starts and ends a session end to end', async () => {
    const startRes = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send(baseSessionBody('lifecycle-e2e'));
    expect(startRes.status).toBe(201);
    const session = startRes.body.session;

    const endRes = await request(app)
      .post(`/api/v1/admin/coverage/sessions/${session.id}/end`)
      .set('Cookie', adminCookie)
      .send({ version: session.version });
    expect(endRes.status).toBe(200);
    expect(endRes.body.session.status).toBe('ended');
  });

  it('returns 404 COVERAGE_SESSION_NOT_FOUND when getting an unknown session', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/sessions/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COVERAGE_SESSION_NOT_FOUND');
  });

  it('returns 409 COVERAGE_SESSION_CONFLICT when ending an already-ended session', async () => {
    const startRes = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send(baseSessionBody('lifecycle-double-end'));
    const session = startRes.body.session;

    const firstEnd = await request(app)
      .post(`/api/v1/admin/coverage/sessions/${session.id}/end`)
      .set('Cookie', adminCookie)
      .send({ version: session.version });
    expect(firstEnd.status).toBe(200);

    const secondEnd = await request(app)
      .post(`/api/v1/admin/coverage/sessions/${session.id}/end`)
      .set('Cookie', adminCookie)
      .send({ version: firstEnd.body.session.version });
    expect(secondEnd.status).toBe(409);
    expect(secondEnd.body.error.code).toBe('COVERAGE_SESSION_CONFLICT');
  });
});

describe('coverage session control API — lookup by correlation ID', () => {
  it('finds the active session for its own correlation ID', async () => {
    const startRes = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send(baseSessionBody('by-correlation-active'));
    const session = startRes.body.session;

    const res = await request(app)
      .get(`/api/v1/admin/coverage/sessions/by-correlation/${session.correlationId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe(session.id);
  });

  it('returns 404 COVERAGE_SESSION_NOT_FOUND once the session has ended', async () => {
    const startRes = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send(baseSessionBody('by-correlation-ended'));
    const session = startRes.body.session;

    await request(app)
      .post(`/api/v1/admin/coverage/sessions/${session.id}/end`)
      .set('Cookie', adminCookie)
      .send({ version: session.version });

    const res = await request(app)
      .get(`/api/v1/admin/coverage/sessions/by-correlation/${session.correlationId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COVERAGE_SESSION_NOT_FOUND');
  });

  it('returns 404 COVERAGE_SESSION_NOT_FOUND for an unknown correlation ID', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/sessions/by-correlation/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COVERAGE_SESSION_NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for a non-UUID correlation ID', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/sessions/by-correlation/not-a-uuid')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get(
      '/api/v1/admin/coverage/sessions/by-correlation/00000000-0000-0000-0000-000000000000',
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when a rep (non-admin) calls the API', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/sessions/by-correlation/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });
});

describe('coverage session control API — dump attribution', () => {
  it('records a dump attribution and rejects a duplicate dumpId with 409', async () => {
    const startRes = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send(baseSessionBody('dump-attribution'));
    const session = startRes.body.session;
    const dumpId = '33333333-3333-3333-3333-333333333333';

    const recordRes = await request(app)
      .post(`/api/v1/admin/coverage/sessions/${session.id}/dumps`)
      .set('Cookie', adminCookie)
      .send({ dumpId, correlationId: session.correlationId });
    expect(recordRes.status).toBe(201);
    expect(recordRes.body.sessionDump.dumpId).toBe(dumpId);

    const duplicateRes = await request(app)
      .post(`/api/v1/admin/coverage/sessions/${session.id}/dumps`)
      .set('Cookie', adminCookie)
      .send({ dumpId, correlationId: session.correlationId });
    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.error.code).toBe('DUMP_ALREADY_RECORDED');
  });

  it('returns 409 COVERAGE_SESSION_ENDED when attributing a dump to an already-ended session', async () => {
    const startRes = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send(baseSessionBody('dump-after-end'));
    const session = startRes.body.session;

    await request(app)
      .post(`/api/v1/admin/coverage/sessions/${session.id}/end`)
      .set('Cookie', adminCookie)
      .send({ version: session.version });

    const dumpRes = await request(app)
      .post(`/api/v1/admin/coverage/sessions/${session.id}/dumps`)
      .set('Cookie', adminCookie)
      .send({
        dumpId: '44444444-4444-4444-4444-444444444444',
        correlationId: session.correlationId,
      });
    expect(dumpRes.status).toBe(409);
    expect(dumpRes.body.error.code).toBe('COVERAGE_SESSION_ENDED');
  });

  it('returns 400 COVERAGE_SESSION_NOT_FOUND when attributing a dump to an unknown session', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coverage/sessions/00000000-0000-0000-0000-000000000000/dumps')
      .set('Cookie', adminCookie)
      .send({
        dumpId: '55555555-5555-5555-5555-555555555555',
        correlationId: '66666666-6666-6666-6666-666666666666',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('COVERAGE_SESSION_NOT_FOUND');
  });

  it('returns 400 COVERAGE_SESSION_CORRELATION_MISMATCH when correlationId belongs to a different session', async () => {
    const sessionAStart = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send(baseSessionBody('dump-mismatch-a'));
    const sessionBStart = await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send(baseSessionBody('dump-mismatch-b'));
    const sessionA = sessionAStart.body.session;
    const sessionB = sessionBStart.body.session;

    // Attribute to session A's id but stamp with session B's correlation ID.
    const res = await request(app)
      .post(`/api/v1/admin/coverage/sessions/${sessionA.id}/dumps`)
      .set('Cookie', adminCookie)
      .send({
        dumpId: '77777777-7777-7777-7777-777777777777',
        correlationId: sessionB.correlationId,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('COVERAGE_SESSION_CORRELATION_MISMATCH');
  });
});

describe('coverage session control API — pagination', () => {
  it('returns a paginated envelope for GET /sessions', async () => {
    await request(app)
      .post('/api/v1/admin/coverage/sessions')
      .set('Cookie', adminCookie)
      .send(baseSessionBody('pagination-envelope'));

    const res = await request(app)
      .get('/api/v1/admin/coverage/sessions')
      .query({ page: 1, limit: 1 })
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(1);
  });

  it('returns 400 VALIDATION_ERROR for an out-of-range limit', async () => {
    const res = await request(app)
      .get('/api/v1/admin/coverage/sessions')
      .query({ limit: 99999 })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
