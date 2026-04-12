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
  getNavLayoutHandler,
  setNavLayoutHandler,
  getEmailNotificationsEnabledHandler,
  setEmailNotificationsEnabledHandler,
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

/**
 * @openapi
 * /api/settings/nav-layout:
 *   get:
 *     tags: [Settings]
 *     operationId: getNavLayout
 *     summary: Get the system navigation layout
 *     description: >
 *       Returns the current system-wide navigation layout. Public endpoint —
 *       clients may need this before auth resolves. Will never return 401.
 *     security: []
 *     responses:
 *       200:
 *         description: Current nav layout
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NavLayoutResponse'
 *             example:
 *               layout: top
 */
router.get('/nav-layout', asyncHandler(getNavLayoutHandler));

/**
 * @openapi
 * /api/settings/nav-layout:
 *   patch:
 *     tags: [Settings]
 *     operationId: setNavLayout
 *     summary: Set the system navigation layout (admin only)
 *     description: >
 *       Updates the system-wide navigation layout. Requires admin role. (MINCRM-133)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SetNavLayoutRequest'
 *           example:
 *             layout: left
 *     responses:
 *       200:
 *         description: Nav layout updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NavLayoutResponse'
 *             example:
 *               layout: left
 *       400:
 *         description: Invalid layout value
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: "Layout must be one of: top, left, hamburger"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.patch('/nav-layout', authenticate, requireRole('admin'), asyncHandler(setNavLayoutHandler));

/**
 * @openapi
 * /api/settings/email-notifications:
 *   get:
 *     tags: [Settings]
 *     operationId: getEmailNotificationsEnabled
 *     summary: Get the system-wide email notifications toggle (MINCRM-163)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Whether email notifications are globally enabled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled: { type: boolean }
 */
router.get('/email-notifications', authenticate, asyncHandler(getEmailNotificationsEnabledHandler));

/**
 * @openapi
 * /api/settings/email-notifications:
 *   patch:
 *     tags: [Settings]
 *     operationId: setEmailNotificationsEnabled
 *     summary: Set the system-wide email notifications toggle (admin only, MINCRM-163)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Toggle state updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.patch(
  '/email-notifications',
  authenticate,
  requireRole('admin'),
  asyncHandler(setEmailNotificationsEnabledHandler),
);

export default router;
