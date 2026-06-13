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
  listChildAccountsHandler,
  searchAccountsHandler,
} from '../controllers/accountController.js';
import {
  listAccountTagsHandler,
  attachAccountTagHandler,
  detachAccountTagHandler,
} from '../controllers/tagController.js';
import { bulkAccountsHandler } from '../controllers/bulkController.js';

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
 *         description: "'me' returns only the authenticated user's accounts; 'my_team' returns accounts owned by any member of the user's teams (MINCRM-545)"
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
 *         description: Not authenticated
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
 *       (MINCRM-165)
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
 *         description: Not authenticated
 */
router.get(
  '/export',
  authenticate,
  requireFeatureEnabled('csv_export'),
  asyncHandler(exportAccountsHandler),
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
 *       (MINCRM-188)
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
 *         description: Not authenticated
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
 *         description: Not authenticated
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
 *       Used by the Parent Account type-ahead selector. (MINCRM-184)
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
 *         description: Not authenticated
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
 *     description: Returns all direct child (subsidiary) accounts. (MINCRM-184)
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

// ── Account Tag Routes (MINCRM-186) ───────────────────────────────────────────

/** List all tags on an account. */
router.get(
  '/:id/tags',
  authenticate,
  requireFeatureEnabled('tags'),
  asyncHandler(listAccountTagsHandler),
);

/** Attach a tag to an account by name, creating the tag if it does not exist. */
router.post(
  '/:id/tags',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  requireFeatureEnabled('tags'),
  asyncHandler(attachAccountTagHandler),
);

/** Detach a tag from an account. */
router.delete(
  '/:id/tags/:tagId',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  requireFeatureEnabled('tags'),
  asyncHandler(detachAccountTagHandler),
);

export default router;
