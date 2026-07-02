/**
 * Insights routes — AI-generated cross-deal analysis endpoints. (MINCRM-464)
 * All endpoints require authentication and the ai_win_loss_insights feature flag.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getWinLossInsightsHandler,
  exportWinLossInsightsCsvHandler,
  exportWinLossInsightsPdfHandler,
} from '../controllers/winLossInsightController.js';
import { listChurnExpansionSignalsHandler } from '../controllers/churnExpansionController.js';

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
 *       ai_win_loss_insights feature flag. (MINCRM-464)
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
 *       ai_churn_expansion_detection feature flag. (MINCRM-469)
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

export default router;
