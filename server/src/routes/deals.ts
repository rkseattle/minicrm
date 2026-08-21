/**
 * Deal routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage deals.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { requireAiTokenBudget } from '../middleware/requireAiTokenBudget.js';
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
  exportDealsPdfHandler,
  exportDealPdfHandler,
} from '../controllers/dealController.js';
import { runDealHealthCheckHandler } from '../controllers/dealHealthController.js';
import { getStageAdvancementHandler } from '../controllers/stageAdvancementController.js';
import { getDealStakeholderMapHandler } from '../controllers/championBlockerController.js';
import {
  generateProposalDraftHandler,
  exportProposalDraftDocxHandler,
} from '../controllers/proposalDraftController.js';
import {
  listDealTagsHandler,
  attachDealTagHandler,
  detachDealTagHandler,
} from '../controllers/tagController.js';
import { bulkDealsHandler } from '../controllers/bulkController.js';
import { bulkPatchDealsHandler, bulkDeleteDealsHandler } from '../controllers/bulkV2Controller.js';

const router = Router();

/**
 * @openapi
 * /api/v1/deals:
 *   get:
 *     tags: [Deals]
 *     operationId: listDeals
 *     summary: List deals
 *     description: >
 *       Returns all deals. Pass `?owner=me` to scope to the authenticated user's deals,
 *       or `?owner=my_team` to scope to deals owned by any member of the user's teams.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *           enum: [me, my_team]
 *         description: "'me' returns only the authenticated user's deals; 'my_team' returns deals owned by any member of the user's teams"
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
 *
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
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/export',
  authenticate,
  requireFeatureEnabled('csv_export'),
  asyncHandler(exportDealsHandler),
);

/**
 * @openapi
 * /api/v1/deals/export.pdf:
 *   get:
 *     tags: [Deals]
 *     operationId: exportDealsPdf
 *     summary: Export deals to PDF
 *     description: >
 *       Returns all matching deals as a paginated PDF table, using the same filters
 *       and ownership rules as the CSV export.
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
  asyncHandler(exportDealsPdfHandler),
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
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Rep attempting to act on deals they do not own
 */
router.post(
  '/bulk',
  authenticate,
  requireCapability(Capability.DealsCreate),
  asyncHandler(bulkDealsHandler),
);

/**
 * @openapi
 * /api/v1/deals/bulk:
 *   patch:
 *     tags: [Deals]
 *     operationId: bulkPatchDeals
 *     summary: Bulk patch deals — reassign owner or change stage
 *     description: >
 *       Reassigns owner_id and/or changes stage on each listed deal individually.
 *       Requires bulk:operations + deals:edit. Non-admin actors can only
 *       act on deals they own. Max 500 IDs per request.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids, patch]
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 maxItems: 500
 *               patch:
 *                 type: object
 *                 properties:
 *                   owner_id:
 *                     type: string
 *                     format: uuid
 *                   stage:
 *                     type: string
 *     responses:
 *       200:
 *         description: Partial or full success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkV2Result'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
// Registered here (before /:id) to prevent Express matching 'bulk' as a UUID param
router.patch(
  '/bulk',
  authenticate,
  requireCapability(Capability.BulkOperations),
  requireCapability(Capability.DealsEdit),
  asyncHandler(bulkPatchDealsHandler),
);
/**
 * @openapi
 * /api/v1/deals/bulk:
 *   delete:
 *     tags: [Deals]
 *     operationId: bulkDeleteDeals
 *     summary: Bulk delete deals
 *     description: >
 *       Deletes each listed deal individually.
 *       Requires bulk:operations + deals:delete. Non-admin actors can only
 *       delete deals they own. Max 500 IDs per request.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 maxItems: 500
 *     responses:
 *       200:
 *         description: Partial or full success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkV2Result'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
// Registered here (before /:id) to prevent Express matching 'bulk' as a UUID param
router.delete(
  '/bulk',
  authenticate,
  requireCapability(Capability.BulkOperations),
  requireCapability(Capability.DealsDelete),
  asyncHandler(bulkDeleteDealsHandler),
);

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
  requireCapability(Capability.DealsCreate),
  asyncHandler(createDealHandler),
);

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
 * /api/v1/deals/{id}/export.pdf:
 *   get:
 *     tags: [Deals]
 *     operationId: exportDealPdf
 *     summary: Export a single deal to PDF
 *     description: >
 *       Returns a one-record summary PDF for the given deal — overview fields,
 *       custom fields, linked contacts, and notes. Visibility matches
 *       GET /api/v1/deals/{id}.
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
 *         description: Deal not found
 */
router.get(
  '/:id/export.pdf',
  authenticate,
  requireFeatureEnabled('csv_export'),
  asyncHandler(exportDealPdfHandler),
);

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
router.patch(
  '/:id',
  authenticate,
  requireCapability(Capability.DealsEdit),
  asyncHandler(updateDealHandler),
);

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
router.delete(
  '/:id',
  authenticate,
  requireCapability(Capability.DealsDelete),
  asyncHandler(deleteDealHandler),
);

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
  requireCapability(Capability.DealsEdit),
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
  requireCapability(Capability.DealsEdit),
  asyncHandler(unlinkContactHandler),
);

/**
 * @openapi
 * /api/v1/deals/{id}/health-check:
 *   post:
 *     tags: [Deals]
 *     operationId: runDealHealthCheck
 *     summary: Run an AI deal health check
 *     description: >
 *       Generates an on-demand AI assessment of the deal's health (On Track / At Risk /
 *       Stalled) with a narrative and recommended next actions. Not persisted — the
 *       assessment is regenerated on every call. Reps may only run this on deals they
 *       own; admins may run it on any deal. Gated by the ai_deal_health_check feature
 *       flag.
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
 *         description: Deal health assessment
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [on_track, at_risk, stalled]
 *                 narrative:
 *                   type: string
 *                 next_actions:
 *                   type: array
 *                   items:
 *                     type: string
 *                 generated_at:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Rep attempting to check a deal they do not own, or the ai_deal_health_check flag is disabled
 *       404:
 *         description: Deal not found
 *       502:
 *         description: AI provider error
 *       503:
 *         description: AI is not configured or enabled
 */
router.post(
  '/:id/health-check',
  authenticate,
  requireFeatureEnabled('ai_deal_health_check'),
  asyncHandler(runDealHealthCheckHandler),
);

/**
 * @openapi
 * /api/v1/deals/{id}/stage-advancement:
 *   get:
 *     tags: [Deals]
 *     operationId: getStageAdvancement
 *     summary: Get an AI stage advancement suggestion
 *     description: >
 *       Runs a passive on-demand AI check for whether the deal looks ready to advance to its
 *       next pipeline stage. Returns { ready: false } (not an error) when the deal is in a
 *       terminal stage, has no next stage configured, or the AI is not confident — the client
 *       should render no indicator in that case. Reps may only check deals they own; admins
 *       may check any deal. Gated by the ai_stage_advancement feature flag.
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
 *         description: Stage advancement check result
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     ready:
 *                       type: boolean
 *                       enum: [true]
 *                     next_stage_id:
 *                       type: string
 *                       format: uuid
 *                     next_stage_name:
 *                       type: string
 *                     rationale:
 *                       type: string
 *                 - type: object
 *                   properties:
 *                     ready:
 *                       type: boolean
 *                       enum: [false]
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Rep attempting to check a deal they do not own, or the ai_stage_advancement flag is disabled
 *       404:
 *         description: Deal not found
 *       502:
 *         description: AI provider error
 *       503:
 *         description: AI is not configured or enabled
 */
router.get(
  '/:id/stage-advancement',
  authenticate,
  requireFeatureEnabled('ai_stage_advancement'),
  asyncHandler(getStageAdvancementHandler),
);

/**
 * Returns the AI champion/blocker stakeholder map for the deal's linked contacts.
 *
 * @openapi
 * /api/v1/deals/{id}/stakeholder-map:
 *   get:
 *     operationId: getDealStakeholderMap
 *     summary: Get the champion/blocker stakeholder map for a deal
 *     tags: [Deals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Stakeholder map
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature disabled
 *       404:
 *         description: Deal not found
 */
router.get(
  '/:id/stakeholder-map',
  authenticate,
  requireFeatureEnabled('ai_champion_blocker_detection'),
  asyncHandler(getDealStakeholderMapHandler),
);

// ── AI proposal draft generation ───────────────────────────────────

/**
 * Generates (or regenerates, with optional focus_notes) an AI proposal draft
 * for the deal. High-token operation — gated by requireAiTokenBudget after
 * the feature flag check, per the spec.
 *
 * @openapi
 * /api/v1/deals/{id}/proposal-draft:
 *   post:
 *     operationId: generateProposalDraft
 *     summary: Generate an AI proposal draft for a deal
 *     tags: [Deals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               focus_notes: { type: string }
 *     responses:
 *       200:
 *         description: Generated proposal draft
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature disabled
 *       429:
 *         description: AI token budget exhausted for the current period
 *       404:
 *         description: Deal not found
 */
router.post(
  '/:id/proposal-draft',
  authenticate,
  requireFeatureEnabled('ai_proposal_draft_generation'),
  requireAiTokenBudget,
  asyncHandler(generateProposalDraftHandler),
);

/**
 * Converts a client-held (possibly rep-edited) draft into a downloadable DOCX file.
 *
 * @openapi
 * /api/v1/deals/{id}/proposal-draft/export-docx:
 *   post:
 *     operationId: exportProposalDraftDocx
 *     summary: Export a proposal draft as a DOCX document
 *     tags: [Deals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: DOCX document
 *         content:
 *           application/vnd.openxmlformats-officedocument.wordprocessingml.document:
 *             schema: { type: string, format: binary }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature disabled
 *       404:
 *         description: Deal not found
 */
router.post(
  '/:id/proposal-draft/export-docx',
  authenticate,
  requireFeatureEnabled('ai_proposal_draft_generation'),
  asyncHandler(exportProposalDraftDocxHandler),
);

// ── Deal Tag Routes ───────────────────────────────────────────────

/**
 * List all tags on a deal.
 *
 * @openapi
 * /api/v1/deals/{id}/tags:
 *   get:
 *     operationId: listDealTags
 *     summary: List all tags on a deal
 *     tags: [Deals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Tags on the deal
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature disabled
 */
router.get(
  '/:id/tags',
  authenticate,
  requireFeatureEnabled('tags'),
  asyncHandler(listDealTagsHandler),
);

/**
 * Attach a tag to a deal by name, creating the tag if it does not exist.
 *
 * @openapi
 * /api/v1/deals/{id}/tags:
 *   post:
 *     operationId: attachDealTag
 *     summary: Attach a tag to a deal, creating it if needed
 *     tags: [Deals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *     responses:
 *       201:
 *         description: Tag attached
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature disabled or capability missing
 */
router.post(
  '/:id/tags',
  authenticate,
  requireCapability(Capability.DealsEdit),
  requireFeatureEnabled('tags'),
  asyncHandler(attachDealTagHandler),
);

/**
 * Detach a tag from a deal.
 *
 * @openapi
 * /api/v1/deals/{id}/tags/{tagId}:
 *   delete:
 *     operationId: detachDealTag
 *     summary: Detach a tag from a deal
 *     tags: [Deals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: tagId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Tag detached
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature disabled or capability missing
 */
router.delete(
  '/:id/tags/:tagId',
  authenticate,
  requireCapability(Capability.DealsEdit),
  requireFeatureEnabled('tags'),
  asyncHandler(detachDealTagHandler),
);

export default router;
