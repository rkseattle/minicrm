/**
 * Contact routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage contacts.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
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
} from '../controllers/contactController.js';

const router = Router();

/**
 * @openapi
 * /api/contacts:
 *   get:
 *     tags: [Contacts]
 *     operationId: listContacts
 *     summary: List contacts
 *     description: >
 *       Returns all contacts. Pass `?owner=me` to scope results to the authenticated
 *       user's contacts. Pass `?account=<uuid>` to filter by account.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *           enum: [me]
 *         description: Pass 'me' to return only the authenticated user's contacts
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
 * /api/contacts/export:
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
router.get('/export', authenticate, asyncHandler(exportContactsHandler));

/**
 * @openapi
 * /api/contacts:
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
router.post('/', authenticate, asyncHandler(createContactHandler));

/**
 * @openapi
 * /api/contacts/{id}:
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
 * /api/contacts/{id}:
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
router.patch('/:id', authenticate, asyncHandler(updateContactHandler));

/**
 * @openapi
 * /api/contacts/{id}:
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
router.delete('/:id', authenticate, asyncHandler(deleteContactHandler));

/**
 * @openapi
 * /api/contacts/{id}/deals:
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
 * /api/contacts/{id}/merge:
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
router.post('/:id/merge', authenticate, asyncHandler(mergeContactHandler));

export default router;
