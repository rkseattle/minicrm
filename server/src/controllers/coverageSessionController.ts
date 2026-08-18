/**
 * Coverage/TIA session controller — request/response shaping only. All
 * business logic and DB access goes through coverageSessionService.
 *
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  startCoverageSessionRequestSchema,
  endCoverageSessionRequestSchema,
  recordCoverageSessionDumpRequestSchema,
} from '@minicrm/shared/schemas/coverageSessionSchema.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import {
  startCoverageSession,
  endCoverageSession,
  findCoverageSession,
  findActiveCoverageSessionByCorrelationId,
  listActiveCoverageSessions,
  recordCoverageSessionDump,
  CoverageSessionNotFoundError,
  CoverageSessionConflictError,
  CoverageSessionEndedError,
  CoverageSessionCorrelationMismatchError,
} from '../services/coverageSessionService.js';

const sessionIdParamSchema = z.string().uuid();
const correlationIdParamSchema = z.string().uuid();

/**
 * Nil UUID, matching the repo's own SYSTEM_ACTOR convention
 * (accountService.ts et al.) — used only when req.user is absent, which
 * happens exactly once: COVERAGE_DASHBOARD_NO_AUTH=true bypasses
 * authenticate for this router (routes/coverageSessions.ts), so the
 * dashboard's Sessions tab can start/end sessions with no logged-in user
 * at all. Safe here specifically because coverage_sessions.started_by is
 * a plain uuid column with no cross-database foreign key into users (see
 * this file's own header docblock reference and
 * qa/migrations/001_coverage_baseline.js) — there is no row this sentinel
 * needs to actually exist.
 */
const NO_AUTH_DASHBOARD_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

function actorFromRequest(req: Request): { id: string } {
  // Only id is recorded (coverage_sessions.started_by) — coverage sessions
  // are unaudited system telemetry in their own database, not a
  // product-DB audit_log entry, so no changedByName is needed here (see
  // coverageSessionService.ts's module docblock).
  return { id: req.user?.id ?? NO_AUTH_DASHBOARD_ACTOR_ID };
}

/**
 * Validates the :sessionId path param as a UUID, writing a 400 response and
 * returning undefined if invalid. A non-UUID value passed straight to a
 * `uuid`-typed DB column would otherwise raise an unmapped Postgres 22P02
 * error (invalid input syntax), surfacing as an opaque 500.
 */
function parseSessionIdParam(req: Request, res: Response): string | undefined {
  const parsed = sessionIdParamSchema.safeParse(req.params['sessionId']);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid session ID' } });
    return undefined;
  }
  return parsed.data;
}

/**
 * POST /api/v1/admin/coverage/sessions
 * Starts a new coverage session. Admin only.
 */
export async function startCoverageSessionHandler(req: Request, res: Response): Promise<void> {
  const parsed = startCoverageSessionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const session = await startCoverageSession(parsed.data, actorFromRequest(req));
  res.status(201).json({ session });
}

/**
 * GET /api/v1/admin/coverage/sessions
 * Lists currently-active coverage sessions, paginated. Admin only.
 */
export async function listActiveCoverageSessionsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const paginationParsed = paginationParamsSchema.safeParse({
    page: req.query['page'],
    limit: req.query['limit'],
  });
  if (!paginationParsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: paginationParsed.error.errors[0].message },
    });
    return;
  }

  const result = await listActiveCoverageSessions(paginationParsed.data);
  res.status(200).json(result);
}

/**
 * GET /api/v1/admin/coverage/sessions/by-correlation/:correlationId
 * Looks up the active session tagged with a correlation ID, or 404 if none
 * is active for it (unknown ID, or its session already ended). Admin only.
 *
 * Lets a caller that only holds a correlation ID (the CRM client — see
 * coverageCorrelation.ts's own docblock — never learns the session's actual
 * id/version, only its correlation ID relayed via URL/localStorage)
 * reconcile against the session's real, current server-side state: to end
 * it (needs id + version for the optimistic-locked /end endpoint) or to
 * detect it was already ended from elsewhere (the dashboard's own
 * check-out) and stop attaching a dead correlation ID to every request.
 */
export async function getCoverageSessionByCorrelationIdHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = correlationIdParamSchema.safeParse(req.params['correlationId']);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid correlation ID' },
    });
    return;
  }

  const session = await findActiveCoverageSessionByCorrelationId(parsed.data);

  if (!session) {
    res.status(404).json({
      error: { code: 'COVERAGE_SESSION_NOT_FOUND', message: 'Coverage session not found' },
    });
    return;
  }

  res.status(200).json({ session });
}

/**
 * GET /api/v1/admin/coverage/sessions/:sessionId
 * Looks up a single coverage session. Admin only.
 */
export async function getCoverageSessionHandler(req: Request, res: Response): Promise<void> {
  const sessionId = parseSessionIdParam(req, res);
  if (!sessionId) return;
  const session = await findCoverageSession(sessionId);

  if (!session) {
    res.status(404).json({
      error: { code: 'COVERAGE_SESSION_NOT_FOUND', message: 'Coverage session not found' },
    });
    return;
  }

  res.status(200).json({ session });
}

/**
 * POST /api/v1/admin/coverage/sessions/:sessionId/end
 * Ends an active coverage session. Admin only.
 */
export async function endCoverageSessionHandler(req: Request, res: Response): Promise<void> {
  const sessionId = parseSessionIdParam(req, res);
  if (!sessionId) return;
  const parsed = endCoverageSessionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  try {
    const session = await endCoverageSession(sessionId, parsed.data.version);
    res.status(200).json({ session });
  } catch (err) {
    if (err instanceof CoverageSessionNotFoundError) {
      res.status(404).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof CoverageSessionConflictError) {
      res.status(409).json({ error: { code: err.code, message: err.message } });
      return;
    }
    throw err;
  }
}

/**
 * POST /api/v1/admin/coverage/sessions/:sessionId/dumps
 * Records a coverage dump's attribution to a session. Admin only.
 */
export async function recordCoverageSessionDumpHandler(req: Request, res: Response): Promise<void> {
  const sessionId = parseSessionIdParam(req, res);
  if (!sessionId) return;
  const parsed = recordCoverageSessionDumpRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const { dumpId, correlationId, testId, testName, testFile, attempt } = parsed.data;
  try {
    const sessionDump = await recordCoverageSessionDump(sessionId, dumpId, correlationId, {
      testId,
      testName,
      testFile,
      attempt,
    });
    res.status(201).json({ sessionDump });
  } catch (err: unknown) {
    if (err instanceof CoverageSessionEndedError) {
      res.status(409).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof CoverageSessionCorrelationMismatchError) {
      res.status(400).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const code =
      err instanceof Error && 'code' in err ? (err as { code?: string }).code : undefined;
    if (code === '23503') {
      res.status(400).json({
        error: { code: 'COVERAGE_SESSION_NOT_FOUND', message: 'Coverage session not found' },
      });
      return;
    }
    if (code === '23505') {
      res.status(409).json({
        error: {
          code: 'DUMP_ALREADY_RECORDED',
          message: `Dump ${dumpId} is already attributed to a session`,
        },
      });
      return;
    }
    throw err;
  }
}
