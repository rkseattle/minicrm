/**
 * Lead routes — all endpoints require authentication.
 * (MINCRM-173, MINCRM-174, MINCRM-175)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRole, requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import {
  createLeadHandler,
  listLeadsHandler,
  getLeadHandler,
  updateLeadHandler,
  deleteLeadHandler,
  getLeadStatusHistoryHandler,
  convertLeadHandler,
  searchAccountsHandler,
} from '../controllers/leadsController.js';
import { eraseLeadHandler, gdprExportLeadHandler } from '../controllers/gdprController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/leads/accounts/search:
 *   get:
 *     tags: [Leads]
 *     operationId: searchAccountsForConversion
 *     summary: Search accounts by name (for lead conversion)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Substring to match against account names
 *     responses:
 *       200:
 *         description: Array of matching accounts
 *       400:
 *         description: Missing q parameter
 *       401:
 *         description: Not authenticated
 */
router.get('/accounts/search', authenticate, asyncHandler(searchAccountsHandler));

/**
 * @openapi
 * /api/v1/leads:
 *   get:
 *     tags: [Leads]
 *     operationId: listLeads
 *     summary: List leads
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *           enum: [me, my_team]
 *         description: "'me' returns only the authenticated user's leads; 'my_team' returns leads owned by any member of the user's teams (MINCRM-545)"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [New, Contacted, Qualified, Disqualified]
 *       - in: query
 *         name: lead_source
 *         schema:
 *           type: string
 *       - in: query
 *         name: includeDisqualified
 *         schema:
 *           type: string
 *           enum: ['true']
 *       - in: query
 *         name: includeConverted
 *         schema:
 *           type: string
 *           enum: ['true']
 *     responses:
 *       200:
 *         description: Paginated list of leads
 *       401:
 *         description: Not authenticated
 */
router.get('/', authenticate, asyncHandler(listLeadsHandler));

/**
 * @openapi
 * /api/v1/leads:
 *   post:
 *     tags: [Leads]
 *     operationId: createLead
 *     summary: Create a lead
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateLeadRequest'
 *     responses:
 *       201:
 *         description: Lead created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       409:
 *         description: Duplicate email warning
 */
router.post(
  '/',
  authenticate,
  requireCapability(Capability.ContactsCreate),
  asyncHandler(createLeadHandler),
);

/**
 * @openapi
 * /api/v1/leads/{id}:
 *   get:
 *     tags: [Leads]
 *     operationId: getLead
 *     summary: Get a lead by ID
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
 *         description: Lead found
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Lead not found
 */
router.get('/:id', authenticate, asyncHandler(getLeadHandler));

/**
 * @openapi
 * /api/v1/leads/{id}:
 *   patch:
 *     tags: [Leads]
 *     operationId: updateLead
 *     summary: Update a lead
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
 *             $ref: '#/components/schemas/UpdateLeadRequest'
 *     responses:
 *       200:
 *         description: Lead updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Lead not found
 */
router.patch(
  '/:id',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(updateLeadHandler),
);

/**
 * @openapi
 * /api/v1/leads/{id}:
 *   delete:
 *     tags: [Leads]
 *     operationId: deleteLead
 *     summary: Delete a lead
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
 *         description: Lead deleted
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Lead not found
 */
router.delete(
  '/:id',
  authenticate,
  requireCapability(Capability.ContactsDelete),
  asyncHandler(deleteLeadHandler),
);

/**
 * @openapi
 * /api/v1/leads/{id}/status-history:
 *   get:
 *     tags: [Leads]
 *     operationId: getLeadStatusHistory
 *     summary: Get status change history for a lead
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
 *         description: Array of status history entries
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Lead not found
 */
router.get('/:id/status-history', authenticate, asyncHandler(getLeadStatusHistoryHandler));

/**
 * @openapi
 * /api/v1/leads/{id}/convert:
 *   post:
 *     tags: [Leads]
 *     operationId: convertLead
 *     summary: Convert a lead into a contact, account, and deal
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
 *             $ref: '#/components/schemas/ConvertLeadRequest'
 *     responses:
 *       201:
 *         description: Lead converted — returns IDs of created records
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Lead not found
 *       409:
 *         description: Lead already converted
 *       422:
 *         description: Lead is Disqualified and cannot be converted
 */
router.post(
  '/:id/convert',
  authenticate,
  requireCapability(Capability.ContactsCreate),
  asyncHandler(convertLeadHandler),
);

// ── GDPR routes (admin only) — MINCRM-364 ─────────────────────────────────────

/** Erase personal data for a lead per GDPR Art. 17. */
router.post('/:id/gdpr-erase', authenticate, requireRole('admin'), asyncHandler(eraseLeadHandler));

/** Export all personal data held for a lead as a JSON download. */
router.get(
  '/:id/gdpr-export',
  authenticate,
  requireRole('admin'),
  asyncHandler(gdprExportLeadHandler),
);

export default router;
