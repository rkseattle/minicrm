/**
 * Notes routes — all endpoints require authentication. (MINCRM-352)
 * Routes are mounted at /api/v1/:entityType/:entityId/notes.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listNotesHandler,
  createNoteHandler,
  getNoteHandler,
  updateNoteHandler,
  deleteNoteHandler,
} from '../controllers/noteController.js';

const router = Router({ mergeParams: true });

/**
 * @openapi
 * /api/v1/{entityType}/{entityId}/notes:
 *   get:
 *     tags: [Notes]
 *     operationId: listNotes
 *     summary: List notes for an entity
 *     description: >
 *       Returns notes for the given entity. Team and public notes are always included.
 *       Private notes are included only when created by the caller; bodies of other
 *       users' private notes are omitted (is_masked: true). Ordered by created_at DESC.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [contact, account, deal, lead]
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 25
 *     responses:
 *       200:
 *         description: Paginated list of notes
 *       400:
 *         description: Invalid entityType or entityId
 *       401:
 *         description: Unauthenticated
 */
router.get('/', authenticate, requireFeatureEnabled('notes'), asyncHandler(listNotesHandler));

/**
 * @openapi
 * /api/v1/{entityType}/{entityId}/notes:
 *   post:
 *     tags: [Notes]
 *     operationId: createNote
 *     summary: Create a note on an entity
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [contact, account, deal, lead]
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               title:
 *                 type: string
 *                 maxLength: 255
 *               body:
 *                 type: string
 *                 description: Serialised Lexical editor state JSON
 *               visibility:
 *                 type: string
 *                 enum: [private, team, public]
 *                 default: team
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Note created
 *       400:
 *         description: Validation error or parent entity not found
 *       401:
 *         description: Unauthenticated
 */
router.post('/', authenticate, requireFeatureEnabled('notes'), asyncHandler(createNoteHandler));

/**
 * @openapi
 * /api/v1/{entityType}/{entityId}/notes/{noteId}:
 *   get:
 *     tags: [Notes]
 *     operationId: getNote
 *     summary: Get a single note
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [contact, account, deal, lead]
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Note returned (body omitted if caller cannot see private note)
 *       401:
 *         description: Unauthenticated
 *       404:
 *         description: Note not found
 */
router.get('/:noteId', authenticate, requireFeatureEnabled('notes'), asyncHandler(getNoteHandler));

/**
 * @openapi
 * /api/v1/{entityType}/{entityId}/notes/{noteId}:
 *   patch:
 *     tags: [Notes]
 *     operationId: updateNote
 *     summary: Update a note
 *     description: Only the creator or an admin may update. Visibility changes are creator-only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [contact, account, deal, lead]
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Updated note
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Note not found
 */
router.patch(
  '/:noteId',
  authenticate,
  requireFeatureEnabled('notes'),
  asyncHandler(updateNoteHandler),
);

/**
 * @openapi
 * /api/v1/{entityType}/{entityId}/notes/{noteId}:
 *   delete:
 *     tags: [Notes]
 *     operationId: deleteNote
 *     summary: Soft-delete a note
 *     description: Only the creator or an admin may delete.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [contact, account, deal, lead]
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Note deleted
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Note not found
 */
router.delete(
  '/:noteId',
  authenticate,
  requireFeatureEnabled('notes'),
  asyncHandler(deleteNoteHandler),
);

export default router;
