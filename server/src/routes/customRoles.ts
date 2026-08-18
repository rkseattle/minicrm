/**
 * Custom roles routes.
 * All routes require authentication + settings:manage capability.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listCustomRolesHandler,
  getCustomRoleHandler,
  createCustomRoleHandler,
  updateCustomRoleHandler,
  deleteCustomRoleHandler,
} from '../controllers/customRolesController.js';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /api/v1/custom-roles:
 *   get:
 *     tags: [CustomRoles]
 *     operationId: listCustomRoles
 *     summary: List all custom roles
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of custom roles with their capability sets
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/', requireCapability(Capability.SettingsManage), asyncHandler(listCustomRolesHandler));

/**
 * @openapi
 * /api/v1/custom-roles/{id}:
 *   get:
 *     tags: [CustomRoles]
 *     operationId: getCustomRole
 *     summary: Get a custom role by ID
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
 *         description: Custom role detail
 *       400:
 *         description: Invalid UUID
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Role not found
 */
router.get(
  '/:id',
  requireCapability(Capability.SettingsManage),
  asyncHandler(getCustomRoleHandler),
);

/**
 * @openapi
 * /api/v1/custom-roles:
 *   post:
 *     tags: [CustomRoles]
 *     operationId: createCustomRole
 *     summary: Create a custom role
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, capabilities]
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 100
 *               description:
 *                 type: string
 *                 maxLength: 500
 *               capabilities:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 1
 *     responses:
 *       201:
 *         description: Role created
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: Role name already exists
 */
router.post(
  '/',
  requireCapability(Capability.SettingsManage),
  asyncHandler(createCustomRoleHandler),
);

/**
 * @openapi
 * /api/v1/custom-roles/{id}:
 *   put:
 *     tags: [CustomRoles]
 *     operationId: updateCustomRole
 *     summary: Update a custom role
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *                 nullable: true
 *               capabilities:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Role updated
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Role not found
 *       409:
 *         description: Built-in role cannot be modified
 */
router.put(
  '/:id',
  requireCapability(Capability.SettingsManage),
  asyncHandler(updateCustomRoleHandler),
);

/**
 * @openapi
 * /api/v1/custom-roles/{id}:
 *   delete:
 *     tags: [CustomRoles]
 *     operationId: deleteCustomRole
 *     summary: Delete a custom role
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
 *       204:
 *         description: Deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Role not found
 *       409:
 *         description: Built-in role or role has active assignees
 */
router.delete(
  '/:id',
  requireCapability(Capability.SettingsManage),
  asyncHandler(deleteCustomRoleHandler),
);

export default router;
