/**
 * Integration tests for coverageSessionService.
 *
 * Runs against a real PostgreSQL test database.
 * A single test user is created in beforeAll and reused as actor/started-by.
 * coverage_sessions/coverage_session_dumps are truncated before each test.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import {
  startCoverageSession,
  endCoverageSession,
  findCoverageSession,
  listActiveCoverageSessions,
  findActiveCoverageSessionByCorrelationId,
  recordCoverageSessionDump,
  CoverageSessionNotFoundError,
  CoverageSessionConflictError,
  CoverageSessionEndedError,
  CoverageSessionCorrelationMismatchError,
} from '../services/coverageSessionService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

const FILE_PREFIX = 'coverage-session-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Coverage Session Owner',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

const BASE_SESSION_PARAMS = {
  label: 'deals functional suite',
  source: 'automated-e2e' as const,
  buildSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
  environment: 'ci',
};

let ownerId: string;
let actor: { id: string; name: string };

beforeAll(async () => {
  await pool.query(
    'DELETE FROM coverage_session_dumps WHERE session_id IN (SELECT id FROM coverage_sessions WHERE started_by IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM coverage_sessions WHERE started_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;
  actor = { id: ownerId, name: owner.name };
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM coverage_session_dumps WHERE session_id IN (SELECT id FROM coverage_sessions WHERE started_by = $1)',
    [ownerId],
  );
  await pool.query('DELETE FROM coverage_sessions WHERE started_by = $1', [ownerId]);
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM coverage_session_dumps WHERE session_id IN (SELECT id FROM coverage_sessions WHERE started_by IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM coverage_sessions WHERE started_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── startCoverageSession ────────────────────────────────────────────────────

describe('startCoverageSession', () => {
  it('creates an active session with a fresh correlation ID', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);

    expect(session.status).toBe('active');
    expect(session.label).toBe(BASE_SESSION_PARAMS.label);
    expect(session.source).toBe('automated-e2e');
    expect(session.startedById).toBe(ownerId);
    expect(session.endedAt).toBeNull();
    expect(session.version).toBe(1);
    expect(session.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('mints a distinct correlation ID per session', async () => {
    const first = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    const second = await startCoverageSession(BASE_SESSION_PARAMS, actor);

    expect(first.correlationId).not.toBe(second.correlationId);
    expect(first.id).not.toBe(second.id);
  });

  it('stores an optional issueKey when provided', async () => {
    const session = await startCoverageSession(
      { ...BASE_SESSION_PARAMS, issueKey: 'MINCRM-609' },
      actor,
    );
    expect(session.issueKey).toBe('MINCRM-609');
  });

  it('defaults issueKey to null when not provided', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    expect(session.issueKey).toBeNull();
  });

  it('writes an audit entry for session start', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);

    const auditResult = await pool.query(
      `SELECT event_type, record_id, changed_by_id FROM audit_log
       WHERE record_type = 'coverage_session' AND record_id = $1`,
      [session.id],
    );
    expect(auditResult.rows).toHaveLength(1);
    expect(auditResult.rows[0].event_type).toBe('coverage_session_started');
    expect(auditResult.rows[0].changed_by_id).toBe(ownerId);
  });
});

// ── endCoverageSession ───────────────────────────────────────────────────────

describe('endCoverageSession', () => {
  it('ends an active session and stamps endedAt', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    const ended = await endCoverageSession(session.id, session.version, actor);

    expect(ended.status).toBe('ended');
    expect(ended.endedAt).not.toBeNull();
    expect(ended.version).toBe(session.version + 1);
  });

  it('writes an audit entry for session end', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    await endCoverageSession(session.id, session.version, actor);

    const auditResult = await pool.query(
      `SELECT event_type FROM audit_log
       WHERE record_type = 'coverage_session' AND record_id = $1 AND event_type = 'coverage_session_ended'`,
      [session.id],
    );
    expect(auditResult.rows).toHaveLength(1);
  });

  it('throws CoverageSessionNotFoundError for an unknown session', async () => {
    await expect(
      endCoverageSession('00000000-0000-0000-0000-000000000000', 1, actor),
    ).rejects.toBeInstanceOf(CoverageSessionNotFoundError);
  });

  it('throws CoverageSessionConflictError when ending an already-ended session', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    const ended = await endCoverageSession(session.id, session.version, actor);

    await expect(endCoverageSession(session.id, ended.version, actor)).rejects.toBeInstanceOf(
      CoverageSessionConflictError,
    );
  });

  it('throws CoverageSessionConflictError on a stale version (concurrent end)', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);

    // Simulate two concurrent end-session requests racing on the same stale version.
    const results = await Promise.allSettled([
      endCoverageSession(session.id, session.version, actor),
      endCoverageSession(session.id, session.version, actor),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      CoverageSessionConflictError,
    );
  });

  it('does not double-count: a rejected concurrent end leaves the session ended exactly once', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);

    await Promise.allSettled([
      endCoverageSession(session.id, session.version, actor),
      endCoverageSession(session.id, session.version, actor),
    ]);

    const found = await findCoverageSession(session.id);
    expect(found!.status).toBe('ended');

    const auditResult = await pool.query(
      `SELECT id FROM audit_log
       WHERE record_type = 'coverage_session' AND record_id = $1 AND event_type = 'coverage_session_ended'`,
      [session.id],
    );
    expect(auditResult.rows).toHaveLength(1);
  });
});

// ── findCoverageSession / listActiveCoverageSessions ────────────────────────

describe('findCoverageSession', () => {
  it('returns null for a non-existent session', async () => {
    const found = await findCoverageSession('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});

describe('listActiveCoverageSessions', () => {
  it('lists only active sessions, excluding ended ones', async () => {
    const active = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    const toEnd = await startCoverageSession(
      { ...BASE_SESSION_PARAMS, label: 'ended session' },
      actor,
    );
    await endCoverageSession(toEnd.id, toEnd.version, actor);

    const result = await listActiveCoverageSessions({ page: 1, limit: 25 });
    const ids = result.data.map((s) => s.id);

    expect(ids).toContain(active.id);
    expect(ids).not.toContain(toEnd.id);
  });

  it('paginates results and reports the correct total', async () => {
    await startCoverageSession({ ...BASE_SESSION_PARAMS, label: 'page-test 1' }, actor);
    await startCoverageSession({ ...BASE_SESSION_PARAMS, label: 'page-test 2' }, actor);
    await startCoverageSession({ ...BASE_SESSION_PARAMS, label: 'page-test 3' }, actor);

    const firstPage = await listActiveCoverageSessions({ page: 1, limit: 2 });
    expect(firstPage.data).toHaveLength(2);
    expect(firstPage.total).toBeGreaterThanOrEqual(3);
    expect(firstPage.page).toBe(1);
    expect(firstPage.limit).toBe(2);

    const secondPage = await listActiveCoverageSessions({ page: 2, limit: 2 });
    expect(secondPage.data.length).toBeGreaterThanOrEqual(1);
    // No overlap between pages.
    const firstIds = new Set(firstPage.data.map((s) => s.id));
    for (const session of secondPage.data) {
      expect(firstIds.has(session.id)).toBe(false);
    }
  });
});

describe('findActiveCoverageSessionByCorrelationId', () => {
  it('finds an active session by its correlation ID', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);

    const found = await findActiveCoverageSessionByCorrelationId(session.correlationId);

    expect(found?.id).toBe(session.id);
  });

  it('returns null once the session has ended', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    await endCoverageSession(session.id, session.version, actor);

    const found = await findActiveCoverageSessionByCorrelationId(session.correlationId);

    expect(found).toBeNull();
  });

  it('returns null for an unknown correlation ID', async () => {
    const found = await findActiveCoverageSessionByCorrelationId(randomUUID());
    expect(found).toBeNull();
  });
});

// ── recordCoverageSessionDump ────────────────────────────────────────────────

describe('recordCoverageSessionDump', () => {
  it('records a dump attribution with defaults', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    const dumpId = randomUUID();

    const sessionDump = await recordCoverageSessionDump(session.id, dumpId, session.correlationId);

    expect(sessionDump.sessionId).toBe(session.id);
    expect(sessionDump.dumpId).toBe(dumpId);
    expect(sessionDump.correlationId).toBe(session.correlationId);
    expect(sessionDump.attempt).toBe(1);
    expect(sessionDump.testId).toBeNull();
  });

  it('records testId/testName/attempt for retry attribution', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    const firstAttemptDump = randomUUID();
    const retryDump = randomUUID();

    const first = await recordCoverageSessionDump(
      session.id,
      firstAttemptDump,
      session.correlationId,
      {
        testId: 'deals.spec.ts:42',
        testName: 'creates and deletes a deal',
        attempt: 1,
      },
    );
    const retry = await recordCoverageSessionDump(session.id, retryDump, session.correlationId, {
      testId: 'deals.spec.ts:42',
      testName: 'creates and deletes a deal',
      attempt: 2,
    });

    // Same test_id, two distinct dump rows — a retry does not overwrite the
    // first attempt's attribution (MINCRM-612).
    expect(first.dumpId).not.toBe(retry.dumpId);
    expect(first.attempt).toBe(1);
    expect(retry.attempt).toBe(2);

    const rows = await pool.query(
      'SELECT dump_id, attempt FROM coverage_session_dumps WHERE session_id = $1 ORDER BY attempt',
      [session.id],
    );
    expect(rows.rows).toHaveLength(2);
  });

  it('rejects a duplicate dumpId (unique constraint)', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    const dumpId = randomUUID();

    await recordCoverageSessionDump(session.id, dumpId, session.correlationId);

    await expect(
      recordCoverageSessionDump(session.id, dumpId, session.correlationId),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects an unknown sessionId (FK violation)', async () => {
    await expect(
      recordCoverageSessionDump('00000000-0000-0000-0000-000000000000', randomUUID(), randomUUID()),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects a dump recorded against an already-ended session', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    await endCoverageSession(session.id, session.version, actor);

    await expect(
      recordCoverageSessionDump(session.id, randomUUID(), session.correlationId),
    ).rejects.toBeInstanceOf(CoverageSessionEndedError);
  });

  it('does not insert a row when rejecting a dump for an ended session', async () => {
    const session = await startCoverageSession(BASE_SESSION_PARAMS, actor);
    await endCoverageSession(session.id, session.version, actor);
    const dumpId = randomUUID();

    await expect(
      recordCoverageSessionDump(session.id, dumpId, session.correlationId),
    ).rejects.toBeInstanceOf(CoverageSessionEndedError);

    const rows = await pool.query('SELECT id FROM coverage_session_dumps WHERE dump_id = $1', [
      dumpId,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('rejects a dump whose correlationId belongs to a different session', async () => {
    const sessionA = await startCoverageSession(
      { ...BASE_SESSION_PARAMS, label: 'mismatch A' },
      actor,
    );
    const sessionB = await startCoverageSession(
      { ...BASE_SESSION_PARAMS, label: 'mismatch B' },
      actor,
    );

    // Attribute to sessionA's id, but stamp with sessionB's correlation ID.
    await expect(
      recordCoverageSessionDump(sessionA.id, randomUUID(), sessionB.correlationId),
    ).rejects.toBeInstanceOf(CoverageSessionCorrelationMismatchError);
  });

  it('does not insert a row when rejecting a correlationId mismatch', async () => {
    const sessionA = await startCoverageSession(
      { ...BASE_SESSION_PARAMS, label: 'mismatch A no-op' },
      actor,
    );
    const sessionB = await startCoverageSession(
      { ...BASE_SESSION_PARAMS, label: 'mismatch B no-op' },
      actor,
    );
    const dumpId = randomUUID();

    await expect(
      recordCoverageSessionDump(sessionA.id, dumpId, sessionB.correlationId),
    ).rejects.toBeInstanceOf(CoverageSessionCorrelationMismatchError);

    const rows = await pool.query('SELECT id FROM coverage_session_dumps WHERE dump_id = $1', [
      dumpId,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('allows concurrent sessions to record dumps without cross-contamination', async () => {
    const sessionA = await startCoverageSession(
      { ...BASE_SESSION_PARAMS, label: 'session A' },
      actor,
    );
    const sessionB = await startCoverageSession(
      { ...BASE_SESSION_PARAMS, label: 'session B' },
      actor,
    );

    const dumpA = randomUUID();
    const dumpB = randomUUID();

    await Promise.all([
      recordCoverageSessionDump(sessionA.id, dumpA, sessionA.correlationId),
      recordCoverageSessionDump(sessionB.id, dumpB, sessionB.correlationId),
    ]);

    const rowsA = await pool.query(
      'SELECT dump_id FROM coverage_session_dumps WHERE session_id = $1',
      [sessionA.id],
    );
    const rowsB = await pool.query(
      'SELECT dump_id FROM coverage_session_dumps WHERE session_id = $1',
      [sessionB.id],
    );

    expect(rowsA.rows.map((r) => r.dump_id)).toEqual([dumpA]);
    expect(rowsB.rows.map((r) => r.dump_id)).toEqual([dumpB]);
  });
});
