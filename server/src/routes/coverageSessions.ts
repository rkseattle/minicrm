/**
 * Coverage/TIA session management routes — internal-only tooling, gated
 * entirely by the COVERAGE_SESSION_MANAGEMENT env var at boot, not a product
 * feature_flags row. (MINCRM-609..612, MINCRM-663)
 *
 * MINCRM-663: this router used to also require the coverage_session_management
 * feature_flags row (requireFeatureEnabled) alongside authenticate/
 * requireRole('admin') on every route — see coverage.ts's own docblock for
 * the full rationale (same fix, same shape, applied to this router). Routes
 * are now registered ONLY when COVERAGE_SESSION_MANAGEMENT is 'true' at
 * process boot; an admin with no special env/build context gets a plain 404
 * on every path under this router, not a 403.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  startCoverageSessionHandler,
  listActiveCoverageSessionsHandler,
  getCoverageSessionHandler,
  endCoverageSessionHandler,
  recordCoverageSessionDumpHandler,
} from '../controllers/coverageSessionController.js';

const router = Router();

const requireCoverageSessionAccess = [authenticate, requireRole('admin')] as const;

/** Registers every coverage session route — only called when COVERAGE_SESSION_MANAGEMENT is 'true' at boot. */
function registerCoverageSessionRoutes(): void {
  /**
   * @openapi
   * /api/v1/admin/coverage/sessions:
   *   post:
   *     tags: [Coverage]
   *     operationId: startCoverageSession
   *     summary: Start a new coverage session
   *     description: >
   *       Starts a coverage session and mints a correlation ID for the caller to
   *       propagate via the x-coverage-correlation-id header on subsequent
   *       requests, so coverage dumps produced during the session can be
   *       attributed to it. Admin only.
   *     security:
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [label, source, buildSha, environment]
   *             properties:
   *               label:
   *                 type: string
   *               source:
   *                 type: string
   *                 enum: [automated-e2e, manual]
   *               buildSha:
   *                 type: string
   *               environment:
   *                 type: string
   *               issueKey:
   *                 type: string
   *     responses:
   *       201:
   *         description: Coverage session started
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 session:
   *                   $ref: '#/components/schemas/CoverageSession'
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   */
  router.post('/', ...requireCoverageSessionAccess, asyncHandler(startCoverageSessionHandler));

  /**
   * @openapi
   * /api/v1/admin/coverage/sessions:
   *   get:
   *     tags: [Coverage]
   *     operationId: listActiveCoverageSessions
   *     summary: List currently-active coverage sessions, paginated
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 25
   *     responses:
   *       200:
   *         description: A page of active coverage sessions
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/CoverageSession'
   *                 total:
   *                   type: integer
   *                 page:
   *                   type: integer
   *                 limit:
   *                   type: integer
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   */
  router.get('/', ...requireCoverageSessionAccess, asyncHandler(listActiveCoverageSessionsHandler));

  /**
   * @openapi
   * /api/v1/admin/coverage/sessions/{sessionId}:
   *   get:
   *     tags: [Coverage]
   *     operationId: getCoverageSession
   *     summary: Look up a single coverage session
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: Coverage session found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 session:
   *                   $ref: '#/components/schemas/CoverageSession'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       404:
   *         $ref: '#/components/responses/NotFound'
   */
  router.get(
    '/:sessionId',
    ...requireCoverageSessionAccess,
    asyncHandler(getCoverageSessionHandler),
  );

  /**
   * @openapi
   * /api/v1/admin/coverage/sessions/{sessionId}/end:
   *   post:
   *     tags: [Coverage]
   *     operationId: endCoverageSession
   *     summary: End an active coverage session
   *     description: >
   *       Optimistic-locked on `version` — a stale version indicates a
   *       concurrent end-session request already completed. Admin only.
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [version]
   *             properties:
   *               version:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Coverage session ended
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 session:
   *                   $ref: '#/components/schemas/CoverageSession'
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       404:
   *         $ref: '#/components/responses/NotFound'
   *       409:
   *         description: Session already ended, or version mismatch
   */
  router.post(
    '/:sessionId/end',
    ...requireCoverageSessionAccess,
    asyncHandler(endCoverageSessionHandler),
  );

  /**
   * @openapi
   * /api/v1/admin/coverage/sessions/{sessionId}/dumps:
   *   post:
   *     tags: [Coverage]
   *     operationId: recordCoverageSessionDump
   *     summary: Record a coverage dump's attribution to a session
   *     description: >
   *       Called after POST /api/v1/admin/coverage/dump to attribute the
   *       resulting dumpId to this session. attempt distinguishes Playwright
   *       test retries so a flaky test's attempts are tracked separately
   *       rather than overwriting one another. Admin only.
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [dumpId, correlationId]
   *             properties:
   *               dumpId:
   *                 type: string
   *                 format: uuid
   *               correlationId:
   *                 type: string
   *                 format: uuid
   *                 description: Must equal this session's own correlationId — a mismatch is rejected with 400 COVERAGE_SESSION_CORRELATION_MISMATCH.
   *               testId:
   *                 type: string
   *               testName:
   *                 type: string
   *               attempt:
   *                 type: integer
   *                 default: 1
   *     responses:
   *       201:
   *         description: Dump attribution recorded
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 sessionDump:
   *                   $ref: '#/components/schemas/CoverageSessionDump'
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       409:
   *         description: dumpId is already attributed to a session, or the session has already ended
   */
  router.post(
    '/:sessionId/dumps',
    ...requireCoverageSessionAccess,
    asyncHandler(recordCoverageSessionDumpHandler),
  );
}

if (process.env.COVERAGE_SESSION_MANAGEMENT === 'true') {
  registerCoverageSessionRoutes();
}

export default router;
