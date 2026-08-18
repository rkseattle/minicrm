/**
 * Custom field value routes — GET/PUT per-record values.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import {
  getCustomFieldValuesHandler,
  putCustomFieldValuesHandler,
} from '../controllers/customFieldController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/custom-fields/{entityType}/{recordId}/custom-fields:
 *   get:
 *     tags: [CustomFields]
 *     operationId: getCustomFieldValues
 *     summary: Get custom field values for a record
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [contact, account, deal]
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Custom field values with definitions
 *       400:
 *         description: Invalid entityType
 */
router.get(
  '/:entityType/:recordId/custom-fields',
  authenticate,
  requireFeatureEnabled('custom_fields'),
  asyncHandler(getCustomFieldValuesHandler),
);

/**
 * @openapi
 * /api/v1/custom-fields/{entityType}/{recordId}/custom-fields:
 *   put:
 *     tags: [CustomFields]
 *     operationId: putCustomFieldValues
 *     summary: Upsert custom field values for a record
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [contact, account, deal]
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               properties:
 *                 definition_id:
 *                   type: string
 *                   format: uuid
 *                 value:
 *                   type: string
 *                   nullable: true
 *     responses:
 *       200:
 *         description: Updated values
 *       400:
 *         description: Validation error
 */
router.put(
  '/:entityType/:recordId/custom-fields',
  authenticate,
  requireFeatureEnabled('custom_fields'),
  asyncHandler(putCustomFieldValuesHandler),
);

export default router;
