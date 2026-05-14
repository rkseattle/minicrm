/**
 * GDPR routes — system-wide deletion log and status endpoints.
 * All endpoints require authentication and admin role. (MINCRM-364)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { listGdprDeletionsHandler, getGdprStatusHandler } from '../controllers/gdprController.js';

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

export default router;
