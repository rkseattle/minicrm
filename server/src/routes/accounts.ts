/**
 * Account routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage accounts.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createAccountHandler,
  listAccountsHandler,
  getAccountHandler,
  updateAccountHandler,
  deleteAccountHandler,
  exportAccountsHandler,
  exportAccountsPdfHandler,
  exportAccountPdfHandler,
  listChildAccountsHandler,
  searchAccountsHandler,
} from '../controllers/accountController.js';
import {
  listAccountTagsHandler,
  attachAccountTagHandler,
  detachAccountTagHandler,
} from '../controllers/tagController.js';
import { bulkAccountsHandler } from '../controllers/bulkController.js';
import { getAccountChurnExpansionSignalHandler } from '../controllers/churnExpansionController.js';
import { getAccountSentimentTrendHandler } from '../controllers/sentimentController.js';
import {
  getAccountHealthScoreHandler,
  getAccountHealthHistoryHandler,
} from '../controllers/relationshipHealthController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/accounts:
 *   get:
 *     tags: [Accounts]
 *     operationId: listAccounts
 *     summary: List accounts
 *     description: >
 *       Returns all accounts. Pass `?owner=me` to scope to the authenticated user's accounts,
 *       or `?owner=my_team` to scope to accounts owned by any member of the user's teams.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *           enum: [me, my_team]
 *         description: "'me' returns only the authenticated user's accounts; 'my_team' returns accounts owned by any member of the user's teams"
 *     responses:
 *       200:
 *         description: Array of accounts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accounts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Account'
 *             example:
 *               accounts:
 *                 - id: a1b2c3d4-0000-0000-0000-000000000001
 *                   name: Acme Corp
 *                   industry: Technology
 *                   website: https://www.acme.com
 *                   employee_range: 51-200
 *                   revenue_range: $10M-$50M
 *                   owner_id: u1b2c3d4-0000-0000-0000-000000000001
 *                   created_at: '2025-03-15T09:00:00.000Z'
 *                   updated_at: '2025-03-15T09:00:00.000Z'
 *       400:
 *         description: Invalid query parameter (e.g., unrecognized filter value)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: Invalid query parameter
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 */
router.get('/', authenticate, asyncHandler(listAccountsHandler));

/**
 * @openapi
 * /api/v1/accounts/export:
 *   get:
 *     tags: [Accounts]
 *     operationId: exportAccounts
 *     summary: Export accounts to CSV
 *     description: >
 *       Returns all matching accounts as a UTF-8 CSV file (with BOM).
 *       Reps receive only their own accounts. Admins receive their own accounts
 *       by default; pass `?all=true` to export all accounts.
 *
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: all
 *         schema:
 *           type: string
 *           enum: ['true']
 *         description: Admin only — pass 'true' to export all accounts
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive substring match on account name
 *       - in: query
 *         name: industry
 *         schema:
 *           type: string
 *         description: Case-insensitive substring match on industry
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/export',
  authenticate,
  requireFeatureEnabled('csv_export'),
  asyncHandler(exportAccountsHandler),
);

/**
 * @openapi
 * /api/v1/accounts/export.pdf:
 *   get:
 *     tags: [Accounts]
 *     operationId: exportAccountsPdf
 *     summary: Export accounts to PDF
 *     description: >
 *       Returns all matching accounts as a paginated PDF table, using the same filters
 *       and ownership rules as the CSV export.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: all
 *         schema:
 *           type: string
 *           enum: ['true']
 *         description: Admin only — pass 'true' to export all accounts
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive substring match on account name
 *       - in: query
 *         name: industry
 *         schema:
 *           type: string
 *         description: Case-insensitive substring match on industry
 *     responses:
 *       200:
 *         description: PDF file download
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/export.pdf',
  authenticate,
  requireFeatureEnabled('csv_export'),
  asyncHandler(exportAccountsPdfHandler),
);

/**
 * @openapi
 * /api/v1/accounts/bulk:
 *   post:
 *     tags: [Accounts]
 *     operationId: bulkAccounts
 *     summary: Bulk reassign or delete accounts
 *     description: >
 *       Performs a bulk action on the specified account IDs in a single transaction.
 *       Reps may only act on accounts they own; any unowned ID returns 403.
 *       Admins may act on any accounts.
 *
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action, ids]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [reassign, delete]
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 minItems: 1
 *               owner_id:
 *                 type: string
 *                 format: uuid
 *                 description: Required when action is 'reassign'
 *     responses:
 *       200:
 *         description: Bulk operation succeeded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 affected:
 *                   type: integer
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Rep attempting to act on accounts they do not own
 */
router.post(
  '/bulk',
  authenticate,
  requireCapability(Capability.ContactsCreate),
  asyncHandler(bulkAccountsHandler),
);

/**
 * @openapi
 * /api/v1/accounts:
 *   post:
 *     tags: [Accounts]
 *     operationId: createAccount
 *     summary: Create an account
 *     description: Creates a new account owned by the authenticated user.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAccountRequest'
 *           example:
 *             name: Acme Corp
 *             industry: Technology
 *             website: https://www.acme.com
 *             employee_range: 51-200
 *             revenue_range: $10M-$50M
 *     responses:
 *       201:
 *         description: Account created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 account:
 *                   $ref: '#/components/schemas/Account'
 *             example:
 *               account:
 *                 id: a1b2c3d4-0000-0000-0000-000000000001
 *                 name: Acme Corp
 *                 industry: Technology
 *                 website: https://www.acme.com
 *                 employee_range: 51-200
 *                 revenue_range: $10M-$50M
 *                 owner_id: u1b2c3d4-0000-0000-0000-000000000001
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *                 updated_at: '2025-03-15T09:00:00.000Z'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: Name is required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 */
router.post(
  '/',
  authenticate,
  requireCapability(Capability.ContactsCreate),
  asyncHandler(createAccountHandler),
);

/**
 * @openapi
 * /api/v1/accounts/search:
 *   get:
 *     tags: [Accounts]
 *     operationId: searchAccounts
 *     summary: Type-ahead account name search
 *     description: >
 *       Returns up to 10 accounts whose name contains the query string.
 *       Used by the Parent Account type-ahead selector.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Substring to match against account name
 *       - in: query
 *         name: exclude
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Account UUID to exclude (prevents self-parenting)
 *     responses:
 *       200:
 *         description: Matching accounts
 */
router.get('/search', authenticate, asyncHandler(searchAccountsHandler));

/**
 * @openapi
 * /api/v1/accounts/{id}:
 *   get:
 *     tags: [Accounts]
 *     operationId: getAccount
 *     summary: Get an account by ID
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Account ID
 *     responses:
 *       200:
 *         description: Account found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 account:
 *                   $ref: '#/components/schemas/Account'
 *             example:
 *               account:
 *                 id: a1b2c3d4-0000-0000-0000-000000000001
 *                 name: Acme Corp
 *                 industry: Technology
 *                 website: https://www.acme.com
 *                 employee_range: 51-200
 *                 revenue_range: $10M-$50M
 *                 owner_id: u1b2c3d4-0000-0000-0000-000000000001
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *                 updated_at: '2025-03-15T09:00:00.000Z'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 *       404:
 *         description: Account not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Account not found
 */
router.get('/:id', authenticate, asyncHandler(getAccountHandler));

/**
 * @openapi
 * /api/v1/accounts/{id}/export.pdf:
 *   get:
 *     tags: [Accounts]
 *     operationId: exportAccountPdf
 *     summary: Export a single account to PDF
 *     description: >
 *       Returns a one-record summary PDF for the given account — overview fields,
 *       custom fields, linked contacts, child accounts, and notes. Visibility
 *       matches GET /api/v1/accounts/{id}.
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
 *         description: PDF file download
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Account not found
 */
router.get(
  '/:id/export.pdf',
  authenticate,
  requireFeatureEnabled('csv_export'),
  asyncHandler(exportAccountPdfHandler),
);

/**
 * @openapi
 * /api/v1/accounts/{id}:
 *   patch:
 *     tags: [Accounts]
 *     operationId: updateAccount
 *     summary: Update an account
 *     description: >
 *       Updates one or more fields of an existing account.
 *       Reps may only update accounts they own; admins may update any account.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Account ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAccountRequest'
 *           example:
 *             industry: SaaS
 *             employee_range: 201-500
 *     responses:
 *       200:
 *         description: Account updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 account:
 *                   $ref: '#/components/schemas/Account'
 *             example:
 *               account:
 *                 id: a1b2c3d4-0000-0000-0000-000000000001
 *                 name: Acme Corp
 *                 industry: SaaS
 *                 website: https://www.acme.com
 *                 employee_range: 201-500
 *                 revenue_range: $10M-$50M
 *                 owner_id: u1b2c3d4-0000-0000-0000-000000000001
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *                 updated_at: '2025-03-16T10:30:00.000Z'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: Name must not be empty
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 *       403:
 *         description: Rep attempting to update an account they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have permission to update this account
 *       404:
 *         description: Account not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Account not found
 */
router.patch(
  '/:id',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(updateAccountHandler),
);

/**
 * @openapi
 * /api/v1/accounts/{id}:
 *   delete:
 *     tags: [Accounts]
 *     operationId: deleteAccount
 *     summary: Delete an account
 *     description: >
 *       Deletes an account. Reps may only delete accounts they own; admins may
 *       delete any account.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Account ID
 *     responses:
 *       204:
 *         description: Account deleted (no content)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 *       403:
 *         description: Rep attempting to delete an account they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have permission to delete this account
 *       404:
 *         description: Account not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Account not found
 */
router.delete(
  '/:id',
  authenticate,
  requireCapability(Capability.ContactsDelete),
  asyncHandler(deleteAccountHandler),
);

/**
 * @openapi
 * /api/v1/accounts/{id}/children:
 *   get:
 *     tags: [Accounts]
 *     operationId: listChildAccounts
 *     summary: List subsidiary accounts
 *     description: Returns all direct child (subsidiary) accounts.
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
 *         description: Array of child accounts
 *       404:
 *         description: Account not found
 */
router.get('/:id/children', authenticate, asyncHandler(listChildAccountsHandler));

// ── Account Tag Routes ───────────────────────────────────────────

/**
 * @openapi
 * /api/v1/accounts/{id}/tags:
 *   get:
 *     tags: [Accounts]
 *     operationId: listAccountTags
 *     summary: List tags on an account
 *     description: Returns every tag currently attached to the account.
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
 *         description: Array of tags attached to the account
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tags:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       name:
 *                         type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: The tags feature is disabled
 */
/** List all tags on an account. */
router.get(
  '/:id/tags',
  authenticate,
  requireFeatureEnabled('tags'),
  asyncHandler(listAccountTagsHandler),
);

/**
 * @openapi
 * /api/v1/accounts/{id}/tags:
 *   post:
 *     tags: [Accounts]
 *     operationId: attachAccountTag
 *     summary: Attach a tag to an account
 *     description: Attaches a tag by name, creating the tag when it does not already exist.
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
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tag attached (or returned if already attached)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tag:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     name:
 *                       type: string
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: name is required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Missing the contacts edit capability, or the tags feature is disabled
 */
/** Attach a tag to an account by name, creating the tag if it does not exist. */
router.post(
  '/:id/tags',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  requireFeatureEnabled('tags'),
  asyncHandler(attachAccountTagHandler),
);

/**
 * @openapi
 * /api/v1/accounts/{id}/tags/{tagId}:
 *   delete:
 *     tags: [Accounts]
 *     operationId: detachAccountTag
 *     summary: Detach a tag from an account
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: tagId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Tag detached
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Missing the contacts edit capability, or the tags feature is disabled
 */
/** Detach a tag from an account. */
router.delete(
  '/:id/tags/:tagId',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  requireFeatureEnabled('tags'),
  asyncHandler(detachAccountTagHandler),
);

/**
 * @openapi
 * /api/v1/accounts/{id}/churn-expansion-signal:
 *   get:
 *     tags: [Accounts]
 *     operationId: getAccountChurnExpansionSignal
 *     summary: Get the account's churn or expansion signal
 *     description: >
 *       Returns the active AI-detected churn-risk or expansion signal for the account,
 *       or null when no signal is currently active.
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
 *         description: The active signal, or null when none is active
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           The AI churn/expansion detection feature is disabled, or the caller has no
 *           visibility into this account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have visibility into this account.
 *       404:
 *         description: Account not found
 */
/** Returns the active AI churn/expansion signal for the account, or null when none is active. */
router.get(
  '/:id/churn-expansion-signal',
  authenticate,
  requireFeatureEnabled('ai_churn_expansion_detection'),
  asyncHandler(getAccountChurnExpansionSignalHandler),
);

// ── AI sentiment tracking ──────────────────────────────────────────

/**
 * @openapi
 * /api/v1/accounts/{id}/sentiment-trend:
 *   get:
 *     tags: [Accounts]
 *     operationId: getAccountSentimentTrend
 *     summary: Get the account's sentiment trend
 *     description: >
 *       Returns the aggregate sentiment trend across every contact at the account
 *       over the last 90 days.
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
 *         description: Aggregate sentiment trend for the account
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           The AI sentiment tracking feature is disabled, or the caller has no
 *           visibility into this account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have visibility into this account.
 *       404:
 *         description: Account not found
 */
/** Returns the aggregate sentiment trend across all contacts at the account, last 90 days. */
router.get(
  '/:id/sentiment-trend',
  authenticate,
  requireFeatureEnabled('ai_sentiment_tracking'),
  asyncHandler(getAccountSentimentTrendHandler),
);

// ── AI relationship health scoring ─────────────────────────────────

/**
 * @openapi
 * /api/v1/accounts/{id}/health-score:
 *   get:
 *     tags: [Accounts]
 *     operationId: getAccountHealthScore
 *     summary: Get the account's relationship health score
 *     description: >
 *       Returns the cached relationship health score for the account, or null when a
 *       score has not yet been computed.
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
 *         description: The cached health score, or null when not yet computed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 score:
 *                   type: object
 *                   nullable: true
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           The AI relationship health score feature is disabled, or the caller has no
 *           visibility into this account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have visibility into this account.
 *       404:
 *         description: Account not found
 */
/** Returns the cached relationship health score for the account, or null when not yet computed. */
router.get(
  '/:id/health-score',
  authenticate,
  requireFeatureEnabled('ai_relationship_health_score'),
  asyncHandler(getAccountHealthScoreHandler),
);

/**
 * @openapi
 * /api/v1/accounts/{id}/health-score/history:
 *   get:
 *     tags: [Accounts]
 *     operationId: getAccountHealthHistory
 *     summary: Get the account's health score history
 *     description: Returns up to 6 months of health score history for the trend sparkline.
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
 *         description: Health score history points, oldest first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 account_id:
 *                   type: string
 *                   format: uuid
 *                 points:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       score:
 *                         type: number
 *                       state:
 *                         type: string
 *                       computed_at:
 *                         type: string
 *                         format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           The AI relationship health score feature is disabled, or the caller has no
 *           visibility into this account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have visibility into this account.
 *       404:
 *         description: Account not found
 */
/** Returns up to 6 months of health score history for the trend sparkline. */
router.get(
  '/:id/health-score/history',
  authenticate,
  requireFeatureEnabled('ai_relationship_health_score'),
  asyncHandler(getAccountHealthHistoryHandler),
);

export default router;
