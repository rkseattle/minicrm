/**
 * Custom field definition routes. (MINCRM-276)
 * GET is authenticated; POST/PATCH/DELETE require admin role.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listCustomFieldDefinitionsHandler,
  createCustomFieldDefinitionHandler,
  updateCustomFieldDefinitionHandler,
  deleteCustomFieldDefinitionHandler,
} from '../controllers/customFieldController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/custom-fields/definitions:
 *   get:
 *     tags: [CustomFields]
 *     operationId: listCustomFieldDefinitions
 *     summary: List custom field definitions for an entity type
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: entity_type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [contact, account, deal]
 *     responses:
 *       200:
 *         description: List of custom field definitions
 *       400:
 *         description: Invalid entity_type
 */
router.get('/', authenticate, asyncHandler(listCustomFieldDefinitionsHandler));

/**
 * @openapi
 * /api/v1/custom-fields/definitions:
 *   post:
 *     tags: [CustomFields]
 *     operationId: createCustomFieldDefinition
 *     summary: Create a custom field definition (admin only)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       201:
 *         description: Created definition
 *       400:
 *         description: Validation error
 *       409:
 *         description: Name conflict
 */
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  asyncHandler(createCustomFieldDefinitionHandler),
);

/**
 * @openapi
 * /api/v1/custom-fields/definitions/{id}:
 *   patch:
 *     tags: [CustomFields]
 *     operationId: updateCustomFieldDefinition
 *     summary: Update a custom field definition (admin only)
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
 *         description: Updated definition
 *       404:
 *         description: Not found
 */
router.patch(
  '/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(updateCustomFieldDefinitionHandler),
);

/**
 * @openapi
 * /api/v1/custom-fields/definitions/{id}:
 *   delete:
 *     tags: [CustomFields]
 *     operationId: deleteCustomFieldDefinition
 *     summary: Delete a custom field definition and all its values (admin only)
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
router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(deleteCustomFieldDefinitionHandler),
);

export default router;
