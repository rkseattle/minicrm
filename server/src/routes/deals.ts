/**
 * Deal routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage deals.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createDealHandler,
  listDealsHandler,
  getDealHandler,
  updateDealHandler,
  deleteDealHandler,
  linkContactHandler,
  unlinkContactHandler,
} from '../controllers/dealController.js';

const router = Router();

/**
 * @openapi
 * /api/deals:
 *   get:
 *     tags: [Deals]
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
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', authenticate, asyncHandler(listDealsHandler));

/**
 * @openapi
 * /api/deals:
 *   post:
 *     tags: [Deals]
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
router.post('/', authenticate, asyncHandler(createDealHandler));

/**
 * @openapi
 * /api/deals/{id}:
 *   get:
 *     tags: [Deals]
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
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Deal not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', authenticate, asyncHandler(getDealHandler));

/**
 * @openapi
 * /api/deals/{id}:
 *   patch:
 *     tags: [Deals]
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
 *         description: Rep attempting to update a deal they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Deal not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/:id', authenticate, asyncHandler(updateDealHandler));

/**
 * @openapi
 * /api/deals/{id}:
 *   delete:
 *     tags: [Deals]
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
 *       403:
 *         description: Rep attempting to delete a deal they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Deal not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete('/:id', authenticate, asyncHandler(deleteDealHandler));

/**
 * @openapi
 * /api/deals/{id}/contacts/{contactId}:
 *   post:
 *     tags: [Deals]
 *     summary: Link a contact to a deal
 *     description: >
 *       Associates the specified contact with the deal via the deal_contacts join table.
 *       The relationship is many-to-many.
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
 *         description: Contact linked to deal
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Contact linked to deal
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Deal or contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/:id/contacts/:contactId', authenticate, asyncHandler(linkContactHandler));

/**
 * @openapi
 * /api/deals/{id}/contacts/{contactId}:
 *   delete:
 *     tags: [Deals]
 *     summary: Unlink a contact from a deal
 *     description: Removes the association between the contact and the deal.
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
 *         description: Contact unlinked (no content)
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Deal or contact not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete('/:id/contacts/:contactId', authenticate, asyncHandler(unlinkContactHandler));

export default router;
