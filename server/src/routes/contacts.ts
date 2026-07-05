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
  mergeContactHandler,
  listContactAddressesHandler,
  addContactAddressHandler,
  updateContactAddressHandler,
  deleteContactAddressHandler,
  setDefaultContactAddressHandler,
  sendContactEmailHandler,
} from '../controllers/contactController.js';
import { generateEmailDraftHandler } from '../controllers/emailDraftController.js';
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
 *         description: "'me' returns only the authenticated user's contacts; 'my_team' returns contacts owned by any member of the user's teams (MINCRM-545)"
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
 *       (MINCRM-164)
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
 *         description: Not authenticated
 */
router.get(
  '/export',
  authenticate,
  requireFeatureEnabled('csv_export'),
  asyncHandler(exportContactsHandler),
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
 *         description: Rep attempting to act on contacts they do not own
 */
router.post(
  '/bulk',
  authenticate,
  requireCapability(Capability.ContactsCreate),
  asyncHandler(bulkContactsHandler),
);

/**
 * @openapi
 * /api/v1/contacts/bulk:
 *   patch:
 *     tags: [Contacts]
 *     operationId: bulkPatchContacts
 *     summary: Bulk patch contacts — reassign owner (MINCRM-562)
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
 *     summary: Bulk delete contacts (MINCRM-562)
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
 *       Returns 400 if the contact has no email address. (MINCRM-275)
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
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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

/** List all addresses for a contact. */
router.get('/:id/addresses', authenticate, asyncHandler(listContactAddressesHandler));

/** Add a new address to a contact. */
router.post(
  '/:id/addresses',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(addContactAddressHandler),
);

/** Update a contact address. */
router.patch(
  '/:id/addresses/:addressId',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(updateContactAddressHandler),
);

/** Delete a contact address. */
router.delete(
  '/:id/addresses/:addressId',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(deleteContactAddressHandler),
);

/** Set a contact address as the default. */
router.post(
  '/:id/addresses/:addressId/set-default',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  asyncHandler(setDefaultContactAddressHandler),
);

// ── Contact Tag Routes (MINCRM-186) ───────────────────────────────────────────

/** List all tags on a contact. */
router.get(
  '/:id/tags',
  authenticate,
  requireFeatureEnabled('tags'),
  asyncHandler(listContactTagsHandler),
);

/** Attach a tag to a contact by name, creating the tag if it does not exist. */
router.post(
  '/:id/tags',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  requireFeatureEnabled('tags'),
  asyncHandler(attachContactTagHandler),
);

/** Detach a tag from a contact. */
router.delete(
  '/:id/tags/:tagId',
  authenticate,
  requireCapability(Capability.ContactsEdit),
  requireFeatureEnabled('tags'),
  asyncHandler(detachContactTagHandler),
);

// ── Sequence enrollment routes (MINCRM-403) ────────────────────────────────────

/** Enroll a contact in a sales sequence. */
router.post(
  '/:id/sequence-enrollments',
  authenticate,
  requireCapability(Capability.SequencesEnroll),
  requireFeatureEnabled('sequencing'),
  asyncHandler(enrollContactHandler),
);

/** List all sequence enrollments for a contact. */
router.get(
  '/:id/sequence-enrollments',
  authenticate,
  requireFeatureEnabled('sequencing'),
  asyncHandler(listContactEnrollmentsHandler),
);

// ── GDPR routes (admin only) — MINCRM-364 ─────────────────────────────────────

/** Erase personal data for a contact per GDPR Art. 17. */
router.post(
  '/:id/gdpr-erase',
  authenticate,
  requireRole('admin'),
  asyncHandler(eraseContactHandler),
);

/** Export all personal data held for a contact as a JSON download. */
router.get(
  '/:id/gdpr-export',
  authenticate,
  requireRole('admin'),
  asyncHandler(gdprExportContactHandler),
);

// ── AI champion/blocker detection (MINCRM-466) ──────────────────────────────────

/** Returns the effective champion/blocker classification for the contact. */
router.get(
  '/:id/champion-blocker',
  authenticate,
  requireFeatureEnabled('ai_champion_blocker_detection'),
  asyncHandler(getContactChampionBlockerHandler),
);

/** Records a rep's "Not accurate" feedback, suppressing the badge until new signals arrive. */
router.post(
  '/:id/champion-blocker/dismiss',
  authenticate,
  requireFeatureEnabled('ai_champion_blocker_detection'),
  asyncHandler(dismissContactChampionBlockerHandler),
);

/** Records a rep's manual override, with an optional reason. */
router.patch(
  '/:id/champion-blocker/override',
  authenticate,
  requireFeatureEnabled('ai_champion_blocker_detection'),
  asyncHandler(overrideContactChampionBlockerHandler),
);

// ── AI email draft generation (MINCRM-437) ──────────────────────────────────────

/** Generates an on-demand AI first-draft follow-up email for the contact. */
router.post(
  '/:id/email-draft',
  authenticate,
  requireFeatureEnabled('ai_email_draft'),
  requireAiTokenBudget,
  asyncHandler(generateEmailDraftHandler),
);

export default router;
