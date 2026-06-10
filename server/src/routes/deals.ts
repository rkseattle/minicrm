/**
 * Deal routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage deals.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { blockViewer } from '../middleware/requireRole.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createDealHandler,
  listDealsHandler,
  getDealHandler,
  updateDealHandler,
  deleteDealHandler,
  linkContactHandler,
  unlinkContactHandler,
  exportDealsHandler,
} from '../controllers/dealController.js';
import {
  listDealTagsHandler,
  attachDealTagHandler,
  detachDealTagHandler,
} from '../controllers/tagController.js';
import { bulkDealsHandler } from '../controllers/bulkController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/deals:
 *   get:
 *     tags: [Deals]
 *     operationId: listDeals
 *     summary: List deals
 *     description: >
 *       Returns all deals. Pass `?owner=me` to scope results to the authenticated
 *       user's deals.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *           enum: [me]
 *         description: Pass 'me' to return only the authenticated user's deals
 *     responses:
 *       200:
 *         description: Array of deals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deals:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Deal'
 *             example:
 *               deals:
 *                 - id: d1e2f3a4-0000-0000-0000-000000000001
 *                   name: Acme Renewal
 *                   stage: Proposal
 *                   value: '12500.00'
 *                   close_date: '2025-12-31'
 *                   loss_reason: null
 *                   account_id: a1b2c3d4-0000-0000-0000-000000000001
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
router.get('/', authenticate, asyncHandler(listDealsHandler));

/**
 * @openapi
 * /api/v1/deals/export:
 *   get:
 *     tags: [Deals]
 *     operationId: exportDeals
 *     summary: Export deals to CSV
 *     description: >
 *       Returns all matching deals as a UTF-8 CSV file (with BOM).
 *       Reps receive only their own deals. Admins receive their own deals
 *       by default; pass `?all=true` to export all deals.
 *       (MINCRM-166)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: all
 *         schema:
 *           type: string
 *           enum: ['true']
 *         description: Admin only — pass 'true' to export all deals
 *       - in: query
 *         name: account
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by account ID
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
  asyncHandler(exportDealsHandler),
);

/**
 * @openapi
 * /api/v1/deals/bulk:
 *   post:
 *     tags: [Deals]
 *     operationId: bulkDeals
 *     summary: Bulk reassign, delete, or change stage on deals
 *     description: >
 *       Performs a bulk action on the specified deal IDs in a single transaction.
 *       Reps may only act on deals they own; any unowned ID returns 403.
 *       Admins may act on any deals.
 *       Stage is validated against the live pipeline_stages table.
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
 *                 enum: [reassign, delete, change_stage]
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
 *               stage:
 *                 type: string
 *                 description: Required when action is 'change_stage'. Must be a valid pipeline stage name.
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
 *         description: Validation error or invalid stage
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Rep attempting to act on deals they do not own
 */
router.post('/bulk', authenticate, blockViewer(), asyncHandler(bulkDealsHandler));

/**
 * @openapi
 * /api/v1/deals:
 *   post:
 *     tags: [Deals]
 *     operationId: createDeal
 *     summary: Create a deal
 *     description: Creates a new deal owned by the authenticated user.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateDealRequest'
 *           example:
 *             name: Acme Renewal
 *             stage: Proposal
 *             value: 12500
 *             close_date: '2025-12-31'
 *             account_id: a1b2c3d4-0000-0000-0000-000000000001
 *     responses:
 *       201:
 *         description: Deal created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deal:
 *                   $ref: '#/components/schemas/Deal'
 *             example:
 *               deal:
 *                 id: d1e2f3a4-0000-0000-0000-000000000001
 *                 name: Acme Renewal
 *                 stage: Proposal
 *                 value: '12500.00'
 *                 close_date: '2025-12-31'
 *                 loss_reason: null
 *                 account_id: a1b2c3d4-0000-0000-0000-000000000001
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
 *                 message: stage must be one of the allowed pipeline values
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
router.post('/', authenticate, blockViewer(), asyncHandler(createDealHandler));

/**
 * @openapi
 * /api/v1/deals/{id}:
 *   get:
 *     tags: [Deals]
 *     operationId: getDeal
 *     summary: Get a deal by ID
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Deal ID
 *     responses:
 *       200:
 *         description: Deal found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deal:
 *                   $ref: '#/components/schemas/Deal'
 *             example:
 *               deal:
 *                 id: d1e2f3a4-0000-0000-0000-000000000001
 *                 name: Acme Renewal
 *                 stage: Proposal
 *                 value: '12500.00'
 *                 close_date: '2025-12-31'
 *                 loss_reason: null
 *                 account_id: a1b2c3d4-0000-0000-0000-000000000001
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
 *         description: Deal not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Deal not found
 */
router.get('/:id', authenticate, asyncHandler(getDealHandler));

/**
 * @openapi
 * /api/v1/deals/{id}:
 *   patch:
 *     tags: [Deals]
 *     operationId: updateDeal
 *     summary: Update a deal
 *     description: >
 *       Updates one or more fields of an existing deal.
 *       Reps may only update deals they own; admins may update any deal.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Deal ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateDealRequest'
 *           example:
 *             stage: Negotiation
 *             value: 12500
 *     responses:
 *       200:
 *         description: Deal updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deal:
 *                   $ref: '#/components/schemas/Deal'
 *             example:
 *               deal:
 *                 id: d1e2f3a4-0000-0000-0000-000000000001
 *                 name: Acme Renewal
 *                 stage: Negotiation
 *                 value: '12500.00'
 *                 close_date: '2025-12-31'
 *                 loss_reason: null
 *                 account_id: a1b2c3d4-0000-0000-0000-000000000001
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
 *                 message: stage must be one of the allowed pipeline values
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
 *         description: Rep attempting to update a deal they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have permission to update this deal
 *       404:
 *         description: Deal not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Deal not found
 */
router.patch('/:id', authenticate, blockViewer(), asyncHandler(updateDealHandler));

/**
 * @openapi
 * /api/v1/deals/{id}:
 *   delete:
 *     tags: [Deals]
 *     operationId: deleteDeal
 *     summary: Delete a deal
 *     description: >
 *       Deletes a deal. Reps may only delete deals they own; admins may delete any deal.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Deal ID
 *     responses:
 *       204:
 *         description: Deal deleted (no content)
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
 *         description: Rep attempting to delete a deal they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have permission to delete this deal
 *       404:
 *         description: Deal not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Deal not found
 */
router.delete('/:id', authenticate, blockViewer(), asyncHandler(deleteDealHandler));

/**
 * @openapi
 * /api/v1/deals/{id}/contacts/{contactId}:
 *   post:
 *     tags: [Deals]
 *     operationId: linkContactToDeal
 *     summary: Link a contact to a deal
 *     description: >
 *       Associates the specified contact with the deal via the deal_contacts join table.
 *       The relationship is many-to-many. If the link already exists, the call is a
 *       no-op and still returns 200 (idempotent).
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Deal ID
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Contact linked to deal (or link already existed — both return 200)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Contact linked to deal
 *             example:
 *               message: Contact linked to deal
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
 *         description: Deal or contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Deal not found
 */
router.post(
  '/:id/contacts/:contactId',
  authenticate,
  blockViewer(),
  asyncHandler(linkContactHandler),
);

/**
 * @openapi
 * /api/v1/deals/{id}/contacts/{contactId}:
 *   delete:
 *     tags: [Deals]
 *     operationId: unlinkContactFromDeal
 *     summary: Unlink a contact from a deal
 *     description: >
 *       Removes the association between the contact and the deal. If the link does
 *       not exist, the call is a no-op and still returns 204 (idempotent).
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Deal ID
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       204:
 *         description: Contact unlinked (no content); also returned when link did not exist
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
 *         description: Deal or contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Deal not found
 */
router.delete(
  '/:id/contacts/:contactId',
  authenticate,
  blockViewer(),
  asyncHandler(unlinkContactHandler),
);

// ── Deal Tag Routes (MINCRM-186) ───────────────────────────────────────────────

/** List all tags on a deal. */
router.get(
  '/:id/tags',
  authenticate,
  requireFeatureEnabled('tags'),
  asyncHandler(listDealTagsHandler),
);

/** Attach a tag to a deal by name, creating the tag if it does not exist. */
router.post(
  '/:id/tags',
  authenticate,
  blockViewer(),
  requireFeatureEnabled('tags'),
  asyncHandler(attachDealTagHandler),
);

/** Detach a tag from a deal. */
router.delete(
  '/:id/tags/:tagId',
  authenticate,
  blockViewer(),
  requireFeatureEnabled('tags'),
  asyncHandler(detachDealTagHandler),
);

export default router;
