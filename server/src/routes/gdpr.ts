/**
 * GDPR routes — system-wide deletion log and status endpoints.
 * All endpoints require authentication and admin role.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listGdprDeletionsHandler,
  getGdprStatusHandler,
  triggerAiCascadeHandler,
  getAiCascadeLogHandler,
  triggerLeadAiCascadeHandler,
  getLeadAiCascadeLogHandler,
} from '../controllers/gdprController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/gdpr/deletions:
 *   get:
 *     tags: [GDPR]
 *     operationId: listGdprDeletions
 *     summary: List GDPR erasure log entries
 *     description: Returns a paginated list of all completed GDPR Art. 17 erasure requests.
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
 *           maximum: 200
 *           default: 50
 *     responses:
 *       200:
 *         description: Paginated list of deletion log entries
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 */
router.get(
  '/deletions',
  authenticate,
  requireRole('admin'),
  asyncHandler(listGdprDeletionsHandler),
);

/**
 * @openapi
 * /api/v1/gdpr/status/{recordType}/{recordId}:
 *   get:
 *     tags: [GDPR]
 *     operationId: getGdprStatus
 *     summary: Get GDPR erasure status for a record
 *     description: Returns the deletion log entry for a record if it has been erased, otherwise null.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: recordType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [contact, lead]
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: GDPR status object (status is null if not erased)
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 */
router.get(
  '/status/:recordType/:recordId',
  authenticate,
  requireRole('admin'),
  asyncHandler(getGdprStatusHandler),
);

/**
 * @openapi
 * /api/v1/gdpr/contacts/{id}/ai-cascade:
 *   post:
 *     tags: [GDPR]
 *     operationId: triggerAiCascade
 *     summary: Trigger a manual GDPR AI data cascade re-run for a contact
 *     description: |
 *       Asynchronously redacts any remaining PII references from ai_messages and
 *       user_ai_context for the given contact. Only valid after a GDPR erasure has
 *       been performed. Returns 202 immediately; check GET ai-cascade for results.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       202:
 *         description: Cascade accepted and running asynchronously
 *       400:
 *         description: Invalid UUID
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 *       409:
 *         description: |
 *           GDPR_ERASURE_NOT_FOUND when the contact has not been erased, or
 *           GDPR_CASCADE_PII_UNAVAILABLE when no failed cascade retains the
 *           identifiers a re-run needs.
 */
router.post(
  '/contacts/:id/ai-cascade',
  authenticate,
  requireRole('admin'),
  asyncHandler(triggerAiCascadeHandler),
);

/**
 * @openapi
 * /api/v1/gdpr/contacts/{id}/ai-cascade:
 *   get:
 *     tags: [GDPR]
 *     operationId: getAiCascadeLog
 *     summary: Get AI data cascade log entries for a contact
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of cascade log rows (newest first)
 *       400:
 *         description: Invalid UUID
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 */
router.get(
  '/contacts/:id/ai-cascade',
  authenticate,
  requireRole('admin'),
  asyncHandler(getAiCascadeLogHandler),
);

/**
 * @openapi
 * /api/v1/gdpr/leads/{id}/ai-cascade:
 *   post:
 *     tags: [GDPR]
 *     operationId: triggerLeadAiCascade
 *     summary: Trigger a manual GDPR AI data cascade re-run for a lead
 *     description: |
 *       Asynchronously redacts any remaining PII references from ai_messages and
 *       user_ai_context for the given lead. Only valid after a GDPR erasure has
 *       been performed. Returns 202 immediately; check GET ai-cascade for results.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       202:
 *         description: Cascade accepted and running asynchronously
 *       400:
 *         description: Invalid UUID
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 *       409:
 *         description: |
 *           GDPR_ERASURE_NOT_FOUND when the lead has not been erased, or
 *           GDPR_CASCADE_PII_UNAVAILABLE when no failed cascade retains the
 *           identifiers a re-run needs.
 */
router.post(
  '/leads/:id/ai-cascade',
  authenticate,
  requireRole('admin'),
  asyncHandler(triggerLeadAiCascadeHandler),
);

/**
 * @openapi
 * /api/v1/gdpr/leads/{id}/ai-cascade:
 *   get:
 *     tags: [GDPR]
 *     operationId: getLeadAiCascadeLog
 *     summary: Get AI data cascade log entries for a lead
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of cascade log rows (newest first)
 *       400:
 *         description: Invalid UUID
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 */
router.get(
  '/leads/:id/ai-cascade',
  authenticate,
  requireRole('admin'),
  asyncHandler(getLeadAiCascadeLogHandler),
);

export default router;
