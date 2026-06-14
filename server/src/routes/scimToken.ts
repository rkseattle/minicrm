/**
 * SCIM token management routes. Mounted at /api/v1 in app.ts. (MINCRM-541)
 * Both routes require authenticate + requireCapability(Capability.IntegrationsManage).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getScimTokenMetaHandler,
  postScimTokenHandler,
} from '../controllers/scimTokenController.js';
import { revokeScimToken } from '../services/scimTokenService.js';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /api/v1/scim-token:
 *   get:
 *     tags: [SCIM]
 *     operationId: getScimTokenMeta
 *     summary: Get metadata about the active SCIM bearer token (MINCRM-541)
 *     description: >
 *       Returns metadata (id, createdAt, lastUsedAt) about the currently active
 *       SCIM bearer token, or null if no token has been issued. The token hash
 *       and plaintext are never returned.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token metadata or null
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   oneOf:
 *                     - type: 'null'
 *                     - type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *                         lastUsedAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/scim-token',
  requireCapability(Capability.IntegrationsManage),
  asyncHandler(getScimTokenMetaHandler),
);

/**
 * @openapi
 * /api/v1/scim-token:
 *   post:
 *     tags: [SCIM]
 *     operationId: generateScimToken
 *     summary: Generate a new SCIM bearer token (MINCRM-541)
 *     description: >
 *       Generates a new SCIM bearer token, atomically revoking any existing one.
 *       The raw token is returned exactly once in this response — it cannot be
 *       recovered later. Store it securely immediately.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       201:
 *         description: Newly generated token including plaintext (one-time only)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     rawToken:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post(
  '/scim-token',
  requireCapability(Capability.IntegrationsManage),
  asyncHandler(postScimTokenHandler),
);

/**
 * @openapi
 * /api/v1/scim-token:
 *   delete:
 *     tags: [SCIM]
 *     operationId: revokeScimToken
 *     summary: Revoke the active SCIM bearer token (MINCRM-541)
 *     description: >
 *       Permanently revokes the currently active SCIM bearer token. Inbound SCIM
 *       requests using the revoked token will immediately receive 401. Returns 404
 *       if no token is currently active.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token successfully revoked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 revoked:
 *                   type: boolean
 *                   example: true
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: No active SCIM token to revoke
 */
router.delete(
  '/scim-token',
  requireCapability(Capability.IntegrationsManage),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    // Safe: req.user is guaranteed by the authenticate middleware on this router.
    const actor = { id: req.user!.id, name: req.user!.name };

    const revoked = await revokeScimToken(actor);
    if (!revoked) {
      res.status(404).json({
        error: { code: 'SCIM_TOKEN_NOT_FOUND', message: 'No active SCIM token to revoke' },
      });
      return;
    }
    res.json({ revoked: true });
  }),
);

export default router;
