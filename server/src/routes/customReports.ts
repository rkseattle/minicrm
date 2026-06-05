/**
 * Custom report routes. (MINCRM-402)
 * All endpoints require authentication; no admin restriction (any user can create reports).
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listCustomReportsHandler,
  getCustomReportHandler,
  createCustomReportHandler,
  updateCustomReportHandler,
  deleteCustomReportHandler,
  runCustomReportHandler,
  runAdHocReportHandler,
  exportCustomReportHandler,
} from '../controllers/customReportController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/reports/custom:
 *   get:
 *     tags: [Reports]
 *     operationId: listCustomReports
 *     summary: List all saved custom reports
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of saved custom reports
 */
router.get('/', authenticate, asyncHandler(listCustomReportsHandler));

/**
 * @openapi
 * /api/v1/reports/custom/run:
 *   post:
 *     tags: [Reports]
 *     operationId: runAdHocReport
 *     summary: Execute an unsaved (ad-hoc) report config
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entity_type, config]
 *             properties:
 *               entity_type:
 *                 type: string
 *                 enum: [contact, account, deal, lead, activity]
 *               config:
 *                 type: object
 *     responses:
 *       200:
 *         description: Report result rows
 *       400:
 *         description: Validation error or invalid field
 */
router.post('/run', authenticate, asyncHandler(runAdHocReportHandler));

/**
 * @openapi
 * /api/v1/reports/custom:
 *   post:
 *     tags: [Reports]
 *     operationId: createCustomReport
 *     summary: Create a new saved custom report
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       201:
 *         description: Created report
 *       400:
 *         description: Validation error
 *       409:
 *         description: Name conflict
 */
router.post('/', authenticate, asyncHandler(createCustomReportHandler));

/**
 * @openapi
 * /api/v1/reports/custom/{id}:
 *   get:
 *     tags: [Reports]
 *     operationId: getCustomReport
 *     summary: Get a single saved custom report
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
 *         description: The custom report
 *       404:
 *         description: Not found
 */
router.get('/:id', authenticate, asyncHandler(getCustomReportHandler));

/**
 * @openapi
 * /api/v1/reports/custom/{id}:
 *   patch:
 *     tags: [Reports]
 *     operationId: updateCustomReport
 *     summary: Update a saved custom report
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
 *         description: Updated report
 *       404:
 *         description: Not found
 *       409:
 *         description: Name conflict
 */
router.patch('/:id', authenticate, asyncHandler(updateCustomReportHandler));

/**
 * @openapi
 * /api/v1/reports/custom/{id}:
 *   delete:
 *     tags: [Reports]
 *     operationId: deleteCustomReport
 *     summary: Delete a saved custom report
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
 *         description: Deleted
 *       404:
 *         description: Not found
 */
router.delete('/:id', authenticate, asyncHandler(deleteCustomReportHandler));

/**
 * @openapi
 * /api/v1/reports/custom/{id}/run:
 *   post:
 *     tags: [Reports]
 *     operationId: runCustomReport
 *     summary: Execute a saved custom report and return result rows
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
 *         description: Report result
 *       404:
 *         description: Report not found
 */
router.post('/:id/run', authenticate, asyncHandler(runCustomReportHandler));

/**
 * @openapi
 * /api/v1/reports/custom/{id}/export:
 *   get:
 *     tags: [Reports]
 *     operationId: exportCustomReport
 *     summary: Execute a saved custom report and stream as CSV
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
 *         description: CSV file
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       404:
 *         description: Report not found
 */
router.get('/:id/export', authenticate, asyncHandler(exportCustomReportHandler));

export default router;
