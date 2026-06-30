/**
 * AI administration routes — provider, model, API key configuration, and token budgets.
 * Admin-scoped routes (/admin/ai/*) require authentication and the admin role.
 * User-scoped routes (/ai/*) require authentication only.
 *
 * Feature flag exemption: these routes are NOT gated by requireFeatureEnabled('ai_features').
 * They are the admin control plane for the AI toggle — gating them behind the flag they
 * control would create a chicken-and-egg deadlock (you cannot enable AI if the page itself
 * is disabled). The ai_features flag governs end-user AI features, not this admin config page.
 *
 * Future AI feature routes (NLI, suggestions, etc.) belong in a separate
 * router mounted at /api/v1/ai that uses requireAiEnabled middleware.
 * (MINCRM-457, MINCRM-458)
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
  setAiSessionRetentionHandler,
  testAiConnectionHandler,
} from '../controllers/aiConfigController.js';
import {
  getAiTokenBudgetsHandler,
  setOrgTokenBudgetHandler,
  setUserTokenBudgetHandler,
  getMyTokenBudgetStatusHandler,
} from '../controllers/aiTokenBudgetController.js';
import {
  listAiSessionsHandler,
  createAiSessionHandler,
  getAiSessionHandler,
  deleteAiSessionHandler,
  sendAiMessageHandler,
} from '../controllers/aiSessionController.js';
import {
  listAiContextHandler,
  createAiContextHandler,
  updateAiContextHandler,
  deleteAiContextHandler,
} from '../controllers/aiContextController.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';

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
 * /admin/ai/session-retention:
 *   patch:
 *     tags: [AI]
 *     summary: Update the AI session retention window (days)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ai_session_retention_days]
 *             properties:
 *               ai_session_retention_days:
 *                 type: integer
 *                 minimum: 30
 *                 maximum: 3650
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
  '/session-retention',
  authenticate,
  requireRole('admin'),
  asyncHandler(setAiSessionRetentionHandler),
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

/**
 * @openapi
 * /admin/ai/token-budgets:
 *   get:
 *     tags: [AI]
 *     summary: Get org token budget, per-user overrides, and current-month consumption
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token budget summary with per-user breakdown
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Admin role required
 */
router.get(
  '/token-budgets',
  authenticate,
  requireRole('admin'),
  asyncHandler(getAiTokenBudgetsHandler),
);

/**
 * @openapi
 * /admin/ai/token-budgets/org:
 *   patch:
 *     tags: [AI]
 *     summary: Set the org-wide monthly token limit
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [monthly_limit]
 *             properties:
 *               monthly_limit:
 *                 type: integer
 *                 minimum: 0
 *                 description: 0 means unlimited (no enforcement)
 *     responses:
 *       200:
 *         description: Updated org monthly limit
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Admin role required
 */
router.patch(
  '/token-budgets/org',
  authenticate,
  requireRole('admin'),
  asyncHandler(setOrgTokenBudgetHandler),
);

/**
 * @openapi
 * /admin/ai/token-budgets/users/{userId}:
 *   patch:
 *     tags: [AI]
 *     summary: Set or remove a per-user monthly token limit override
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
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
 *             required: [monthly_limit]
 *             properties:
 *               monthly_limit:
 *                 type: integer
 *                 minimum: 0
 *                 nullable: true
 *                 description: null removes the override so the user inherits the org default
 *     responses:
 *       200:
 *         description: Updated per-user limit
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Admin role required
 */
router.patch(
  '/token-budgets/users/:userId',
  authenticate,
  requireRole('admin'),
  asyncHandler(setUserTokenBudgetHandler),
);

export default router;

// ── User-facing AI router ──────────────────────────────────────────────────────
// Mounted exclusively at /api/v1/ai. Kept separate from the admin router so
// that mounting the admin router at /api/v1/admin/ai does not accidentally
// expose admin-only handlers at /api/v1/ai/*. (MINCRM-458)

const aiUserRouter = Router();

/**
 * @openapi
 * /ai/token-budget/me:
 *   get:
 *     tags: [AI]
 *     summary: Get the calling user's token budget status for the current month
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token budget status (limit, used, percentage, status)
 *       401:
 *         description: Unauthenticated
 */
aiUserRouter.get('/token-budget/me', authenticate, asyncHandler(getMyTokenBudgetStatusHandler));

/**
 * @openapi
 * /ai/sessions:
 *   get:
 *     tags: [AI]
 *     summary: List all AI conversation sessions for the authenticated user
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of session objects ordered by most-recently-updated
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Feature disabled
 */
aiUserRouter.get(
  '/sessions',
  authenticate,
  requireFeatureEnabled('ai_nli_page'),
  asyncHandler(listAiSessionsHandler),
);

/**
 * @openapi
 * /ai/sessions:
 *   post:
 *     tags: [AI]
 *     summary: Create a new AI conversation session
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       201:
 *         description: The newly created session
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Feature disabled
 */
aiUserRouter.post(
  '/sessions',
  authenticate,
  requireFeatureEnabled('ai_nli_page'),
  asyncHandler(createAiSessionHandler),
);

/**
 * @openapi
 * /ai/sessions/{sessionId}:
 *   get:
 *     tags: [AI]
 *     summary: Get a single session with its full message history
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Session object with embedded messages array
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Feature disabled or session belongs to another user
 *       404:
 *         description: Session not found
 */
aiUserRouter.get(
  '/sessions/:sessionId',
  authenticate,
  requireFeatureEnabled('ai_nli_page'),
  asyncHandler(getAiSessionHandler),
);

/**
 * @openapi
 * /ai/sessions/{sessionId}:
 *   delete:
 *     tags: [AI]
 *     summary: Delete a session and all its messages
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Session deleted
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Feature disabled
 *       404:
 *         description: Session not found or belongs to another user
 */
aiUserRouter.delete(
  '/sessions/:sessionId',
  authenticate,
  requireFeatureEnabled('ai_nli_page'),
  asyncHandler(deleteAiSessionHandler),
);

/**
 * @openapi
 * /ai/sessions/{sessionId}/messages:
 *   post:
 *     tags: [AI]
 *     summary: Send a user message and receive the AI assistant reply
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
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
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 32000
 *     responses:
 *       200:
 *         description: The assistant reply message
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Feature disabled
 *       404:
 *         description: Session not found
 *       502:
 *         description: AI provider error
 *       503:
 *         description: AI not configured or disabled
 */
aiUserRouter.post(
  '/sessions/:sessionId/messages',
  authenticate,
  requireFeatureEnabled('ai_nli_page'),
  asyncHandler(sendAiMessageHandler),
);

/**
 * @openapi
 * /ai/context:
 *   get:
 *     tags: [AI]
 *     summary: List all context entries for the authenticated user
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of context entries ordered by creation time
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Feature disabled
 */
aiUserRouter.get(
  '/context',
  authenticate,
  requireFeatureEnabled('ai_nli_page'),
  asyncHandler(listAiContextHandler),
);

/**
 * @openapi
 * /ai/context:
 *   post:
 *     tags: [AI]
 *     summary: Create a new context entry
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key, value]
 *             properties:
 *               key:
 *                 type: string
 *                 maxLength: 100
 *               value:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       201:
 *         description: Created context entry
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Feature disabled
 *       409:
 *         description: Entry limit reached (max 50 entries per user)
 */
aiUserRouter.post(
  '/context',
  authenticate,
  requireFeatureEnabled('ai_nli_page'),
  asyncHandler(createAiContextHandler),
);

/**
 * @openapi
 * /ai/context/{id}:
 *   patch:
 *     tags: [AI]
 *     summary: Update a context entry's key or value
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
 *               key:
 *                 type: string
 *                 maxLength: 100
 *               value:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Updated context entry
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Feature disabled
 *       404:
 *         description: Entry not found or belongs to another user
 */
aiUserRouter.patch(
  '/context/:id',
  authenticate,
  requireFeatureEnabled('ai_nli_page'),
  asyncHandler(updateAiContextHandler),
);

/**
 * @openapi
 * /ai/context/{id}:
 *   delete:
 *     tags: [AI]
 *     summary: Delete a context entry
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
 *         description: Entry deleted
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Feature disabled
 *       404:
 *         description: Entry not found or belongs to another user
 */
aiUserRouter.delete(
  '/context/:id',
  authenticate,
  requireFeatureEnabled('ai_nli_page'),
  asyncHandler(deleteAiContextHandler),
);

export { aiUserRouter };
