/**
 * Settings routes.
 * GET is public (needed on app load before auth).
 * PATCH requires authentication + admin role.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getDefaultLanguageHandler,
  setDefaultLanguageHandler,
} from '../controllers/settingsController.js';

const router = Router();

/**
 * @openapi
 * /api/settings/default-language:
 *   get:
 *     tags: [Settings]
 *     operationId: getDefaultLanguage
 *     summary: Get the system default language
 *     description: >
 *       Returns the current system-wide default language. This endpoint is public
 *       and does not require authentication — it is needed on app load before the
 *       user logs in. This endpoint will never return 401.
 *     security: []
 *     responses:
 *       200:
 *         description: Current default language
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DefaultLanguageResponse'
 *             example:
 *               language: en
 */
router.get('/default-language', asyncHandler(getDefaultLanguageHandler));

/**
 * @openapi
 * /api/settings/default-language:
 *   patch:
 *     tags: [Settings]
 *     operationId: setDefaultLanguage
 *     summary: Set the system default language (admin only)
 *     description: >
 *       Updates the system-wide default language. Applied to users who have no
 *       personal language preference set. Requires admin role.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SetDefaultLanguageRequest'
 *           example:
 *             language: es
 *     responses:
 *       200:
 *         description: Default language updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DefaultLanguageResponse'
 *             example:
 *               language: es
 *       400:
 *         description: Invalid language value
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: language must be one of en, zh-Hans, es, fr, de
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 *       403:
 *         description: Insufficient role (admin required)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: Admin role required
 */
router.patch(
  '/default-language',
  authenticate,
  requireRole('admin'),
  asyncHandler(setDefaultLanguageHandler),
);

export default router;
