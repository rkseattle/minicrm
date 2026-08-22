/**
 * Contact routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage contacts.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { requireAiTokenBudget } from '../middleware/requireAiTokenBudget.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createContactHandler,
  listContactsHandler,
  getContactHandler,
  updateContactHandler,
  deleteContactHandler,
  listContactDealsHandler,
  exportContactsHandler,
  exportContactsPdfHandler,
  exportContactPdfHandler,
  mergeContactHandler,
  listContactAddressesHandler,
  addContactAddressHandler,
  updateContactAddressHandler,
  deleteContactAddressHandler,
  setDefaultContactAddressHandler,
  sendContactEmailHandler,
} from '../controllers/contactController.js';
import { generateEmailDraftHandler } from '../controllers/emailDraftController.js';
import { enrichContactFromTextHandler } from '../controllers/contactEnrichmentController.js';
import {
  listContactTagsHandler,
  attachContactTagHandler,
  detachContactTagHandler,
} from '../controllers/tagController.js';
import { bulkContactsHandler } from '../controllers/bulkController.js';
import {
  bulkPatchContactsHandler,
  bulkDeleteContactsHandler,
} from '../controllers/bulkV2Controller.js';
import { eraseContactHandler, gdprExportContactHandler } from '../controllers/gdprController.js';
import {
  getContactChampionBlockerHandler,
  dismissContactChampionBlockerHandler,
  overrideContactChampionBlockerHandler,
} from '../controllers/championBlockerController.js';
import { getContactSentimentTrendHandler } from '../controllers/sentimentController.js';
import { getFollowUpTimingHandler } from '../controllers/followUpTimingController.js';
import { getWarmIntroPathsHandler } from '../controllers/warmIntroController.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  enrollContactHandler,
  listContactEnrollmentsHandler,
} from '../controllers/sequenceController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/contacts:
 *   get:
 *     tags: [Contacts]
 *     operationId: listContacts
 *     summary: List contacts
 *     description: >
 *       Returns all contacts. Pass `?owner=me` to scope to the authenticated user's contacts,
 *       or `?owner=my_team` to scope to contacts owned by any member of the user's teams.
 *       Pass `?account=<uuid>` to filter by account.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *           enum: [me, my_team]
 *         description: "'me' returns only the authenticated user's contacts; 'my_team' returns contacts owned by any member of the user's teams"
 *       - in: query
 *         name: account
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter contacts by account ID
 *     responses:
 *       200:
 *         description: Array of contacts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contacts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Contact'
 *             example:
 *               contacts:
 *                 - id: c1d2e3f4-0000-0000-0000-000000000001
 *                   first_name: Jane
 *                   last_name: Smith
 *                   email: jane.smith@acme.com
 *                   phone: '+1-415-555-0192'
 *                   title: VP of Engineering
 *                   department: Engineering
 *                   account_id: a1b2c3d4-0000-0000-0000-000000000001
 *                   owner_id: u1b2c3d4-0000-0000-0000-000000000001
 *                   created_at: '2025-03-15T09:00:00.000Z'
 *                   updated_at: '2025-03-15T09:00:00.000Z'
 *       400:
 *         description: Invalid query parameter (e.g., malformed UUID for ?account=)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: account must be a valid UUID
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/', authenticate, asyncHandler(listContactsHandler));

/**
 * @openapi
 * /api/v1/contacts/export:
 *   get:
 *     tags: [Contacts]
 *     operationId: exportContacts
 *     summary: Export contacts to CSV
 *     description: >
 *       Returns all matching contacts as a UTF-8 CSV file (with BOM).
 *       Reps receive only their own contacts. Admins receive their own contacts
 *       by default; pass `?all=true` to export all contacts.
 *       Accepts the same filter params as the list endpoint (search, accountSearch, account).
 *
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: all
 *         schema:
 *           type: string
 *           enum: ['true']
 *         description: Admin only — pass 'true' to export all contacts regardless of owner
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive substring match on name or email
 *       - in: query
 *         name: accountSearch
 *         schema:
 *           type: string
 *         description: Case-insensitive substring match on linked account name
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
  asyncHandler(exportContactsHandler),
);

/**
 * @openapi
 * /api/v1/contacts/export.pdf:
 *   get:
 *     tags: [Contacts]
 *     operationId: exportContactsPdf
 *     summary: Export contacts to PDF
 *     description: >
 *       Returns all matching contacts as a paginated PDF table, using the same filters
 *       and ownership rules as the CSV export.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: all
 *         schema:
 *           type: string
 *           enum: ['true']
 *         description: Admin only — pass 'true' to export all contacts regardless of owner
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive substring match on name or email
 *       - in: query
 *         name: accountSearch
 *         schema:
 *           type: string
 *         description: Case-insensitive substring match on linked account name
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
  asyncHandler(exportContactsPdfHandler),
);

/**
 * @openapi
 * /api/v1/contacts/bulk:
 *   post:
 *     tags: [Contacts]
 *     operationId: bulkContacts
 *     summary: Bulk reassign or delete contacts
 *     description: >
 *       Performs a bulk action on the specified contact IDs in a single transaction.
 *       Reps may only act on contacts they own; any unowned ID returns 403.
 *       Admins may act on any contacts.
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
 *         description: Rep attempting to act on contacts they do not own
 */
router.post(
  '/bulk',
  authenticate,
  requireCapability(Capability.ContactsCreate),
  asyncHandler(bulkContactsHandler),
);

// ── AI contact auto-enrich from pasted text ────────────────────────

/**
 * @openapi
 * /api/v1/contacts/enrich-from-text:
 *   post:
 *     tags: [Contacts]
 *     operationId: enrichContactFromText
 *     summary: Extract contact fields from pasted text
 *     description: >
 *       Runs AI extraction over pasted freeform text (an email signature, a directory entry)
 *       and returns candidate contact fields for the create form. Not tied to an existing
 *       contact and never persisted — the caller decides what to keep.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [raw_text]
 *             properties:
 *               raw_text:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 5000
 *                 description: Freeform text to extract contact fields from
 *           example:
 *             raw_text: |
 *               Jane Smith
 *               VP of Engineering, Acme Corp
 *               jane.smith@acme.com | +1-415-555-0192
 *     responses:
 *       200:
 *         description: Extracted fields, with a flag when the text was too sparse to use
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 fields:
 *                   type: object
 *                   properties:
 *                     first_name:
 *                       type: string
 *                       nullable: true
 *                     last_name:
 *                       type: string
 *                       nullable: true
 *                     title:
 *                       type: string
 *                       nullable: true
 *                     company_name:
 *                       type: string
 *                       nullable: true
 *                     email:
 *                       type: string
 *                       nullable: true
 *                     phone:
 *                       type: string
 *                       nullable: true
 *                     linkedin_url:
 *                       type: string
 *                       nullable: true
 *                     location:
 *                       type: string
 *                       nullable: true
 *                 matched_account_id:
 *                   type: string
 *                   format: uuid
 *                   nullable: true
 *                   description: Existing account ID when company_name matched an account by name
 *                 insufficient_data:
 *                   type: boolean
 *                   description: True when the AI could not extract enough information to be useful
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: Text to parse is required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature flag ai_contact_enrichment is disabled for this user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FEATURE_DISABLED
 *                 message: Feature not available
 *       429:
 *         description: AI token budget exhausted for the current period
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: AI_BUDGET_EXCEEDED
 *                 message: AI token budget exceeded
 */
/**
 * Extracts contact fields from pasted freeform text on demand. Not tied to an
 * existing contact — used from the create form. Registered before /:id routes
 * so Express does not attempt to match 'enrich-from-text' as a UUID.
 */
router.post(
  '/enrich-from-text',
  authenticate,
  requireFeatureEnabled('ai_contact_enrichment'),
  requireAiTokenBudget,
  asyncHandler(enrichContactFromTextHandler),
);

/**
 * @openapi
 * /api/v1/contacts/bulk:
 *   patch:
 *     tags: [Contacts]
 *     operationId: bulkPatchContacts
 *     summary: Bulk patch contacts — reassign owner
 *     description: >
 *       Reassigns owner_id on each listed contact individually.
 *       Requires bulk:operations + contacts:edit. Non-admin actors can only
 *       act on contacts they own. Max 500 IDs per request.
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
 *                 required: [owner_id]
 *                 properties:
 *                   owner_id:
 *                     type: string
 *                     format: uuid
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
  requireCapability(Capability.ContactsEdit),
  asyncHandler(bulkPatchContactsHandler),
);
/**
 * @openapi
 * /api/v1/contacts/bulk:
 *   delete:
 *     tags: [Contacts]
 *     operationId: bulkDeleteContacts
 *     summary: Bulk delete contacts
 *     description: >
 *       Deletes each listed contact individually.
 *       Requires bulk:operations + contacts:delete. Non-admin actors can only
 *       delete contacts they own. Max 500 IDs per request.
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
  requireCapability(Capability.ContactsDelete),
  asyncHandler(bulkDeleteContactsHandler),
);

/**
 * @openapi
 * /api/v1/contacts:
 *   post:
 *     tags: [Contacts]
 *     operationId: createContact
 *     summary: Create a contact
 *     description: >
 *       Creates a new contact owned by the authenticated user. If a contact with the
 *       same email already exists, a warning is included in the response (not blocked).
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateContactRequest'
 *           example:
 *             first_name: Jane
 *             last_name: Smith
 *             email: jane.smith@acme.com
 *             phone: '+1-415-555-0192'
 *             title: VP of Engineering
 *             department: Engineering
 *             account_id: a1b2c3d4-0000-0000-0000-000000000001
 *     responses:
 *       201:
 *         description: Contact created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contact:
 *                   $ref: '#/components/schemas/Contact'
 *             example:
 *               contact:
 *                 id: c1d2e3f4-0000-0000-0000-000000000001
 *                 first_name: Jane
 *                 last_name: Smith
 *                 email: jane.smith@acme.com
 *                 phone: '+1-415-555-0192'
 *                 title: VP of Engineering
 *                 department: Engineering
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
 *                 message: Must be a valid email address
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post(
  '/',
  authenticate,
  requireCapability(Capability.ContactsCreate),
  asyncHandler(createContactHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}:
 *   get:
 *     tags: [Contacts]
 *     operationId: getContact
 *     summary: Get a contact by ID
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Contact found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contact:
 *                   $ref: '#/components/schemas/Contact'
 *             example:
 *               contact:
 *                 id: c1d2e3f4-0000-0000-0000-000000000001
 *                 first_name: Jane
 *                 last_name: Smith
 *                 email: jane.smith@acme.com
 *                 phone: '+1-415-555-0192'
 *                 title: VP of Engineering
 *                 department: Engineering
 *                 account_id: a1b2c3d4-0000-0000-0000-000000000001
 *                 owner_id: u1b2c3d4-0000-0000-0000-000000000001
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *                 updated_at: '2025-03-15T09:00:00.000Z'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
router.get('/:id', authenticate, asyncHandler(getContactHandler));

/**
 * @openapi
 * /api/v1/contacts/{id}/export.pdf:
 *   get:
 *     tags: [Contacts]
 *     operationId: exportContactPdf
 *     summary: Export a single contact to PDF
 *     description: >
 *       Returns a one-record summary PDF for the given contact — overview fields,
 *       custom fields, linked deals, and notes. Visibility matches
 *       GET /api/v1/contacts/{id}.
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
 *         description: Contact not found
 */
router.get(
  '/:id/export.pdf',
  authenticate,
  requireFeatureEnabled('csv_export'),
  asyncHandler(exportContactPdfHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}:
 *   patch:
 *     tags: [Contacts]
 *     operationId: updateContact
 *     summary: Update a contact
 *     description: >
 *       Updates one or more fields of an existing contact.
 *       Reps may only update contacts they own; admins may update any contact.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateContactRequest'
 *           example:
 *             title: CTO
 *             phone: '+1-415-555-0199'
 *     responses:
 *       200:
 *         description: Contact updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contact:
 *                   $ref: '#/components/schemas/Contact'
 *             example:
 *               contact:
 *                 id: c1d2e3f4-0000-0000-0000-000000000001
 *                 first_name: Jane
 *                 last_name: Smith
 *                 email: jane.smith@acme.com
 *                 phone: '+1-415-555-0199'
 *                 title: CTO
 *                 department: Engineering
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
 *                 message: Must be a valid email address
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Rep attempting to update a contact they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have permission to update this contact
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
router.patch(
  '/:id',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(updateContactHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}:
 *   delete:
 *     tags: [Contacts]
 *     operationId: deleteContact
 *     summary: Delete a contact
 *     description: >
 *       Deletes a contact. Reps may only delete contacts they own; admins may
 *       delete any contact.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       204:
 *         description: Contact deleted (no content)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Rep attempting to delete a contact they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have permission to delete this contact
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
router.delete(
  '/:id',
  authenticate,
  requireCapability(Capability.ContactsDelete),
  asyncHandler(deleteContactHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}/deals:
 *   get:
 *     tags: [Contacts]
 *     operationId: listContactDeals
 *     summary: List deals linked to a contact
 *     description: >
 *       Returns all deals associated with this contact via the deal_contacts join table.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Array of deals linked to this contact
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
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
router.get('/:id/deals', authenticate, asyncHandler(listContactDealsHandler));

/**
 * @openapi
 * /api/v1/contacts/{id}/merge:
 *   post:
 *     tags: [Contacts]
 *     operationId: mergeContacts
 *     summary: Merge two contact records
 *     description: >
 *       Atomically merges the loser contact into the winner (identified by :id).
 *       Activities and deals are re-linked to the winner; the loser is deleted.
 *       Only admins and the winner's owner may perform a merge.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the winner contact
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [loserId]
 *             properties:
 *               loserId:
 *                 type: string
 *                 format: uuid
 *               fieldChoices:
 *                 type: object
 *                 description: Per-field choice of 'winner' or 'loser' value to keep
 *     responses:
 *       200:
 *         description: Merged contact (the winner)
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Contact not found
 */
router.post(
  '/:id/merge',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(mergeContactHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}/send-email:
 *   post:
 *     tags: [Contacts]
 *     operationId: sendContactEmail
 *     summary: Send an email to a contact
 *     description: >
 *       Sends a user-composed email to the contact's email address via the configured SMTP
 *       transport and logs an Email activity against the contact.
 *       If SMTP is not configured, the email is not delivered but the activity is still logged
 *       and the response returns delivered: false rather than an error.
 *       Returns 400 if the contact has no email address.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, body]
 *             properties:
 *               subject:
 *                 type: string
 *                 maxLength: 255
 *               body:
 *                 type: string
 *               deal_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional deal to link the logged activity to
 *           example:
 *             subject: Following up on our last call
 *             body: Hi Jane, just wanted to touch base...
 *     responses:
 *       200:
 *         description: Email sent (or logged only when SMTP is not configured)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 delivered:
 *                   type: boolean
 *                 activityId:
 *                   type: string
 *                   format: uuid
 *                   nullable: true
 *       400:
 *         description: Validation error or contact has no email address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  '/:id/send-email',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(sendContactEmailHandler),
);

// ── Contact Address Routes ─────────────────────────────────────────────────────

/**
 * @openapi
 * /api/v1/contacts/{id}/addresses:
 *   get:
 *     tags: [Contacts]
 *     operationId: listContactAddresses
 *     summary: List addresses for a contact
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Array of addresses for this contact
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 addresses:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       contact_id:
 *                         type: string
 *                         format: uuid
 *                       label:
 *                         type: string
 *                         nullable: true
 *                       address_line1:
 *                         type: string
 *                         nullable: true
 *                       address_line2:
 *                         type: string
 *                         nullable: true
 *                       city:
 *                         type: string
 *                         nullable: true
 *                       state_region:
 *                         type: string
 *                         nullable: true
 *                       postal_code:
 *                         type: string
 *                         nullable: true
 *                       country:
 *                         type: string
 *                         nullable: true
 *                       is_default:
 *                         type: boolean
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
/** List all addresses for a contact. */
router.get('/:id/addresses', authenticate, asyncHandler(listContactAddressesHandler));

/**
 * @openapi
 * /api/v1/contacts/{id}/addresses:
 *   post:
 *     tags: [Contacts]
 *     operationId: addContactAddress
 *     summary: Add an address to a contact
 *     description: >
 *       Adds an address to the contact. Setting is_default demotes the contact's
 *       previously default address.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *                 maxLength: 50
 *               address_line1:
 *                 type: string
 *                 maxLength: 255
 *               address_line2:
 *                 type: string
 *                 maxLength: 255
 *               city:
 *                 type: string
 *                 maxLength: 100
 *               state_region:
 *                 type: string
 *                 maxLength: 100
 *               postal_code:
 *                 type: string
 *                 maxLength: 20
 *               country:
 *                 type: string
 *                 maxLength: 100
 *               is_default:
 *                 type: boolean
 *           example:
 *             label: HQ
 *             address_line1: 100 Market St
 *             city: San Francisco
 *             state_region: CA
 *             postal_code: '94105'
 *             country: USA
 *             is_default: true
 *     responses:
 *       201:
 *         description: Address created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     contact_id:
 *                       type: string
 *                       format: uuid
 *                     label:
 *                       type: string
 *                       nullable: true
 *                     address_line1:
 *                       type: string
 *                       nullable: true
 *                     address_line2:
 *                       type: string
 *                       nullable: true
 *                     city:
 *                       type: string
 *                       nullable: true
 *                     state_region:
 *                       type: string
 *                       nullable: true
 *                     postal_code:
 *                       type: string
 *                       nullable: true
 *                     country:
 *                       type: string
 *                       nullable: true
 *                     is_default:
 *                       type: boolean
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: label must be 50 characters or fewer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller lacks the required capability
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: AUTH_FORBIDDEN
 *                 message: Insufficient permissions
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
/** Add a new address to a contact. */
router.post(
  '/:id/addresses',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(addContactAddressHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}/addresses/{addressId}:
 *   patch:
 *     tags: [Contacts]
 *     operationId: updateContactAddress
 *     summary: Update a contact address
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact address ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *                 maxLength: 50
 *               address_line1:
 *                 type: string
 *                 maxLength: 255
 *               address_line2:
 *                 type: string
 *                 maxLength: 255
 *               city:
 *                 type: string
 *                 maxLength: 100
 *               state_region:
 *                 type: string
 *                 maxLength: 100
 *               postal_code:
 *                 type: string
 *                 maxLength: 20
 *               country:
 *                 type: string
 *                 maxLength: 100
 *               is_default:
 *                 type: boolean
 *           example:
 *             city: Oakland
 *             postal_code: '94607'
 *     responses:
 *       200:
 *         description: Address updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     contact_id:
 *                       type: string
 *                       format: uuid
 *                     label:
 *                       type: string
 *                       nullable: true
 *                     address_line1:
 *                       type: string
 *                       nullable: true
 *                     address_line2:
 *                       type: string
 *                       nullable: true
 *                     city:
 *                       type: string
 *                       nullable: true
 *                     state_region:
 *                       type: string
 *                       nullable: true
 *                     postal_code:
 *                       type: string
 *                       nullable: true
 *                     country:
 *                       type: string
 *                       nullable: true
 *                     is_default:
 *                       type: boolean
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: city must be 100 characters or fewer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller lacks the required capability
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: AUTH_FORBIDDEN
 *                 message: Insufficient permissions
 *       404:
 *         description: Address not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Address not found
 */
/** Update a contact address. */
router.patch(
  '/:id/addresses/:addressId',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(updateContactAddressHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}/addresses/{addressId}:
 *   delete:
 *     tags: [Contacts]
 *     operationId: deleteContactAddress
 *     summary: Delete a contact address
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact address ID
 *     responses:
 *       204:
 *         description: Address deleted (no content)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller lacks the required capability
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: AUTH_FORBIDDEN
 *                 message: Insufficient permissions
 *       404:
 *         description: Address not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Address not found
 */
/** Delete a contact address. */
router.delete(
  '/:id/addresses/:addressId',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(deleteContactAddressHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}/addresses/{addressId}/set-default:
 *   post:
 *     tags: [Contacts]
 *     operationId: setDefaultContactAddress
 *     summary: Set a contact address as the default
 *     description: >
 *       Marks the address as the contact's default, demoting whichever address held
 *       that position before.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact address ID
 *     responses:
 *       200:
 *         description: Address is now the default
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     contact_id:
 *                       type: string
 *                       format: uuid
 *                     label:
 *                       type: string
 *                       nullable: true
 *                     address_line1:
 *                       type: string
 *                       nullable: true
 *                     address_line2:
 *                       type: string
 *                       nullable: true
 *                     city:
 *                       type: string
 *                       nullable: true
 *                     state_region:
 *                       type: string
 *                       nullable: true
 *                     postal_code:
 *                       type: string
 *                       nullable: true
 *                     country:
 *                       type: string
 *                       nullable: true
 *                     is_default:
 *                       type: boolean
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller lacks the required capability
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: AUTH_FORBIDDEN
 *                 message: Insufficient permissions
 *       404:
 *         description: Address not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Address not found
 */
/** Set a contact address as the default. */
router.post(
  '/:id/addresses/:addressId/set-default',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(setDefaultContactAddressHandler),
);

// ── Contact Tag Routes ───────────────────────────────────────────

/**
 * @openapi
 * /api/v1/contacts/{id}/tags:
 *   get:
 *     tags: [Contacts]
 *     operationId: listContactTags
 *     summary: List tags on a contact
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Array of tags attached to this contact
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
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       updated_at:
 *                         type: string
 *                         format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature flag tags is disabled for this user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FEATURE_DISABLED
 *                 message: Feature not available
 */
/** List all tags on a contact. */
router.get(
  '/:id/tags',
  authenticate,
  requireFeatureEnabled('tags'),
  asyncHandler(listContactTagsHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}/tags:
 *   post:
 *     tags: [Contacts]
 *     operationId: attachContactTag
 *     summary: Attach a tag to a contact
 *     description: >
 *       Attaches a tag by name, creating the tag if it does not already exist.
 *       Names are trimmed and lowercased before matching.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
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
 *                 minLength: 1
 *                 maxLength: 100
 *           example:
 *             name: decision-maker
 *     responses:
 *       201:
 *         description: Tag attached
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
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     updated_at:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: Tag name is required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature flag tags is disabled for this user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FEATURE_DISABLED
 *                 message: Feature not available
 */
/** Attach a tag to a contact by name, creating the tag if it does not exist. */
router.post(
  '/:id/tags',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  requireFeatureEnabled('tags'),
  asyncHandler(attachContactTagHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}/tags/{tagId}:
 *   delete:
 *     tags: [Contacts]
 *     operationId: detachContactTag
 *     summary: Detach a tag from a contact
 *     description: >
 *       Removes the tag from the contact. The tag itself is not deleted.
 *       Succeeds whether or not the tag was attached.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *       - in: path
 *         name: tagId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Tag ID
 *     responses:
 *       204:
 *         description: Tag detached (no content)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature flag tags is disabled for this user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FEATURE_DISABLED
 *                 message: Feature not available
 */
/** Detach a tag from a contact. */
router.delete(
  '/:id/tags/:tagId',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  requireFeatureEnabled('tags'),
  asyncHandler(detachContactTagHandler),
);

// ── Sequence enrollment routes ────────────────────────────────────

/**
 * @openapi
 * /api/v1/contacts/{id}/sequence-enrollments:
 *   post:
 *     tags: [Contacts]
 *     operationId: enrollContact
 *     summary: Enroll a contact in a sequence
 *     description: >
 *       Enrolls the contact in the given sales sequence and schedules its first step.
 *       A contact may hold only one active enrollment per sequence.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sequence_id]
 *             properties:
 *               sequence_id:
 *                 type: string
 *                 format: uuid
 *           example:
 *             sequence_id: 5e6f7a8b-0000-0000-0000-000000000001
 *     responses:
 *       201:
 *         description: Contact enrolled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enrollment:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     sequence_id:
 *                       type: string
 *                       format: uuid
 *                     contact_id:
 *                       type: string
 *                       format: uuid
 *                     status:
 *                       type: string
 *                     current_step:
 *                       type: integer
 *                     next_run_at:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: sequence_id missing, or the sequence has no steps
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: SEQUENCE_HAS_NO_STEPS
 *                 message: Sequence has no steps
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature flag sequencing is disabled for this user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FEATURE_DISABLED
 *                 message: Feature not available
 *       404:
 *         description: Sequence not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: SEQUENCE_NOT_FOUND
 *                 message: Sequence not found
 *       409:
 *         description: Sequence is disabled, or the contact is already enrolled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: ENROLLMENT_DUPLICATE
 *                 message: Contact is already enrolled in this sequence
 */
/** Enroll a contact in a sales sequence. */
router.post(
  '/:id/sequence-enrollments',
  authenticate,
  requireCapability(Capability.SequencesEnroll),
  requireFeatureEnabled('sequencing'),
  asyncHandler(enrollContactHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}/sequence-enrollments:
 *   get:
 *     tags: [Contacts]
 *     operationId: listContactEnrollments
 *     summary: List sequence enrollments for a contact
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Array of enrollments for this contact
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enrollments:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       sequence_id:
 *                         type: string
 *                         format: uuid
 *                       contact_id:
 *                         type: string
 *                         format: uuid
 *                       status:
 *                         type: string
 *                       current_step:
 *                         type: integer
 *                       next_run_at:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature flag sequencing is disabled for this user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FEATURE_DISABLED
 *                 message: Feature not available
 */
/** List all sequence enrollments for a contact. */
router.get(
  '/:id/sequence-enrollments',
  authenticate,
  requireCapability(Capability.SequencesEnroll),
  requireFeatureEnabled('sequencing'),
  asyncHandler(listContactEnrollmentsHandler),
);

// ── GDPR routes (admin only) ─────────────────────────────────────

/**
 * @openapi
 * /api/v1/contacts/{id}/gdpr-erase:
 *   post:
 *     tags: [Contacts]
 *     operationId: eraseContact
 *     summary: Erase a contact's personal data
 *     description: >
 *       Irreversibly erases personal data held for the contact under GDPR Art. 17,
 *       recording an audit trail of the request. Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *                 description: Optional free text recorded with the erasure record
 *     responses:
 *       200:
 *         description: Personal data erased
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 erasedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: id must be a valid UUID
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: AUTH_FORBIDDEN
 *                 message: Insufficient permissions
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 *       409:
 *         description: Contact has already been erased
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: GDPR_ALREADY_ERASED
 *                 message: This contact has already been erased under GDPR Art. 17
 */
/** Erase personal data for a contact per GDPR Art. 17. */
router.post(
  '/:id/gdpr-erase',
  authenticate,
  requireRole('admin'),
  asyncHandler(eraseContactHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}/gdpr-export:
 *   get:
 *     tags: [Contacts]
 *     operationId: gdprExportContact
 *     summary: Export a contact's personal data
 *     description: >
 *       Returns every piece of personal data held for the contact as a JSON file
 *       download, for GDPR Art. 15 subject access requests. Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: JSON file download of all personal data held for the contact
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: Contact record plus its related activities, notes, and audit history
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: id must be a valid UUID
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller is not an admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: AUTH_FORBIDDEN
 *                 message: Insufficient permissions
 */
/** Export all personal data held for a contact as a JSON download. */
router.get(
  '/:id/gdpr-export',
  authenticate,
  requireRole('admin'),
  asyncHandler(gdprExportContactHandler),
);

// ── AI champion/blocker detection ──────────────────────────────────

/**
 * @openapi
 * /api/v1/contacts/{id}/champion-blocker:
 *   get:
 *     tags: [Contacts]
 *     operationId: getContactChampionBlocker
 *     summary: Get a contact's champion/blocker classification
 *     description: >
 *       Returns the effective classification — the rep's override when one is set,
 *       otherwise the AI-inferred status — with the signals that drove it.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Effective champion/blocker classification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contact_id:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [champion, likely_champion, neutral, likely_blocker, blocker]
 *                 is_overridden:
 *                   type: boolean
 *                   description: True when the effective status came from a rep override rather than AI inference
 *                 recent_signals:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       description:
 *                         type: string
 *                       detected_at:
 *                         type: string
 *                         format: date-time
 *                 dismissed:
 *                   type: boolean
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Feature flag ai_champion_blocker_detection is disabled for this user (FEATURE_DISABLED),
 *           or the caller has no visibility into this record (FORBIDDEN).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have visibility into this record.
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
/** Returns the effective champion/blocker classification for the contact. */
router.get(
  '/:id/champion-blocker',
  authenticate,
  requireFeatureEnabled('ai_champion_blocker_detection'),
  asyncHandler(getContactChampionBlockerHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}/champion-blocker/dismiss:
 *   post:
 *     tags: [Contacts]
 *     operationId: dismissContactChampionBlocker
 *     summary: Dismiss a champion/blocker classification
 *     description: >
 *       Records the rep's "Not accurate" feedback, suppressing the badge until new
 *       signals arrive. Returns the refreshed classification.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Classification after the dismissal
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contact_id:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [champion, likely_champion, neutral, likely_blocker, blocker]
 *                 is_overridden:
 *                   type: boolean
 *                   description: True when the effective status came from a rep override rather than AI inference
 *                 recent_signals:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       description:
 *                         type: string
 *                       detected_at:
 *                         type: string
 *                         format: date-time
 *                 dismissed:
 *                   type: boolean
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Feature flag ai_champion_blocker_detection is disabled for this user (FEATURE_DISABLED),
 *           or the caller has no visibility into this record (FORBIDDEN).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have visibility into this record.
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
/** Records a rep's "Not accurate" feedback, suppressing the badge until new signals arrive. */
router.post(
  '/:id/champion-blocker/dismiss',
  authenticate,
  requireFeatureEnabled('ai_champion_blocker_detection'),
  asyncHandler(dismissContactChampionBlockerHandler),
);

/**
 * @openapi
 * /api/v1/contacts/{id}/champion-blocker/override:
 *   patch:
 *     tags: [Contacts]
 *     operationId: overrideContactChampionBlocker
 *     summary: Override a champion/blocker classification
 *     description: >
 *       Records a rep's manual classification, which takes precedence over the
 *       AI-inferred status until it is changed again.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [champion, likely_champion, neutral, likely_blocker, blocker]
 *               reason:
 *                 type: string
 *                 maxLength: 1000
 *                 nullable: true
 *           example:
 *             status: champion
 *             reason: Introduced us to their VP and pushed the deal internally
 *     responses:
 *       200:
 *         description: Classification after the override
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contact_id:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [champion, likely_champion, neutral, likely_blocker, blocker]
 *                 is_overridden:
 *                   type: boolean
 *                   description: True when the effective status came from a rep override rather than AI inference
 *                 recent_signals:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       description:
 *                         type: string
 *                       detected_at:
 *                         type: string
 *                         format: date-time
 *                 dismissed:
 *                   type: boolean
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: Invalid enum value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Feature flag ai_champion_blocker_detection is disabled for this user (FEATURE_DISABLED),
 *           or the caller has no visibility into this record (FORBIDDEN).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have visibility into this record.
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
/** Records a rep's manual override, with an optional reason. */
router.patch(
  '/:id/champion-blocker/override',
  authenticate,
  requireFeatureEnabled('ai_champion_blocker_detection'),
  asyncHandler(overrideContactChampionBlockerHandler),
);

// ── AI sentiment tracking ──────────────────────────────────────────

/**
 * @openapi
 * /api/v1/contacts/{id}/sentiment-trend:
 *   get:
 *     tags: [Contacts]
 *     operationId: getContactSentimentTrend
 *     summary: Get a contact's sentiment trend
 *     description: >
 *       Returns the AI sentiment scores for the contact's most recent interactions,
 *       with the overall direction of travel. trend is null until there is enough data.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Sentiment trend for the contact's recent interactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contact_id:
 *                   type: string
 *                   format: uuid
 *                 trend:
 *                   type: string
 *                   nullable: true
 *                   description: Overall direction of travel, or null when there is insufficient data
 *                 has_sufficient_data:
 *                   type: boolean
 *                 points:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       activity_id:
 *                         type: string
 *                         format: uuid
 *                       sentiment:
 *                         type: string
 *                       flagged_inaccurate:
 *                         type: boolean
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Feature flag ai_sentiment_tracking is disabled for this user (FEATURE_DISABLED),
 *           or the caller has no visibility into this contact (FORBIDDEN).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have visibility into this contact.
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
/** Returns the sentiment trend for the contact's last 10 interactions. */
router.get(
  '/:id/sentiment-trend',
  authenticate,
  requireFeatureEnabled('ai_sentiment_tracking'),
  asyncHandler(getContactSentimentTrendHandler),
);

// ── AI smart follow-up timing suggestions ──────────────────────────

/**
 * @openapi
 * /api/v1/contacts/{id}/followup-timing:
 *   get:
 *     tags: [Contacts]
 *     operationId: getFollowUpTiming
 *     summary: Get the best time to contact a contact
 *     description: >
 *       Returns the suggested day-of-week and hour window to reach the contact,
 *       derived from when they have historically responded. suggestion is null when
 *       there are too few interactions to infer a pattern.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Suggested contact window, or null when there is insufficient data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 suggestion:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     contact_id:
 *                       type: string
 *                       format: uuid
 *                     day_of_week:
 *                       type: integer
 *                       description: 0 (Sunday) through 6 (Saturday)
 *                     hour_start:
 *                       type: integer
 *                     hour_end:
 *                       type: integer
 *                     timezone:
 *                       type: string
 *                     sample_size:
 *                       type: integer
 *                     computed_at:
 *                       type: string
 *                       format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Feature flag ai_followup_timing_suggestions is disabled for this user (FEATURE_DISABLED),
 *           or the caller has no visibility into this contact (FORBIDDEN).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have visibility into this contact.
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
/** Returns the best-time-to-contact suggestion for the contact, or null when insufficient data. */
router.get(
  '/:id/followup-timing',
  authenticate,
  requireFeatureEnabled('ai_followup_timing_suggestions'),
  asyncHandler(getFollowUpTimingHandler),
);

// ── AI warm introduction path mapping ──────────────────────────────

/**
 * @openapi
 * /api/v1/contacts/{id}/warm-paths:
 *   get:
 *     tags: [Contacts]
 *     operationId: getWarmIntroPaths
 *     summary: Get warm introduction paths to a contact
 *     description: >
 *       Returns ranked introduction paths reaching the contact through the rep's own
 *       network, strongest first, each with a suggested opening message.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Ranked warm introduction paths
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 target_contact_id:
 *                   type: string
 *                   format: uuid
 *                 paths:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       links:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             contact_id:
 *                               type: string
 *                               format: uuid
 *                             first_name:
 *                               type: string
 *                             last_name:
 *                               type: string
 *                             title:
 *                               type: string
 *                               nullable: true
 *                             relationship_strength:
 *                               type: number
 *                       path_strength:
 *                         type: number
 *                       suggested_introduction_message:
 *                         type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Feature flag ai_warm_intro_path is disabled for this user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FEATURE_DISABLED
 *                 message: Feature not available
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 */
/** Returns ranked warm introduction paths to the contact through the rep's own network. */
router.get(
  '/:id/warm-paths',
  authenticate,
  requireFeatureEnabled('ai_warm_intro_path'),
  asyncHandler(getWarmIntroPathsHandler),
);

// ── AI email draft generation ──────────────────────────────────────

/**
 * @openapi
 * /api/v1/contacts/{id}/email-draft:
 *   post:
 *     tags: [Contacts]
 *     operationId: generateEmailDraft
 *     summary: Generate an AI follow-up email draft
 *     description: >
 *       Generates a first-draft follow-up email to the contact in the requested tone.
 *       The draft is not persisted — call again to regenerate with a different tone.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tone:
 *                 type: string
 *                 enum: [Professional, Friendly, Concise]
 *                 default: Professional
 *           example:
 *             tone: Friendly
 *     responses:
 *       200:
 *         description: Generated draft
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 subject:
 *                   type: string
 *                 body:
 *                   type: string
 *                 tone:
 *                   type: string
 *                   enum: [Professional, Friendly, Concise]
 *                 generated_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: Invalid enum value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: >
 *           Feature flag ai_email_draft is disabled for this user (FEATURE_DISABLED),
 *           or the caller has no visibility into this contact (FORBIDDEN).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have visibility into this contact.
 *       404:
 *         description: Contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Contact not found
 *       429:
 *         description: AI token budget exhausted for the current period
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: AI_BUDGET_EXCEEDED
 *                 message: AI token budget exceeded
 *       502:
 *         description: The AI provider returned an error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: AI_PROVIDER_ERROR
 *                 message: AI provider request failed
 *       503:
 *         description: No AI provider is configured
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: AI_NOT_CONFIGURED
 *                 message: AI features are not configured
 */
/** Generates an on-demand AI first-draft follow-up email for the contact. */
router.post(
  '/:id/email-draft',
  authenticate,
  requireFeatureEnabled('ai_email_draft'),
  requireAiTokenBudget,
  asyncHandler(generateEmailDraftHandler),
);

export default router;
