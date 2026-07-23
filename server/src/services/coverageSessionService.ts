/**
 * Coverage/TIA session service. (MINCRM-609..612)
 *
 * A CoverageSession is a logical grouping of coverage dumps attributed to a
 * single automated E2E test run or manual-exploratory-testing session. It
 * does NOT provide physically isolated V8 counters — NodeV8CoverageAgent
 * remains a single process-wide counter set (see coverageAgent/NodeV8CoverageAgent.ts).
 * Attribution instead works by tagging each dump with the session's
 * correlation ID at record time (recordSessionDump), so overlapping
 * sessions on the same server instance can still be told apart in the
 * stored data even though the underlying counters are shared.
 *
 * All writes follow the transaction + audit-log pattern used throughout the
 * codebase (see dealService.ts): pool.connect() -> BEGIN -> setRlsUserId ->
 * work -> writeAuditEntry (same client) -> COMMIT, with ROLLBACK on error.
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import { setRlsUserId } from './rlsContextService.js';
import { writeAuditEntry, SYSTEM_ACTOR } from './auditService.js';
import type { AuditActor } from './auditService.js';
import type {
  CoverageSession,
  CoverageSessionDump,
  StartCoverageSessionRequest,
} from '@minicrm/shared/schemas/coverageSessionSchema.js';
import type {
  PaginatedResponse,
  PaginationParams,
} from '@minicrm/shared/schemas/paginationSchema.js';

/** Thrown when ending a session that does not exist. */
export class CoverageSessionNotFoundError extends Error {
  readonly code = 'COVERAGE_SESSION_NOT_FOUND';
  constructor(sessionId: string) {
    super(`Coverage session ${sessionId} not found`);
    this.name = 'CoverageSessionNotFoundError';
  }
}

/** Thrown when ending an already-ended session, or on a version mismatch. */
export class CoverageSessionConflictError extends Error {
  readonly code = 'COVERAGE_SESSION_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'CoverageSessionConflictError';
  }
}

/** Thrown when attempting to record a dump against a session that has already ended. */
export class CoverageSessionEndedError extends Error {
  readonly code = 'COVERAGE_SESSION_ENDED';
  constructor(sessionId: string) {
    super(`Coverage session ${sessionId} has already ended — cannot attribute a dump to it.`);
    this.name = 'CoverageSessionEndedError';
  }
}

/**
 * Thrown when the correlationId supplied to recordCoverageSessionDump does
 * not match the target session's own correlation_id. Without this check a
 * caller could attribute a dump to sessionId while stamping it with a
 * different session's correlation ID, corrupting any downstream lookup keyed
 * on coverage_session_dumps.correlation_id (e.g.
 * findActiveCoverageSessionByCorrelationId).
 */
export class CoverageSessionCorrelationMismatchError extends Error {
  readonly code = 'COVERAGE_SESSION_CORRELATION_MISMATCH';
  constructor(sessionId: string) {
    super(`correlationId does not match coverage session ${sessionId}'s own correlation ID.`);
    this.name = 'CoverageSessionCorrelationMismatchError';
  }
}

interface CoverageSessionRow {
  id: string;
  label: string;
  source: 'automated-e2e' | 'manual';
  status: 'active' | 'ended';
  correlation_id: string;
  build_sha: string;
  environment: string;
  issue_key: string | null;
  // Nullable — ON DELETE SET NULL when the starting user is later deleted,
  // so the session's own history survives (see migration 157's comment).
  started_by: string | null;
  started_at: Date;
  ended_at: Date | null;
  version: number;
}

function toCoverageSession(row: CoverageSessionRow): CoverageSession {
  return {
    id: row.id,
    label: row.label,
    source: row.source,
    status: row.status,
    correlationId: row.correlation_id,
    buildSha: row.build_sha,
    environment: row.environment,
    issueKey: row.issue_key,
    startedById: row.started_by,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    version: row.version,
  };
}

/**
 * Starts a new coverage session, minting a fresh correlation ID for callers
 * to propagate via the x-coverage-correlation-id header on subsequent requests.
 */
export async function startCoverageSession(
  params: StartCoverageSessionRequest,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<CoverageSession> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    const insertResult = await client.query<CoverageSessionRow>(
      `INSERT INTO coverage_sessions (label, source, build_sha, environment, issue_key, started_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, label, source, status, correlation_id, build_sha, environment, issue_key, started_by, started_at, ended_at, version`,
      [
        params.label,
        params.source,
        params.buildSha,
        params.environment,
        params.issueKey ?? null,
        actor.id,
      ],
    );
    const row = insertResult.rows[0];

    await writeAuditEntry(client, {
      recordType: 'coverage_session',
      recordId: row.id,
      recordName: row.label,
      eventType: 'coverage_session_started',
      changedById: actor.id,
      changedByName: actor.name,
      source: actor.source ?? null,
    });

    await client.query('COMMIT');
    return toCoverageSession(row);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Ends an active coverage session. Optimistic-locked on `version` so two
 * concurrent end-session requests (e.g. a flaky retry racing the original
 * teardown) can't both report success — the second sees a conflict rather
 * than silently double-processing the same session. (MINCRM-612)
 */
export async function endCoverageSession(
  sessionId: string,
  version: number,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<CoverageSession> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    const updateResult = await client.query<CoverageSessionRow>(
      `UPDATE coverage_sessions
       SET status = 'ended', ended_at = now(), version = version + 1
       WHERE id = $1 AND version = $2 AND status = 'active'
       RETURNING id, label, source, status, correlation_id, build_sha, environment, issue_key, started_by, started_at, ended_at, version`,
      [sessionId, version],
    );

    if (updateResult.rowCount === 0) {
      const check = await client.query<{ id: string; status: string; version: number }>(
        'SELECT id, status, version FROM coverage_sessions WHERE id = $1',
        [sessionId],
      );
      if (check.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new CoverageSessionNotFoundError(sessionId);
      }
      await client.query('ROLLBACK');
      const existing = check.rows[0];
      throw new CoverageSessionConflictError(
        existing.status === 'ended'
          ? `Coverage session ${sessionId} has already ended.`
          : `Coverage session ${sessionId} was modified concurrently (expected version ${version}, found ${existing.version}). Reload and retry.`,
      );
    }

    const row = updateResult.rows[0];

    await writeAuditEntry(client, {
      recordType: 'coverage_session',
      recordId: row.id,
      recordName: row.label,
      eventType: 'coverage_session_ended',
      changedById: actor.id,
      changedByName: actor.name,
      source: actor.source ?? null,
    });

    await client.query('COMMIT');
    return toCoverageSession(row);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Fetches a single coverage session by ID, or null if not found. */
export async function findCoverageSession(sessionId: string): Promise<CoverageSession | null> {
  const result = await pool.query<CoverageSessionRow>(
    `SELECT id, label, source, status, correlation_id, build_sha, environment, issue_key, started_by, started_at, ended_at, version
     FROM coverage_sessions WHERE id = $1`,
    [sessionId],
  );
  return result.rows[0] ? toCoverageSession(result.rows[0]) : null;
}

/**
 * Lists currently-active sessions, paginated. Sessions can accumulate
 * unboundedly if never explicitly ended (a crashed E2E run, a browser tab
 * closed mid-recording) — there's no cleanup job — so this endpoint follows
 * the same pagination convention as every other list endpoint rather than
 * returning every active session unbounded.
 */
export async function listActiveCoverageSessions(
  pagination: PaginationParams,
): Promise<PaginatedResponse<CoverageSession>> {
  const { page, limit } = pagination;
  const offset = (page - 1) * limit;

  const [countResult, rowsResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM coverage_sessions WHERE status = 'active'`,
    ),
    pool.query<CoverageSessionRow>(
      `SELECT id, label, source, status, correlation_id, build_sha, environment, issue_key, started_by, started_at, ended_at, version
       FROM coverage_sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
  ]);

  return {
    data: rowsResult.rows.map(toCoverageSession),
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}

/**
 * Finds the active session tagged with the given correlation ID, or null if
 * none is active for it (unknown ID, or its session already ended). Used by
 * the coverage dump endpoint to auto-attribute a dump when the caller sent
 * the x-coverage-correlation-id header, without requiring every caller to
 * separately know and pass a sessionId. (MINCRM-610)
 */
export async function findActiveCoverageSessionByCorrelationId(
  correlationId: string,
): Promise<CoverageSession | null> {
  const result = await pool.query<CoverageSessionRow>(
    `SELECT id, label, source, status, correlation_id, build_sha, environment, issue_key, started_by, started_at, ended_at, version
     FROM coverage_sessions WHERE correlation_id = $1 AND status = 'active'`,
    [correlationId],
  );
  return result.rows[0] ? toCoverageSession(result.rows[0]) : null;
}

/**
 * Records a coverage dump's attribution to a session. Not wrapped in the
 * audit-log pattern — this is high-frequency telemetry (one row per test per
 * session), not a user-facing mutation of session state, mirroring how
 * coverageDumpService's own dump persistence isn't audited either.
 *
 * attempt distinguishes Playwright test retries: a retried test re-runs
 * under the same test_id with attempt incremented, so a flaky test's first
 * (failed) and second (passed) attempts are two distinct rows rather than
 * one overwriting the other. (MINCRM-612)
 */
export async function recordCoverageSessionDump(
  sessionId: string,
  dumpId: string,
  correlationId: string,
  options: { testId?: string; testName?: string; attempt?: number } = {},
): Promise<CoverageSessionDump> {
  // INSERT ... SELECT rather than a plain VALUES INSERT so "the session must
  // be active" AND "correlationId must be this session's own correlation_id"
  // are both enforced atomically by the same statement that performs the
  // insert — no separate check-then-insert TOCTOU window, and no way for a
  // caller to attribute a dump to sessionId while stamping it with a
  // different session's correlation ID (which would corrupt any downstream
  // lookup keyed on coverage_session_dumps.correlation_id, e.g.
  // findActiveCoverageSessionByCorrelationId). A dump can only ever be
  // attributed to a session while it's still active. (MINCRM-612)
  const result = await pool.query<{
    id: string;
    session_id: string;
    dump_id: string;
    correlation_id: string;
    test_id: string | null;
    test_name: string | null;
    attempt: number;
    recorded_at: Date;
  }>(
    `INSERT INTO coverage_session_dumps (session_id, dump_id, correlation_id, test_id, test_name, attempt)
     SELECT $1, $2, $3, $4, $5, $6
     WHERE EXISTS (
       SELECT 1 FROM coverage_sessions
       WHERE id = $1 AND status = 'active' AND correlation_id = $3
     )
     RETURNING id, session_id, dump_id, correlation_id, test_id, test_name, attempt, recorded_at`,
    [
      sessionId,
      dumpId,
      correlationId,
      options.testId ?? null,
      options.testName ?? null,
      options.attempt ?? 1,
    ],
  );

  if (result.rowCount === 0) {
    const sessionCheck = await pool.query<{ status: string; correlation_id: string }>(
      'SELECT status, correlation_id FROM coverage_sessions WHERE id = $1',
      [sessionId],
    );
    if (sessionCheck.rows.length === 0) {
      throw Object.assign(new Error(`Coverage session ${sessionId} not found`), {
        code: '23503', // mirrors the FK-violation code the controller already maps to 400
      });
    }
    const existing = sessionCheck.rows[0];
    if (existing.status !== 'active') {
      throw new CoverageSessionEndedError(sessionId);
    }
    // Session is active and the row still wasn't inserted — the only
    // remaining reason the WHERE EXISTS guard failed is a correlationId
    // that doesn't match this session's own correlation_id.
    throw new CoverageSessionCorrelationMismatchError(sessionId);
  }

  const row = result.rows[0];
  return {
    id: row.id,
    sessionId: row.session_id,
    dumpId: row.dump_id,
    correlationId: row.correlation_id,
    testId: row.test_id,
    testName: row.test_name,
    attempt: row.attempt,
    recordedAt: row.recorded_at.toISOString(),
  };
}

/**
 * Looks up a single dump's session attribution (test_id/test_name), if any.
 * Used by coverageIngestionService (MINCRM-618) to attribute the units
 * produced by ingesting this dump to the specific test that generated it.
 * Returns null for a dump with no coverage_session_dumps row at all — a
 * normal case (e.g. a manually-triggered dump/ingest outside any session),
 * not an error.
 */
export async function findCoverageSessionDumpByDumpId(
  dumpId: string,
): Promise<CoverageSessionDump | null> {
  const result = await pool.query<{
    id: string;
    session_id: string;
    dump_id: string;
    correlation_id: string;
    test_id: string | null;
    test_name: string | null;
    attempt: number;
    recorded_at: Date;
  }>(
    `SELECT id, session_id, dump_id, correlation_id, test_id, test_name, attempt, recorded_at
     FROM coverage_session_dumps WHERE dump_id = $1`,
    [dumpId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    sessionId: row.session_id,
    dumpId: row.dump_id,
    correlationId: row.correlation_id,
    testId: row.test_id,
    testName: row.test_name,
    attempt: row.attempt,
    recordedAt: row.recorded_at.toISOString(),
  };
}
