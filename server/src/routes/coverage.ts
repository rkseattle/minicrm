/**
 * Coverage/TIA control API routes — internal-only tooling, gated entirely
 * by the COVERAGE_INSTRUMENTATION env var at boot, not a product feature_flags
 * row. (MINCRM-606, MINCRM-663, MINCRM-637)
 *
 * MINCRM-663: this router used to also require the coverage_instrumentation
 * feature_flags row (requireFeatureEnabled) alongside authenticate/
 * coverageAccessGate on every route. That flag rendered in the CRM's own
 * admin Settings page (FeatureFlagsSettings.tsx has no category/system_flag
 * filtering) — internal CI/dev test infrastructure had no business being
 * discoverable or toggleable through the product's own customer-facing admin
 * UI. The routes below are now registered ONLY when COVERAGE_INSTRUMENTATION
 * is already 'true' at process boot — the exact same env var that already
 * gates whether the underlying V8 agent starts (coverageConfig.ts). An admin
 * with full CRM access and no special env/build context now gets a plain 404
 * on every path under this router, not a 403 — there is nothing here to
 * discover via the product UI at all, not merely a gate that reports "off."
 * authenticate/coverageAccessGate remain on every route: an internal-only
 * env var is not a substitute for auth, only for the product-facing flag.
 *
 * MINCRM-637: coverageAccessGate (server/src/middleware/coverageAccessGate.ts)
 * replaces a bare requireRole('admin') — capability-based when
 * COVERAGE_CAPABILITY_GATING=true, otherwise identical to today's role check.
 * Note this router's own registration gate (above) means the capability swap
 * has no observable effect unless COVERAGE_INSTRUMENTATION is also set —
 * this router registers zero routes, and returns a plain 404, whenever that
 * env var is unset, regardless of gating mode.
 */

import { Router } from 'express';
import { registerRoutesIfEnabled } from '../coverageAgent/coverageBootGate.js';
import { authenticate } from '../middleware/auth.js';
import { coverageAccessGate } from '../middleware/coverageAccessGate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  resetCoverageHandler,
  snapshotCoverageHandler,
  dumpCoverageHandler,
  getCoverageDumpHandler,
} from '../controllers/coverageController.js';
import { getCoverageHealthHandler } from '../controllers/coverageHealthController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/admin/coverage/health:
 *   get:
 *     tags: [Coverage]
 *     operationId: getCoverageHealth
 *     summary: Operational health of the Coverage/TIA framework's own services
 *     description: >
 *       Reports whether the backend V8 agent is running, whether the coverage
 *       database is reachable, and which coverage routers registered their
 *       routes at boot. Admin only — this reveals registration state and DB
 *       reachability, operational detail, not a public liveness probe (unlike
 *       /api/health). Registered unconditionally, unlike this router's other
 *       routes, because it is diagnostic: an operator asking why coverage is
 *       not working needs an answer in precisely the deployment where every
 *       gate is off, and a health check that 404s whenever the subsystem is
 *       disabled cannot distinguish "disabled" from "misdeployed". No
 *       feature-flag gate either — MINCRM-663/685 removed every coverage
 *       feature_flags row in favour of boot-time env vars.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: All checked subsystems healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CoverageHealthReport'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       503:
 *         description: Coverage database unreachable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CoverageHealthReport'
 */
router.get('/health', authenticate, coverageAccessGate, asyncHandler(getCoverageHealthHandler));

/** Registers every coverage control route — only called when COVERAGE_INSTRUMENTATION is 'true' at boot. */
function registerCoverageControlRoutes(): void {
  /**
   * @openapi
   * /api/v1/admin/coverage/reset:
   *   post:
   *     tags: [Coverage]
   *     operationId: resetCoverage
   *     summary: Reset the backend coverage agent's counters
   *     description: >
   *       Clears accumulated coverage counters on the backend V8 coverage agent.
   *       Requires COVERAGE_INSTRUMENTATION to have been enabled at server boot. Admin only.
   *     security:
   *       - cookieAuth: []
   *     responses:
   *       204:
   *         description: Coverage counters reset
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       409:
   *         description: Coverage instrumentation is not running on this server
   */
  router.post('/reset', authenticate, coverageAccessGate, asyncHandler(resetCoverageHandler));

  /**
   * @openapi
   * /api/v1/admin/coverage/snapshot:
   *   post:
   *     tags: [Coverage]
   *     operationId: snapshotCoverage
   *     summary: Read current backend coverage counters
   *     description: >
   *       Reads current backend counters without persisting an artifact to disk.
   *       NOTE: V8's takePreciseCoverage() resets counters as a side effect of
   *       reading them — this is not a non-destructive read. Admin only.
   *     security:
   *       - cookieAuth: []
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               label:
   *                 type: string
   *     responses:
   *       200:
   *         description: Coverage dump metadata
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 dump:
   *                   $ref: '#/components/schemas/CoverageDump'
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       409:
   *         description: Coverage instrumentation is not running on this server
   */
  router.post('/snapshot', authenticate, coverageAccessGate, asyncHandler(snapshotCoverageHandler));

  /**
   * @openapi
   * /api/v1/admin/coverage/dump:
   *   post:
   *     tags: [Coverage]
   *     operationId: dumpCoverage
   *     summary: Persist a tagged coverage dump
   *     description: >
   *       With no `source`/`payload`, persists a dump from the backend V8 coverage
   *       agent. With `{ source: 'browser', payload, label }`, ingests an
   *       already-collected frontend Istanbul coverage payload without touching
   *       the agent. Admin only.
   *     security:
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [label]
   *             properties:
   *               label:
   *                 type: string
   *               source:
   *                 type: string
   *                 enum: [node, browser]
   *               payload:
   *                 type: object
   *                 description: Required when source is "browser" — the raw window.__coverage__ payload
   *     responses:
   *       201:
   *         description: Coverage dump persisted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 dump:
   *                   $ref: '#/components/schemas/CoverageDump'
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       409:
   *         description: Coverage instrumentation is not running on this server
   */
  router.post('/dump', authenticate, coverageAccessGate, asyncHandler(dumpCoverageHandler));

  /**
   * @openapi
   * /api/v1/admin/coverage/dumps/{dumpId}:
   *   get:
   *     tags: [Coverage]
   *     operationId: getCoverageDump
   *     summary: Look up metadata for a previously produced coverage dump
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: dumpId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: Coverage dump found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 dump:
   *                   $ref: '#/components/schemas/CoverageDump'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       404:
   *         $ref: '#/components/responses/NotFound'
   */
  router.get(
    '/dumps/:dumpId',
    authenticate,
    coverageAccessGate,
    asyncHandler(getCoverageDumpHandler),
  );
}

registerRoutesIfEnabled('COVERAGE_INSTRUMENTATION', registerCoverageControlRoutes);

export default router;
