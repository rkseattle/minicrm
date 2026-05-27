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
  getCurrenciesHandler,
  updateCurrenciesHandler,
  getTagsRestrictCreationHandler,
  setTagsRestrictCreationHandler,
  getOnboardingStatusHandler,
  setOnboardingCompletedHandler,
  deletePipelineStagesReviewedHandler,
  getMfaRequiredHandler,
  setMfaRequiredHandler,
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
  reorderPipelineStagesHandler,
} from '../controllers/pipelineStageController.js';
import {
  getSmtpConfigHandler,
  putSmtpConfigHandler,
  testSmtpHandler,
} from '../controllers/smtpController.js';
import {
  getBrandingHandler,
  putBrandingHandler,
  deleteBrandingHandler,
} from '../controllers/brandingController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/settings/default-language:
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
 * /api/v1/settings/default-language:
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
 * /api/v1/settings/nav-layout:
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
 * /api/v1/settings/nav-layout:
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
 * /api/v1/settings/email-notifications:
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
 * /api/v1/settings/email-notifications:
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

// ── Tag creation restriction (MINCRM-263) ────────────────────────────────────

/**
 * @openapi
 * /api/v1/settings/tags-restrict-creation:
 *   get:
 *     tags: [Settings]
 *     operationId: getTagsRestrictCreation
 *     summary: Get whether tag creation is restricted to the Tag Management page (MINCRM-263)
 *     description: >
 *       Returns whether inline tag creation is restricted to admins only.
 *       Requires authentication — rep callers need this to know whether to show
 *       the "create new tag" option in tag inputs.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current restriction setting
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 restricted: { type: boolean }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/tags-restrict-creation', authenticate, asyncHandler(getTagsRestrictCreationHandler));

/**
 * @openapi
 * /api/v1/settings/tags-restrict-creation:
 *   patch:
 *     tags: [Settings]
 *     operationId: setTagsRestrictCreation
 *     summary: Set whether tag creation is restricted to the Tag Management page (admin only, MINCRM-263)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [restricted]
 *             properties:
 *               restricted: { type: boolean }
 *     responses:
 *       200:
 *         description: Restriction setting updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.patch(
  '/tags-restrict-creation',
  authenticate,
  requireRole('admin'),
  asyncHandler(setTagsRestrictCreationHandler),
);

// ── Storage configuration (MINCRM-169) ───────────────────────────────────────

/**
 * @openapi
 * /api/v1/settings/storage/status:
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
 * /api/v1/settings/storage:
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
 * /api/v1/settings/storage:
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
 * /api/v1/settings/storage:
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
 * /api/v1/settings/storage/test:
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
 * /api/v1/settings/default-currency:
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
 * /api/v1/settings/default-currency:
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
 * /api/v1/settings/pipeline-stages:
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
 * /api/v1/settings/pipeline-stages:
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
 * /api/v1/settings/pipeline-stages/reorder:
 *   put:
 *     tags: [Settings]
 *     operationId: reorderPipelineStages
 *     summary: Atomically reorder all pipeline stages (admin only, MINCRM-381)
 *     description: >
 *       Accepts the full ordered array of stage UUIDs and assigns sort_order 1..N
 *       in a single transaction. Replaces the two-PATCH sequential swap that caused
 *       transient 409 STAGE_SORT_ORDER_CONFLICT errors.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stages]
 *             properties:
 *               stages:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Stages in new order
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PipelineStageResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.put(
  '/pipeline-stages/reorder',
  authenticate,
  requireRole('admin'),
  asyncHandler(reorderPipelineStagesHandler),
);

/**
 * @openapi
 * /api/v1/settings/pipeline-stages/{id}:
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
 * /api/v1/settings/pipeline-stages/{id}:
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

// ── Exchange rates (MINCRM-251) ───────────────────────────────────────────────

/**
 * @openapi
 * /api/v1/settings/currencies:
 *   get:
 *     tags: [Settings]
 *     operationId: getCurrencies
 *     summary: Get all exchange rate configuration (MINCRM-251)
 *     description: >
 *       Returns the home currency and all configured exchange rates.
 *       Requires authentication.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Currency configuration with home currency and rates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 home_currency: { type: string, example: USD }
 *                 currencies:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code: { type: string }
 *                       name: { type: string }
 *                       symbol: { type: string }
 *                       rate_to_home: { type: number }
 *                       is_home: { type: boolean }
 *                       updated_at: { type: string, format: date-time }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/currencies', authenticate, asyncHandler(getCurrenciesHandler));

/**
 * @openapi
 * /api/v1/settings/currencies:
 *   put:
 *     tags: [Settings]
 *     operationId: updateCurrencies
 *     summary: Replace exchange rate configuration (admin only, MINCRM-251)
 *     description: >
 *       Atomically replaces the non-home currency set and sets the home currency.
 *       The home currency row is always stored with rate_to_home = 1.000000.
 *       Requires admin role.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [home_currency, currencies]
 *             properties:
 *               home_currency: { type: string, example: USD }
 *               currencies:
 *                 type: array
 *                 maxItems: 20
 *                 items:
 *                   type: object
 *                   required: [code, name, symbol, rate_to_home]
 *                   properties:
 *                     code: { type: string }
 *                     name: { type: string }
 *                     symbol: { type: string }
 *                     rate_to_home: { type: number, minimum: 0 }
 *     responses:
 *       200:
 *         description: Updated currency configuration
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.put(
  '/currencies',
  authenticate,
  requireRole('admin'),
  asyncHandler(updateCurrenciesHandler),
);

// ── SMTP configuration (MINCRM-254) ──────────────────────────────────────────

/**
 * @openapi
 * /api/v1/settings/smtp:
 *   get:
 *     tags: [Settings]
 *     operationId: getSmtpConfig
 *     summary: Get SMTP configuration (MINCRM-254)
 *     description: >
 *       Returns current SMTP configuration. smtp_pass is never returned;
 *       smtp_pass_set indicates whether a password is stored. Requires authentication.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current SMTP configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 smtp_host: { type: string }
 *                 smtp_port: { type: integer }
 *                 smtp_user: { type: string }
 *                 smtp_pass_set: { type: boolean }
 *                 smtp_enabled: { type: boolean }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/smtp', authenticate, asyncHandler(getSmtpConfigHandler));

/**
 * @openapi
 * /api/v1/settings/smtp:
 *   put:
 *     tags: [Settings]
 *     operationId: putSmtpConfig
 *     summary: Save SMTP configuration (admin only, MINCRM-254)
 *     description: >
 *       Updates SMTP configuration. Omitting smtp_pass preserves the stored password.
 *       Admin only.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [smtp_host, smtp_port, smtp_user, smtp_enabled]
 *             properties:
 *               smtp_host: { type: string }
 *               smtp_port: { type: integer, minimum: 1, maximum: 65535 }
 *               smtp_user: { type: string }
 *               smtp_pass: { type: string }
 *               smtp_enabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated SMTP configuration
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.put('/smtp', authenticate, requireRole('admin'), asyncHandler(putSmtpConfigHandler));

/**
 * @openapi
 * /api/v1/settings/smtp/test:
 *   post:
 *     tags: [Settings]
 *     operationId: testSmtp
 *     summary: Send a test email using the current SMTP configuration (admin only, MINCRM-254)
 *     description: >
 *       Sends a test email to the specified address. Returns { success: true } or
 *       { success: false, error: string } with the SMTP error message.
 *       HTTP status is always 200 — the outcome is in the payload. Admin only.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to]
 *             properties:
 *               to: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Test result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 error: { type: string }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/smtp/test', authenticate, requireRole('admin'), asyncHandler(testSmtpHandler));

// ── Onboarding (MINCRM-256) ───────────────────────────────────────────────────

/**
 * @openapi
 * /api/v1/settings/onboarding:
 *   get:
 *     tags: [Settings]
 *     operationId: getOnboardingStatus
 *     summary: Get setup checklist status (MINCRM-379, MINCRM-410)
 *     description: >
 *       Returns is_first_run, onboarding_completed, and per-task completion for
 *       the setup checklist widget. Task completion is determined server-side.
 *       Admin users receive 5 org-wide tasks; rep users receive 4 per-user tasks.
 *       Visible to both admin and rep users (MINCRM-410).
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Onboarding / checklist status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 is_first_run: { type: boolean }
 *                 onboarding_completed: { type: boolean }
 *                 tasks:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       completed: { type: boolean }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// Visible to both admin and rep users (MINCRM-410)
router.get('/onboarding', authenticate, asyncHandler(getOnboardingStatusHandler));

/**
 * @openapi
 * /api/v1/settings/onboarding:
 *   put:
 *     tags: [Settings]
 *     operationId: setOnboardingCompleted
 *     summary: Mark onboarding as completed (MINCRM-256, MINCRM-410)
 *     description: >
 *       Sets the onboarding_completed flag on the calling user's own row.
 *       Available to all authenticated users — writes to the caller's own user row (MINCRM-410).
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [onboarding_completed]
 *             properties:
 *               onboarding_completed: { type: boolean }
 *     responses:
 *       200:
 *         description: Flag updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 onboarding_completed: { type: boolean }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// Available to all authenticated users — writes to the caller's own user row (MINCRM-410)
router.put('/onboarding', authenticate, asyncHandler(setOnboardingCompletedHandler));

/**
 * @openapi
 * /api/v1/settings/pipeline-stages-reviewed:
 *   delete:
 *     tags: [Settings]
 *     operationId: deletePipelineStagesReviewed
 *     summary: Clear the pipeline_stages_reviewed flag (admin only, MINCRM-410)
 *     description: >
 *       Removes the pipeline_stages_reviewed flag from system_settings so the
 *       onboarding checklist task reappears. Primarily used by E2E test setup
 *       (ensureSystemDefaults) to ensure a clean onboarding state.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       204:
 *         description: Flag cleared
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not admin
 */
router.delete(
  '/pipeline-stages-reviewed',
  authenticate,
  requireRole('admin'),
  asyncHandler(deletePipelineStagesReviewedHandler),
);

// ── Branding (MINCRM-356) ─────────────────────────────────────────────────────

/**
 * @openapi
 * /api/v1/settings/branding:
 *   get:
 *     tags: [Settings]
 *     operationId: getBranding
 *     summary: Get the custom branding configuration (MINCRM-356)
 *     description: >
 *       Returns the current branding config, or { branding: null } when no
 *       custom branding is configured. Public endpoint — callers need this
 *       before auth resolves so the login page reflects custom branding.
 *     security: []
 *     responses:
 *       200:
 *         description: Current branding configuration or null
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 branding:
 *                   nullable: true
 *                   type: object
 */
router.get('/branding', asyncHandler(getBrandingHandler));

/**
 * @openapi
 * /api/v1/settings/branding:
 *   put:
 *     tags: [Settings]
 *     operationId: putBranding
 *     summary: Set or update the custom branding configuration (admin only, MINCRM-356)
 *     description: >
 *       Merges the supplied fields onto the existing branding config.
 *       Derives primaryColorText server-side when primaryColor is provided.
 *       Admin only.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               logoUrl: { type: string, format: uri }
 *               logoAltText: { type: string }
 *               faviconUrl: { type: string, format: uri }
 *               primaryColor: { type: string, example: '#1a56db' }
 *               fontFamily: { type: string }
 *               companyName: { type: string }
 *     responses:
 *       200:
 *         description: Updated branding configuration
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.put('/branding', authenticate, requireRole('admin'), asyncHandler(putBrandingHandler));

/**
 * @openapi
 * /api/v1/settings/branding:
 *   delete:
 *     tags: [Settings]
 *     operationId: deleteBranding
 *     summary: Reset branding to defaults (admin only, MINCRM-356)
 *     description: >
 *       Deletes the branding configuration, restoring default MiniCRM appearance.
 *       Admin only.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Branding reset — returns { branding: null }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.delete('/branding', authenticate, requireRole('admin'), asyncHandler(deleteBrandingHandler));

/**
 * @openapi
 * /api/v1/settings/mfa-required:
 *   get:
 *     tags: [Settings]
 *     operationId: getMfaRequired
 *     summary: Get org-wide MFA enforcement status (admin only, MINCRM-392)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: MFA enforcement status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mfa_required:
 *                   type: boolean
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/mfa-required',
  authenticate,
  requireRole('admin'),
  asyncHandler(getMfaRequiredHandler),
);

/**
 * @openapi
 * /api/v1/settings/mfa-required:
 *   patch:
 *     tags: [Settings]
 *     operationId: setMfaRequired
 *     summary: Enable or disable org-wide MFA enforcement (admin only, MINCRM-392)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mfa_required]
 *             properties:
 *               mfa_required:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated MFA enforcement status
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.patch(
  '/mfa-required',
  authenticate,
  requireRole('admin'),
  asyncHandler(setMfaRequiredHandler),
);

export default router;
