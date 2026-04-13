/**
 * Attachment routes. (MINCRM-167)
 * All routes require authentication.
 * DELETE enforces uploader/admin ownership in the service layer.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listAttachmentsHandler,
  uploadAttachmentHandler,
  downloadAttachmentHandler,
  deleteAttachmentHandler,
} from '../controllers/attachmentController.js';
import { MAX_FILE_SIZE_BYTES } from '../services/attachmentService.js';

const router = Router();

/** Multer instance — memory storage, 25 MB limit. File-type filter is enforced
 *  in the controller so we can return a structured error response. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

router.use(authenticate);

/**
 * @openapi
 * /api/attachments:
 *   get:
 *     tags: [Attachments]
 *     operationId: listAttachments
 *     summary: List attachments for a record
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: recordType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [contact, account, deal]
 *       - in: query
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of attachments
 *       400:
 *         description: Missing or invalid query params
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/', asyncHandler(listAttachmentsHandler));

/**
 * @openapi
 * /api/attachments:
 *   post:
 *     tags: [Attachments]
 *     operationId: uploadAttachment
 *     summary: Upload a file attachment to a record
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               recordType:
 *                 type: string
 *                 enum: [contact, account, deal]
 *               recordId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Attachment created
 *       400:
 *         description: Validation error or storage cap exceeded
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       503:
 *         description: Storage not configured
 */
router.post('/', upload.single('file'), asyncHandler(uploadAttachmentHandler));

/**
 * @openapi
 * /api/attachments/{id}/download:
 *   get:
 *     tags: [Attachments]
 *     operationId: downloadAttachment
 *     summary: Download an attachment (proxied through API)
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
 *         description: File stream
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:id/download', asyncHandler(downloadAttachmentHandler));

/**
 * @openapi
 * /api/attachments/{id}:
 *   delete:
 *     tags: [Attachments]
 *     operationId: deleteAttachment
 *     summary: Delete an attachment (uploader or admin only)
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
 *         description: Deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete('/:id', asyncHandler(deleteAttachmentHandler));

/**
 * Multer error handler — converts oversized-file errors into 400 responses.
 */
router.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'File exceeds the 25 MB size limit',
      },
    });
    return;
  }
  _next(err);
});

export default router;
