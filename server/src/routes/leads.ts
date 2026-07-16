/**
 * Lead routes — all endpoints require authentication.
 * (MINCRM-173, MINCRM-174, MINCRM-175)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRole, requireCapability } from '../middleware/requireRole.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { requireAiTokenBudget } from '../middleware/requireAiTokenBudget.js';
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
  exportLeadPdfHandler,
  exportLeadsHandler,
  exportLeadsPdfHandler,
  getLeadRoutingSuggestionHandler,
} from '../controllers/leadsController.js';
import { eraseLeadHandler, gdprExportLeadHandler } from '../controllers/gdprController.js';
import { bulkPatchLeadsHandler, bulkDeleteLeadsHandler } from '../controllers/bulkV2Controller.js';
import { getLeadScoreHandler } from '../controllers/leadScoreController.js';
import { generateLeadScoreNarrativeHandler } from '../controllers/leadScoreNarrativeController.js';

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
 * /api/v1/leads/routing-suggestion:
 *   post:
 *     tags: [Leads]
 *     operationId: getLeadRoutingSuggestion
 *     summary: Compute an AI routing suggestion for a draft lead, before it is created
 *     description: >
 *       Deterministic weighted-factor scoring (territory alignment, industry match,
 *       workload, historical win rate, availability) — no AI provider call, runs
 *       well within the 3-second budget. Returns 204 (no body) when confidence
 *       would be low, per the AC: the suggestion is suppressed and the client
 *       should default the assignee field to unassigned. Gated by the
 *       ai_lead_routing_suggestion feature flag (including any per-team override).
 *       (MINCRM-475)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               territory: { type: string }
 *               industry: { type: string }
 *               employee_range: { type: string }
 *               lead_source: { type: string }
 *     responses:
 *       200:
 *         description: Routing suggestion computed
 *       204:
 *         description: No confident suggestion available
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: The ai_lead_routing_suggestion flag is disabled (globally or for the caller's team)
 */
router.post(
  '/routing-suggestion',
  authenticate,
  requireFeatureEnabled('ai_lead_routing_suggestion'),
  asyncHandler(getLeadRoutingSuggestionHandler),
);

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

// ── Bulk V2 routes (MINCRM-562) — must be registered before /:id routes ───────

/**
 * @openapi
 * /api/v1/leads/bulk:
 *   patch:
 *     tags: [Leads]
 *     operationId: bulkPatchLeads
 *     summary: Bulk patch leads — reassign owner (MINCRM-562)
 *     description: >
 *       Requires bulk:operations + contacts:edit. Non-admin actors can only
 *       reassign leads they own; records outside visibility are reported in
 *       failed[]. Always returns 200 with { succeeded, failed }.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Bulk patch result
 *       400:
 *         description: Validation error or ids over limit
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Missing bulk:operations or contacts:edit capability
 */
router.patch(
  '/bulk',
  authenticate,
  requireCapability(Capability.BulkOperations),
  requireCapability(Capability.ContactsEdit),
  asyncHandler(bulkPatchLeadsHandler),
);

/**
 * @openapi
 * /api/v1/leads/bulk:
 *   delete:
 *     tags: [Leads]
 *     operationId: bulkDeleteLeads
 *     summary: Bulk delete leads (MINCRM-562)
 *     description: >
 *       Requires bulk:operations + contacts:delete. Non-admin actors can only
 *       delete leads they own; records outside visibility are reported in
 *       failed[]. Always returns 200 with { succeeded, failed }.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Bulk delete result
 *       400:
 *         description: Validation error or ids over limit
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Missing bulk:operations or contacts:delete capability
 */
router.delete(
  '/bulk',
  authenticate,
  requireCapability(Capability.BulkOperations),
  requireCapability(Capability.ContactsDelete),
  asyncHandler(bulkDeleteLeadsHandler),
);

/**
 * @openapi
 * /api/v1/leads/export:
 *   get:
 *     tags: [Leads]
 *     operationId: exportLeads
 *     summary: Export leads as CSV
 *     description: >
 *       Streams all leads matching the given filters as a UTF-8 CSV file. Query
 *       params mirror GET /api/v1/leads (owner, status, lead_source,
 *       includeDisqualified, includeConverted) except pagination/sort — all
 *       matching rows are exported. Reps get leads visible to them per the
 *       owner param; admins may pass ?all=true to export every lead. (MINCRM-651)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *           enum: [me, my_team]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: lead_source
 *         schema:
 *           type: string
 *       - in: query
 *         name: includeDisqualified
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: includeConverted
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: all
 *         schema:
 *           type: boolean
 *         description: Admin only — pass 'true' to export all leads
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
  asyncHandler(exportLeadsHandler),
);

/**
 * @openapi
 * /api/v1/leads/export.pdf:
 *   get:
 *     tags: [Leads]
 *     operationId: exportLeadsPdf
 *     summary: Export leads as a paginated PDF table
 *     description: >
 *       Renders all leads matching the given filters as a paginated PDF table.
 *       Query params and ownership rules are identical to the CSV export. (MINCRM-651)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *           enum: [me, my_team]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: lead_source
 *         schema:
 *           type: string
 *       - in: query
 *         name: includeDisqualified
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: includeConverted
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: all
 *         schema:
 *           type: boolean
 *         description: Admin only — pass 'true' to export all leads
 *     responses:
 *       200:
 *         description: PDF file download
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Not authenticated
 */
router.get(
  '/export.pdf',
  authenticate,
  requireFeatureEnabled('csv_export'),
  asyncHandler(exportLeadsPdfHandler),
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
 * /api/v1/leads/{id}/export.pdf:
 *   get:
 *     tags: [Leads]
 *     operationId: exportLeadPdf
 *     summary: Export a single lead to PDF
 *     description: >
 *       Returns a one-record summary PDF for the given lead — overview fields
 *       and notes. Visibility matches GET /api/v1/leads/{id}. (MINCRM-650)
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
 *         description: Not authenticated
 *       404:
 *         description: Lead not found
 */
router.get(
  '/:id/export.pdf',
  authenticate,
  requireFeatureEnabled('csv_export'),
  asyncHandler(exportLeadPdfHandler),
);

/**
 * @openapi
 * /api/v1/leads/{id}/score:
 *   get:
 *     tags: [Leads]
 *     operationId: getLeadScore
 *     summary: Compute a rule-based quality score for the lead (MINCRM-441 prerequisite)
 *     description: >
 *       Computes an on-demand deterministic 0-100 quality score from lead
 *       source, status, recency, and post-conversion engagement. Not
 *       persisted — recomputed on every request.
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
 *         description: Score computed
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Lead not found
 */
router.get(
  '/:id/score',
  authenticate,
  requireFeatureEnabled('ai_lead_scoring'),
  asyncHandler(getLeadScoreHandler),
);

/**
 * @openapi
 * /api/v1/leads/{id}/score-narrative:
 *   post:
 *     tags: [Leads]
 *     operationId: generateLeadScoreNarrative
 *     summary: Explain a lead's quality score in plain English (MINCRM-441)
 *     description: >
 *       Runs an on-demand AI narrative explanation of the lead's rule-based
 *       quality score. Not persisted — regenerated on every request.
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
 *         description: Narrative generated
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Lead not found
 *       502:
 *         description: AI provider error
 *       503:
 *         description: AI is not configured
 */
router.post(
  '/:id/score-narrative',
  authenticate,
  requireFeatureEnabled('ai_lead_score_narrative'),
  requireAiTokenBudget,
  asyncHandler(generateLeadScoreNarrativeHandler),
);

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
