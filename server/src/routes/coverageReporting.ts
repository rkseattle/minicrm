/**
 * Coverage/TIA reporting query routes — internal-only tooling, gated entirely
 * by the COVERAGE_REPORTING_QUERY env var at boot, not a product feature_flags
 * row. (MINCRM-629/630/631, MINCRM-637, MINCRM-685)
 *
 * MINCRM-685: this router used to also require the coverage_reporting_query
 * feature_flags row, via buildCoverageAccessGate's flag step — see
 * routes/coverage.ts's own docblock for the full rationale (same fix, same
 * shape, applied here by the story that finished what MINCRM-663 started).
 * The routes below are now registered ONLY when COVERAGE_REPORTING_QUERY is
 * 'true' at process boot; an admin with no special env context gets a plain
 * 404, not a 403 — there is nothing here to discover through the product UI
 * at all.
 *
 * COVERAGE_DASHBOARD_NO_AUTH (MINCRM-636/637) drops authenticate and
 * coverageAccessGate for these read-only reporting routes. The standalone
 * coverage-dashboard app (coverage-dashboard/) is a pure internal engineering
 * tool with no customer-facing surface and no auth system of its own — today
 * it piggybacks on the CRM product's own admin login, which means an engineer
 * who wants to check coverage/gap data must first be a CRM admin and log
 * in to the product just to view internal test-infra reporting. That's
 * real, unwanted friction for a local-dev-only tool, not a deliberate
 * security boundary.
 *
 * On that no-auth path the boot-time env var is now the SOLE gate, and that is
 * deliberate. MINCRM-694 had narrowed the flag check to
 * requireFeatureEnabledOrgWide rather than dropping it, because the flag's
 * org-wide `enabled` column was the last thing standing between an
 * unauthenticated request and the data (an earlier revision dropped it
 * entirely, so the flag read as enabled no matter what was stored — silently).
 * COVERAGE_REPORTING_QUERY replaces that guarantee with a stronger one: an
 * unset var means the routes were never registered, so nothing reaches any
 * middleware at all, where the flag was a mutable row an admin could flip from
 * the product UI. isDashboardNoAuthEnabled additionally requires
 * NODE_ENV !== 'production', so this combination cannot exist in a real
 * deployment. requireFeatureEnabledOrgWide itself is untouched and still
 * covered by its own unit tests; see coverageRouteGating.test.ts for the
 * replacement guard on this exact path.
 *
 * Opted into per-router rather than baked into coverageAccessGate.ts: this
 * file, coverageSessions.ts, and coverageMapping.ts (whose tests-for-unit /
 * units-for-test endpoints back the dashboard's Traceability tab) each opt
 * in explicitly. coveragePipeline.ts and coverage.ts share the same gate but
 * do NOT opt in, so this never opens them up — see
 * isDashboardNoAuthEnabled's own docblock (coverageAccessGate.ts) for the
 * shared predicate the opting-in routers use.
 *
 * Gated the same way auth.ts's own E2E rate-limit bypass is (see that
 * file's isE2E): NODE_ENV !== 'production' is the hard safety rail so this
 * can never activate in a real deployment regardless of how
 * COVERAGE_DASHBOARD_NO_AUTH is set (e.g. a copied .env file) — the env var
 * itself is the explicit local opt-in on top of that rail, not a
 * standalone switch.
 */

import { Router } from 'express';
import { registerRoutesIfEnabled } from './coverageBootGate.js';
import { buildCoverageAccessGate } from '../middleware/coverageAccessGate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getCoverageSummaryHandler,
  getCoverageTrendHandler,
  getGapsHandler,
  getIssueCoverageHandler,
  listIssueKeysHandler,
  getTiaValueMetricsHandler,
} from '../controllers/coverageReportingController.js';

const router = Router();

// No feature-flag argument: see buildCoverageAccessGate's docblock. This
// router is gated wholesale by COVERAGE_REPORTING_QUERY at boot.
const requireCoverageReportingAccess = [buildCoverageAccessGate()] as const;

/** Registers every coverage reporting route — only called when COVERAGE_REPORTING_QUERY is 'true' at boot. */
function registerCoverageReportingRoutes(): void {
  /**
   * @openapi
   * /api/v1/admin/coverage/reporting/summary:
   *   get:
   *     tags: [Coverage]
   *     operationId: getCoverageSummary
   *     summary: Overall + per-tier coverage percentage for a single build
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - name: commitSha
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Coverage summary for this build
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       404:
   *         description: No coverage has ever been ingested for this commit
   */
  router.get(
    '/summary',
    ...requireCoverageReportingAccess,
    asyncHandler(getCoverageSummaryHandler),
  );

  /**
   * @openapi
   * /api/v1/admin/coverage/reporting/trend:
   *   get:
   *     tags: [Coverage]
   *     operationId: getCoverageTrend
   *     summary: Coverage summaries for the most recent builds, most recent first
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - name: limit
   *         in: query
   *         required: false
   *         description: Max builds to return (default 30, max 500)
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Coverage summaries, most recent build first
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   */
  router.get('/trend', ...requireCoverageReportingAccess, asyncHandler(getCoverageTrendHandler));

  /**
   * @openapi
   * /api/v1/admin/coverage/reporting/gaps:
   *   get:
   *     tags: [Coverage]
   *     operationId: getCoverageGaps
   *     summary: Dead zones, never-taken branches, and changed-but-untested units
   *     description: >
   *       changedUntestedUnits is null unless baseSha is supplied — computing
   *       it requires diffing baseSha..commitSha, meaningfully more expensive
   *       than the dead-zone/never-taken-branch lists.
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - name: commitSha
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *       - name: baseSha
   *         in: query
   *         required: false
   *         schema:
   *           type: string
   *       - name: limit
   *         in: query
   *         required: false
   *         description: Max units per list (default 1000, max 5000)
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Gap analysis for this build/range
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   */
  router.get('/gaps', ...requireCoverageReportingAccess, asyncHandler(getGapsHandler));

  /**
   * @openapi
   * /api/v1/admin/coverage/reporting/issues/{issueKey}/coverage:
   *   get:
   *     tags: [Coverage]
   *     operationId: getIssueCoverage
   *     summary: Coverage rollup for a single MiniCRM issue key, scoped to one build
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - name: issueKey
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *       - name: commitSha
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Coverage rollup for this issue key at this build
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   */
  router.get(
    '/issues/:issueKey/coverage',
    ...requireCoverageReportingAccess,
    asyncHandler(getIssueCoverageHandler),
  );

  /**
   * @openapi
   * /api/v1/admin/coverage/reporting/issue-keys:
   *   get:
   *     tags: [Coverage]
   *     operationId: listIssueKeys
   *     summary: List distinct issue keys with a recorded coverage session for a given build (MINCRM-636/637)
   *     description: >
   *       Backs the coverage-dashboard app's issue-key picker. Unlike unit-key/
   *       test-ID search, this needs no search term — the set of issue keys
   *       touched by any one build is small (bounded by manual-testing
   *       sessions checked in against it), so a plain dropdown of all of them
   *       is the right UI for this field.
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - name: commitSha
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Every distinct issue key with a coverage session recorded for this build
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 issueKeys:
   *                   type: array
   *                   items:
   *                     type: string
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   */
  router.get('/issue-keys', ...requireCoverageReportingAccess, asyncHandler(listIssueKeysHandler));

  /**
   * @openapi
   * /api/v1/admin/coverage/reporting/tia-metrics:
   *   get:
   *     tags: [Coverage]
   *     operationId: getTiaValueMetrics
   *     summary: TIA selection value metrics over a commit range
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - name: fromSha
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *       - name: toSha
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: TIA value metrics over this build range
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   */
  router.get(
    '/tia-metrics',
    ...requireCoverageReportingAccess,
    asyncHandler(getTiaValueMetricsHandler),
  );
}

registerRoutesIfEnabled('COVERAGE_REPORTING_QUERY', registerCoverageReportingRoutes);

export default router;
