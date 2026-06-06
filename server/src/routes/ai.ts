/**
 * AI administration routes — provider, model, and API key configuration.
 * All routes require authentication and the admin role.
 *
 * Future AI feature routes (NLI, suggestions, etc.) belong in a separate
 * router mounted at /api/v1/ai that uses requireAiEnabled middleware.
 * (MINCRM-457)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getAiConfigHandler,
  setAiConfigHandler,
  setAiEnabledHandler,
  setAiDpaAcknowledgmentHandler,
  testAiConnectionHandler,
} from '../controllers/aiConfigController.js';

const router = Router();

/**
 * @openapi
 * /admin/ai/config:
 *   get:
 *     tags: [AI]
 *     summary: Get AI provider/model configuration
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: AI configuration (API key is never returned)
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Admin role required
 */
router.get('/config', authenticate, requireRole('admin'), asyncHandler(getAiConfigHandler));

/**
 * @openapi
 * /admin/ai/config:
 *   patch:
 *     tags: [AI]
 *     summary: Update AI provider/model/key/deployment configuration
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, model, deployment_mode]
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [anthropic]
 *               model:
 *                 type: string
 *               api_key:
 *                 type: string
 *                 description: Omit to leave the stored key unchanged
 *               deployment_mode:
 *                 type: string
 *                 enum: [cloud_api, private_endpoint, self_hosted]
 *               base_url:
 *                 type: string
 *               custom_dpa_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated AI configuration
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Admin role required
 */
router.patch('/config', authenticate, requireRole('admin'), asyncHandler(setAiConfigHandler));

/**
 * @openapi
 * /admin/ai/master-toggle:
 *   patch:
 *     tags: [AI]
 *     summary: Enable or disable all AI features globally
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled]
 *             properties:
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated AI configuration
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Admin role required
 */
router.patch(
  '/master-toggle',
  authenticate,
  requireRole('admin'),
  asyncHandler(setAiEnabledHandler),
);

/**
 * @openapi
 * /admin/ai/dpa-acknowledgment:
 *   post:
 *     tags: [AI]
 *     summary: Record or reset the DPA acknowledgment for the current provider
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [acknowledged]
 *             properties:
 *               acknowledged:
 *                 type: boolean
 *               custom_dpa_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated AI configuration
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Admin role required
 */
router.post(
  '/dpa-acknowledgment',
  authenticate,
  requireRole('admin'),
  asyncHandler(setAiDpaAcknowledgmentHandler),
);

/**
 * @openapi
 * /admin/ai/test-connection:
 *   post:
 *     tags: [AI]
 *     summary: Test the API key and model against the provider
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, model, deployment_mode]
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [anthropic]
 *               model:
 *                 type: string
 *               api_key:
 *                 type: string
 *                 description: Omit to test using the stored key
 *               deployment_mode:
 *                 type: string
 *                 enum: [cloud_api, private_endpoint, self_hosted]
 *               base_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Connection test result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Admin role required
 */
router.post(
  '/test-connection',
  authenticate,
  requireRole('admin'),
  asyncHandler(testAiConnectionHandler),
);

export default router;
