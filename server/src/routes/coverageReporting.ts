/**
 * Coverage/TIA reporting query routes — all endpoints require
 * authentication, coverage:admin access, and the coverage_reporting_query
 * feature flag. (MINCRM-629/630/631, MINCRM-637)
 *
 * COVERAGE_DASHBOARD_NO_AUTH (MINCRM-636/637) drops the ENTIRE access chain
 * — authenticate, coverageAccessGate, AND requireFeatureEnabled — for these
 * read-only reporting routes. The standalone coverage-dashboard app
 * (coverage-dashboard/) is a pure internal engineering tool with no
 * customer-facing surface and no auth system of its own — today it
 * piggybacks on the CRM product's own admin login, which means an engineer
 * who wants to check coverage/gap data must first be a CRM admin and log
 * in to the product just to view internal test-infra reporting. That's
 * real, unwanted friction for a local-dev-only tool, not a deliberate
 * security boundary.
 *
 * requireFeatureEnabled is dropped too, not just auth: it's inherently
 * user/role-scoped (per-user force overrides, per-team overrides, role
 * rollout percentages — see featureFlagService.isFlagEnabledForUser) and
 * requires req.user to evaluate at all; with no authenticated user there is
 * no coherent "is this enabled for X" to ask. Bypassing auth while leaving
 * this check in place would just trade one 401 for another (found via a
 * real test failure — requireFeatureEnabled's own docblock: "Must be used
 * after the authenticate middleware so that req.user is set").
 *
 * Scoped to ONLY this route file and coverageSessions.ts (the two routers
 * the coverage-dashboard app actually calls), not coverageAccessGate.ts
 * itself: coveragePipeline.ts/coverageMapping.ts/coverage.ts also share
 * that gate but are never called by this dashboard, so this flag never
 * opens them up — see isDashboardNoAuthEnabled's own docblock
 * (coverageAccessGate.ts) for the shared predicate both opting-in routers
 * use.
 *
 * Gated the same way auth.ts's own E2E rate-limit bypass is (see that
 * file's isE2E): NODE_ENV !== 'production' is the hard safety rail so this
 * can never activate in a real deployment regardless of how
 * COVERAGE_DASHBOARD_NO_AUTH is set (e.g. a copied .env file) — the flag
 * itself is the explicit local opt-in on top of that rail, not a
 * standalone switch.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { coverageAccessGate, isDashboardNoAuthEnabled } from '../middleware/coverageAccessGate.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
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

const requireFeatureEnabledForReporting = requireFeatureEnabled('coverage_reporting_query');

const requireCoverageReportingAccessGate: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (isDashboardNoAuthEnabled()) {
    next();
    return;
  }
  authenticate(req, res, (authErr?: unknown) => {
    if (authErr) {
      next(authErr);
      return;
    }
    coverageAccessGate(req, res, (gateErr?: unknown) => {
      if (gateErr) {
        next(gateErr);
        return;
      }
      requireFeatureEnabledForReporting(req, res, next);
    });
  });
};

const requireCoverageReportingAccess = [requireCoverageReportingAccessGate] as const;

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
router.get('/summary', ...requireCoverageReportingAccess, asyncHandler(getCoverageSummaryHandler));

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

export default router;
