/**
 * Tag routes — global tag management endpoints.
 * All endpoints require authentication.
 * PATCH /:id and DELETE /:id are admin-only.
 *
 * Entity-scoped tag endpoints (attach/detach/list per contact, account, deal)
 * are registered on the respective entity routers (contacts.ts, accounts.ts, deals.ts).
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listTagsHandler,
  createTagHandler,
  getTagHandler,
  updateTagHandler,
  deleteTagHandler,
} from '../controllers/tagController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/tags:
 *   get:
 *     tags: [Tags]
 *     operationId: listTags
 *     summary: List all tags
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: 1-based page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 25
 *         description: Records per page
 *     responses:
 *       200:
 *         description: Paginated list of tags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Tag'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       401:
 *         description: Not authenticated
 */
router.get('/', authenticate, requireFeatureEnabled('tags'), asyncHandler(listTagsHandler));

/**
 * @openapi
 * /api/v1/tags:
 *   post:
 *     tags: [Tags]
 *     operationId: createTag
 *     summary: Create a tag
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tag created (or returned if already existing)
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Not authenticated
 */
router.post(
  '/',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  requireFeatureEnabled('tags'),
  asyncHandler(createTagHandler),
);

/**
 * @openapi
 * /api/v1/tags/{id}:
 *   get:
 *     tags: [Tags]
 *     operationId: getTag
 *     summary: Get a single tag
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
 *         description: Tag record
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Tag not found
 */
router.get('/:id', authenticate, requireFeatureEnabled('tags'), asyncHandler(getTagHandler));

/**
 * @openapi
 * /api/v1/tags/{id}:
 *   patch:
 *     tags: [Tags]
 *     operationId: updateTag
 *     summary: Rename a tag (admin only)
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
 *     responses:
 *       200:
 *         description: Updated tag
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 *       404:
 *         description: Tag not found
 */
router.patch(
  '/:id',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('tags'),
  asyncHandler(updateTagHandler),
);

/**
 * @openapi
 * /api/v1/tags/{id}:
 *   delete:
 *     tags: [Tags]
 *     operationId: deleteTag
 *     summary: Delete a tag (admin only)
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
 *         description: Tag deleted
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 *       404:
 *         description: Tag not found
 */
router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('tags'),
  asyncHandler(deleteTagHandler),
);

export default router;
