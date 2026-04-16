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
  getDefaultCurrencyHandler,
  setDefaultCurrencyHandler,
} from '../controllers/settingsController.js';
import {
  getStorageStatusHandler,
  getStorageConfigHandler,
  setStorageConfigHandler,
  clearStorageConfigHandler,
  testStorageConfigHandler,
} from '../controllers/attachmentController.js';
import {
  listPipelineStagesHandler,
  createPipelineStageHandler,
  updatePipelineStageHandler,
  deletePipelineStageHandler,
} from '../controllers/pipelineStageController.js';

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

// ── Storage configuration (MINCRM-169) ───────────────────────────────────────

/**
 * @openapi
 * /api/settings/storage/status:
 *   get:
 *     tags: [Settings]
 *     operationId: getStorageStatus
 *     summary: Get whether storage is configured (authenticated, MINCRM-167)
 *     description: >
 *       Returns only { configured: boolean }. Available to all authenticated users
 *       (not admin-only) so the attachments UI can show or hide the upload zone.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Storage configured status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 configured: { type: boolean }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/storage/status', authenticate, asyncHandler(getStorageStatusHandler));

/**
 * @openapi
 * /api/settings/storage:
 *   get:
 *     tags: [Settings]
 *     operationId: getStorageConfig
 *     summary: Get the storage backend configuration (admin only, MINCRM-169)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Storage configuration (secret masked)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/storage', authenticate, requireRole('admin'), asyncHandler(getStorageConfigHandler));

/**
 * @openapi
 * /api/settings/storage:
 *   put:
 *     tags: [Settings]
 *     operationId: setStorageConfig
 *     summary: Save storage backend configuration (admin only, MINCRM-169)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               endpoint: { type: string }
 *               bucket: { type: string }
 *               accessKeyId: { type: string }
 *               secretAccessKey: { type: string }
 *     responses:
 *       200:
 *         description: Storage configuration saved
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.put('/storage', authenticate, requireRole('admin'), asyncHandler(setStorageConfigHandler));

/**
 * @openapi
 * /api/settings/storage:
 *   delete:
 *     tags: [Settings]
 *     operationId: clearStorageConfig
 *     summary: Clear storage backend configuration (admin only, MINCRM-169)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Storage configuration cleared
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.delete(
  '/storage',
  authenticate,
  requireRole('admin'),
  asyncHandler(clearStorageConfigHandler),
);

/**
 * @openapi
 * /api/settings/storage/test:
 *   post:
 *     tags: [Settings]
 *     operationId: testStorageConfig
 *     summary: Test candidate storage credentials (admin only, MINCRM-169)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               endpoint: { type: string }
 *               bucket: { type: string }
 *               accessKeyId: { type: string }
 *               secretAccessKey: { type: string }
 *     responses:
 *       200:
 *         description: Test result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post(
  '/storage/test',
  authenticate,
  requireRole('admin'),
  asyncHandler(testStorageConfigHandler),
);

// ── Default currency (MINCRM-189) ─────────────────────────────────────────────

/**
 * @openapi
 * /api/settings/default-currency:
 *   get:
 *     tags: [Settings]
 *     operationId: getDefaultCurrency
 *     summary: Get the system default currency (MINCRM-189)
 *     description: >
 *       Returns the current system-wide default currency. Public endpoint —
 *       needed by the deal create form before auth resolves.
 *     security: []
 *     responses:
 *       200:
 *         description: Current default currency
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 currency: { type: string, example: USD }
 */
router.get('/default-currency', asyncHandler(getDefaultCurrencyHandler));

/**
 * @openapi
 * /api/settings/default-currency:
 *   patch:
 *     tags: [Settings]
 *     operationId: setDefaultCurrency
 *     summary: Set the system default currency (admin only, MINCRM-189)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currency]
 *             properties:
 *               currency: { type: string, example: EUR }
 *     responses:
 *       200:
 *         description: Default currency updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.patch(
  '/default-currency',
  authenticate,
  requireRole('admin'),
  asyncHandler(setDefaultCurrencyHandler),
);

// ── Pipeline stage configuration (MINCRM-180) ────────────────────────────────

/**
 * @openapi
 * /api/settings/pipeline-stages:
 *   get:
 *     tags: [Settings]
 *     operationId: listPipelineStages
 *     summary: List all pipeline stages in order (MINCRM-180)
 *     description: >
 *       Returns all pipeline stages ordered by sort_order. Public endpoint —
 *       the client fetches this at app startup to populate the stage selector.
 *       Will never return 401.
 *     security: []
 *     responses:
 *       200:
 *         description: Ordered list of pipeline stages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PipelineStageResponse'
 */
router.get('/pipeline-stages', asyncHandler(listPipelineStagesHandler));

/**
 * @openapi
 * /api/settings/pipeline-stages:
 *   post:
 *     tags: [Settings]
 *     operationId: createPipelineStage
 *     summary: Create a new pipeline stage (admin only, MINCRM-180)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, sort_order]
 *             properties:
 *               name: { type: string }
 *               sort_order: { type: integer }
 *               probability: { type: integer, minimum: 0, maximum: 100 }
 *     responses:
 *       201:
 *         description: Stage created
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: Stage name already in use
 */
router.post(
  '/pipeline-stages',
  authenticate,
  requireRole('admin'),
  asyncHandler(createPipelineStageHandler),
);

/**
 * @openapi
 * /api/settings/pipeline-stages/{id}:
 *   patch:
 *     tags: [Settings]
 *     operationId: updatePipelineStage
 *     summary: Update a pipeline stage (admin only, MINCRM-180)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               sort_order: { type: integer }
 *               probability: { type: integer, minimum: 0, maximum: 100 }
 *     responses:
 *       200:
 *         description: Stage updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Forbidden or fixed stage
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Stage name already in use
 */
router.patch(
  '/pipeline-stages/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(updatePipelineStageHandler),
);

/**
 * @openapi
 * /api/settings/pipeline-stages/{id}:
 *   delete:
 *     tags: [Settings]
 *     operationId: deletePipelineStage
 *     summary: Delete a pipeline stage (admin only, MINCRM-180)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Stage deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Forbidden or fixed stage
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Stage has open deals — cannot delete
 */
router.delete(
  '/pipeline-stages/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(deletePipelineStageHandler),
);

export default router;
