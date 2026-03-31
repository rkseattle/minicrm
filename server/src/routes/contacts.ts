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
} from '../controllers/contactController.js';

const router = Router();

/**
 * @openapi
 * /api/contacts:
 *   get:
 *     tags: [Contacts]
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
 *       400:
 *         description: Invalid query parameter
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
 */
router.get('/', authenticate, asyncHandler(listContactsHandler));

/**
 * @openapi
 * /api/contacts:
 *   post:
 *     tags: [Contacts]
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
 *       400:
 *         description: Validation error
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
 */
router.post('/', authenticate, asyncHandler(createContactHandler));

/**
 * @openapi
 * /api/contacts/{id}:
 *   get:
 *     tags: [Contacts]
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
router.get('/:id', authenticate, asyncHandler(getContactHandler));

/**
 * @openapi
 * /api/contacts/{id}:
 *   patch:
 *     tags: [Contacts]
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
 *       400:
 *         description: Validation error
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
 *       403:
 *         description: Rep attempting to update a contact they do not own
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
router.patch('/:id', authenticate, asyncHandler(updateContactHandler));

/**
 * @openapi
 * /api/contacts/{id}:
 *   delete:
 *     tags: [Contacts]
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
 *       403:
 *         description: Rep attempting to delete a contact they do not own
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
router.delete('/:id', authenticate, asyncHandler(deleteContactHandler));

/**
 * @openapi
 * /api/contacts/{id}/deals:
 *   get:
 *     tags: [Contacts]
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
router.get('/:id/deals', authenticate, asyncHandler(listContactDealsHandler));

export default router;
