/**
 * Data hygiene routes — nightly hygiene queue read/action endpoints. (MINCRM-476)
 * All endpoints require authentication and the ai_data_hygiene_assistant feature flag.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listHygieneFindingsHandler,
  dismissHygieneFindingHandler,
  clearFindingsForEntityHandler,
  mergeDuplicateContactFindingsHandler,
} from '../controllers/dataHygieneController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/data-hygiene/findings:
 *   get:
 *     tags: [DataHygiene]
 *     operationId: listHygieneFindings
 *     summary: List current data hygiene findings
 *     description: >
 *       Returns the cached results of the most recent nightly hygiene scan.
 *       scope=mine (default) restricts to the caller's own records; scope=all
 *       is admin-only. Never triggers a synchronous scan. Findings currently
 *       within their dismiss-suppression window are excluded. Gated by the
 *       ai_data_hygiene_assistant feature flag. (MINCRM-476)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [mine, all]
 *       - in: query
 *         name: entity_type
 *         schema:
 *           type: string
 *           enum: [contact, account, opportunity]
 *     responses:
 *       200:
 *         description: Current hygiene findings
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: scope=all requested by a non-admin, or the flag is disabled
 */
router.get(
  '/findings',
  authenticate,
  requireFeatureEnabled('ai_data_hygiene_assistant'),
  asyncHandler(listHygieneFindingsHandler),
);

/**
 * @openapi
 * /api/v1/data-hygiene/findings/{id}/dismiss:
 *   post:
 *     tags: [DataHygiene]
 *     operationId: dismissHygieneFinding
 *     summary: Dismiss a hygiene finding for the configured suppression window
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Finding dismissed
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Finding not found
 */
router.post(
  '/findings/:id/dismiss',
  authenticate,
  requireFeatureEnabled('ai_data_hygiene_assistant'),
  asyncHandler(dismissHygieneFindingHandler),
);

/**
 * @openapi
 * /api/v1/data-hygiene/findings/clear/{entityType}/{entityId}:
 *   post:
 *     tags: [DataHygiene]
 *     operationId: clearHygieneFindingsForEntity
 *     summary: Clear all hygiene findings for a record
 *     description: >
 *       Removes findings for a record that was updated or archived via its own
 *       normal edit flow — this endpoint does not itself modify the record.
 *       (MINCRM-476)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [contact, account, opportunity]
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Findings cleared
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 */
router.post(
  '/findings/clear/:entityType/:entityId',
  authenticate,
  requireFeatureEnabled('ai_data_hygiene_assistant'),
  asyncHandler(clearFindingsForEntityHandler),
);

/**
 * @openapi
 * /api/v1/data-hygiene/findings/merge-contacts:
 *   post:
 *     tags: [DataHygiene]
 *     operationId: mergeDuplicateContactFindings
 *     summary: Merge a flagged duplicate contact pair
 *     description: >
 *       Reuses the existing contact merge logic (MINCRM-187) and clears both
 *       contacts' hygiene findings. (MINCRM-476)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [winnerId, loserId]
 *             properties:
 *               winnerId:
 *                 type: string
 *               loserId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contacts merged
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 */
router.post(
  '/findings/merge-contacts',
  authenticate,
  requireFeatureEnabled('ai_data_hygiene_assistant'),
  asyncHandler(mergeDuplicateContactFindingsHandler),
);

export default router;
