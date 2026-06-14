/**
 * SCIM group-role mapping admin routes. Mounted at /api/v1 in app.ts. (MINCRM-541)
 *
 * All three routes require authenticate + requireCapability(Capability.IntegrationsManage).
 * These are standard JSON responses (not SCIM format) for use by the admin UI.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listScimGroupRoleMappingsHandler,
  putScimGroupRoleMappingHandler,
  deleteScimGroupRoleMappingHandler,
} from '../controllers/scimController.js';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /api/v1/scim/group-role-mappings:
 *   get:
 *     tags: [SCIM]
 *     operationId: listScimGroupRoleMappings
 *     summary: List all SCIM group → custom role mappings (MINCRM-541)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of mappings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mappings:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       scim_group_id:
 *                         type: string
 *                       group_name:
 *                         type: string
 *                       role_id:
 *                         type: string
 *                         format: uuid
 *                       created_at:
 *                         type: string
 *                         format: date-time
 */
router.get(
  '/scim/group-role-mappings',
  requireCapability(Capability.IntegrationsManage),
  asyncHandler(listScimGroupRoleMappingsHandler),
);

/**
 * @openapi
 * /api/v1/scim/group-role-mappings/{scimGroupId}:
 *   put:
 *     tags: [SCIM]
 *     operationId: putScimGroupRoleMapping
 *     summary: Create or replace the role mapping for a SCIM group (MINCRM-541)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: scimGroupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleId]
 *             properties:
 *               roleId:
 *                 type: string
 *                 format: uuid
 *               groupName:
 *                 type: string
 *     responses:
 *       204:
 *         description: Mapping saved
 *       400:
 *         description: roleId is required
 */
router.put(
  '/scim/group-role-mappings/:scimGroupId',
  requireCapability(Capability.IntegrationsManage),
  asyncHandler(putScimGroupRoleMappingHandler),
);

/**
 * @openapi
 * /api/v1/scim/group-role-mappings/{scimGroupId}:
 *   delete:
 *     tags: [SCIM]
 *     operationId: deleteScimGroupRoleMapping
 *     summary: Remove the role mapping for a SCIM group (MINCRM-541)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: scimGroupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Mapping deleted
 *       404:
 *         description: No mapping exists for that group ID
 */
router.delete(
  '/scim/group-role-mappings/:scimGroupId',
  requireCapability(Capability.IntegrationsManage),
  asyncHandler(deleteScimGroupRoleMappingHandler),
);

export default router;
