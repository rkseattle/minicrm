/**
 * Duplicate-explanation routes — cross-entity AI explanation of why two
 * contact or account records look like duplicates. (MINCRM-440)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { requireAiTokenBudget } from '../middleware/requireAiTokenBudget.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { explainDuplicateHandler } from '../controllers/duplicateExplanationController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/duplicates/explain:
 *   post:
 *     tags: [Duplicates]
 *     operationId: explainDuplicate
 *     summary: Explain why two records look like duplicates (MINCRM-440)
 *     description: >
 *       Runs an on-demand AI explanation of why two contact or account records
 *       were flagged as potential duplicates. Not persisted — generated fresh
 *       for each requested pair.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entity_type, record_a_id, record_b_id]
 *             properties:
 *               entity_type:
 *                 type: string
 *                 enum: [contact, account]
 *               record_a_id:
 *                 type: string
 *                 format: uuid
 *               record_b_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Explanation generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 explanation:
 *                   type: string
 *                 inconclusive:
 *                   type: boolean
 *                 generated_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: One or both records not found
 *       502:
 *         description: AI provider error
 *       503:
 *         description: AI is not configured
 */
router.post(
  '/explain',
  authenticate,
  requireFeatureEnabled('ai_duplicate_explanation'),
  requireAiTokenBudget,
  asyncHandler(explainDuplicateHandler),
);

export default router;
