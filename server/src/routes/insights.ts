/**
 * Insights routes — AI-generated cross-deal analysis endpoints.
 * All endpoints require authentication and the ai_win_loss_insights feature flag.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getWinLossInsightsHandler,
  exportWinLossInsightsCsvHandler,
  exportWinLossInsightsPdfHandler,
} from '../controllers/winLossInsightController.js';
import { listChurnExpansionSignalsHandler } from '../controllers/churnExpansionController.js';
import {
  getMyCoachingInsightsHandler,
  getRepCoachingInsightsHandler,
  getCoachingTeamOverviewHandler,
} from '../controllers/repCoachingController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/insights/win-loss:
 *   get:
 *     tags: [Insights]
 *     operationId: getWinLossInsights
 *     summary: Get cached AI win/loss pattern insights
 *     description: >
 *       Returns the results of the most recent nightly win/loss analysis run. Never
 *       triggers a synchronous AI call. has_sufficient_data is false when fewer than
 *       the admin-configured minimum closed deals exist — the client should show a
 *       "not enough closed deal history yet" message in that case. Gated by the
 *       ai_win_loss_insights feature flag.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Cached win/loss insights
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: The ai_win_loss_insights flag is disabled
 */
router.get(
  '/win-loss',
  authenticate,
  requireFeatureEnabled('ai_win_loss_insights'),
  asyncHandler(getWinLossInsightsHandler),
);

/** Exports the cached win/loss insights as CSV. */
router.get(
  '/win-loss/export.csv',
  authenticate,
  requireFeatureEnabled('ai_win_loss_insights'),
  asyncHandler(exportWinLossInsightsCsvHandler),
);

/** Exports the cached win/loss insights as a PDF document. */
router.get(
  '/win-loss/export.pdf',
  authenticate,
  requireFeatureEnabled('ai_win_loss_insights'),
  asyncHandler(exportWinLossInsightsPdfHandler),
);

/**
 * @openapi
 * /api/v1/insights/churn-expansion:
 *   get:
 *     tags: [Insights]
 *     operationId: listChurnExpansionSignals
 *     summary: Get all active AI churn/expansion account signals
 *     description: >
 *       Returns all active (non-cleared) churn-risk and expansion signals from the most
 *       recent nightly detection run, across all closed-won accounts. Gated by the
 *       ai_churn_expansion_detection feature flag.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Active churn/expansion signals
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: The ai_churn_expansion_detection flag is disabled
 */
router.get(
  '/churn-expansion',
  authenticate,
  requireFeatureEnabled('ai_churn_expansion_detection'),
  asyncHandler(listChurnExpansionSignalsHandler),
);

/**
 * @openapi
 * /api/v1/insights/coaching/me:
 *   get:
 *     tags: [Insights]
 *     operationId: getMyCoachingInsights
 *     summary: Get the authenticated user's own cached AI coaching insights
 *     description: >
 *       Returns the authenticated user's own cached per-metric coaching insights
 *       from the most recent nightly run. Never triggers a synchronous
 *       computation. Available to any authenticated rep, manager, or admin for
 *       their own data — powers the "My Performance" dashboard section.
 *       Gated by the ai_rep_coaching_insights feature flag.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Cached coaching insights for the authenticated user
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: The ai_rep_coaching_insights flag is disabled
 */
router.get(
  '/coaching/me',
  authenticate,
  requireFeatureEnabled('ai_rep_coaching_insights'),
  asyncHandler(getMyCoachingInsightsHandler),
);

/**
 * @openapi
 * /api/v1/insights/coaching/team:
 *   get:
 *     tags: [Insights]
 *     operationId: getCoachingTeamOverview
 *     summary: Get a per-rep coaching insight summary for the rep selector
 *     description: >
 *       Returns a summary row (closed deal count, outlier metric count) per rep
 *       visible to the caller. Admins see all reps org-wide; managers see only
 *       reps within their own team subtree. Powers the rep selector on
 *       /insights/coaching. Gated by the ai_rep_coaching_insights feature flag
 *       and restricted to manager/admin roles.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Per-rep coaching insight summary
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Caller is not a manager or admin, or the flag is disabled
 */
router.get(
  '/coaching/team',
  authenticate,
  requireFeatureEnabled('ai_rep_coaching_insights'),
  requireRole('admin', 'manager'),
  asyncHandler(getCoachingTeamOverviewHandler),
);

/**
 * @openapi
 * /api/v1/insights/coaching/{repId}:
 *   get:
 *     tags: [Insights]
 *     operationId: getRepCoachingInsights
 *     summary: Get a specific rep's cached AI coaching insights
 *     description: >
 *       Returns a specific rep's cached per-metric coaching insights. Admins may
 *       view any rep; managers may only view reps within their own team subtree
 *       (403 otherwise). Gated by the ai_rep_coaching_insights feature flag and
 *       restricted to manager/admin roles — reps use /coaching/me instead.
 *
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: repId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cached coaching insights for the requested rep
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Caller is not a manager or admin, is a manager outside the rep's team, or the flag is disabled
 */
router.get(
  '/coaching/:repId',
  authenticate,
  requireFeatureEnabled('ai_rep_coaching_insights'),
  requireRole('admin', 'manager'),
  asyncHandler(getRepCoachingInsightsHandler),
);

export default router;
