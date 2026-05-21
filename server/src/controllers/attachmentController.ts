/**
 * Attachment controller — request/response shaping for attachment endpoints.
 * No business logic here; all work goes through attachmentService. (MINCRM-167)
 */

import type { Request, Response } from 'express';
import {
  listAttachments,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
  ALLOWED_MIME_TYPES,
  type RecordType,
} from '../services/attachmentService.js';
import {
  getStorageConfig,
  setStorageConfig,
  testStorageConnection,
} from '../services/storageService.js';

const VALID_RECORD_TYPES = new Set<RecordType>(['contact', 'account', 'deal', 'lead']);

// ── Attachment CRUD ───────────────────────────────────────────────────────────

/**
 * GET /api/attachments?recordType=&recordId=
 * Lists all attachments for a record.
 *
 * @param req - Express request with query params recordType and recordId.
 * @param res - Express response.
 */
export async function listAttachmentsHandler(req: Request, res: Response): Promise<void> {
  const { recordType, recordId } = req.query;

  if (typeof recordType !== 'string' || !VALID_RECORD_TYPES.has(recordType as RecordType)) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recordType must be contact, account, deal, or lead',
      },
    });
    return;
  }
  if (typeof recordId !== 'string' || !recordId) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'recordId is required' },
    });
    return;
  }

  const attachments = await listAttachments(recordType as RecordType, recordId);
  res.status(200).json({ attachments });
}

/**
 * POST /api/attachments
 * Uploads a file attachment to a record.
 * Expects multipart/form-data with fields: recordType, recordId, file.
 *
 * @param req - Express request (file parsed by multer middleware).
 * @param res - Express response.
 */
export async function uploadAttachmentHandler(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No file provided' } });
    return;
  }

  const { recordType, recordId } = req.body as { recordType: unknown; recordId: unknown };

  if (typeof recordType !== 'string' || !VALID_RECORD_TYPES.has(recordType as RecordType)) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recordType must be contact, account, deal, or lead',
      },
    });
    return;
  }
  if (typeof recordId !== 'string' || !recordId) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'recordId is required' },
    });
    return;
  }

  if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Unsupported file type. Accepted: PDF, .docx, .xlsx, .png, .jpg, .txt',
      },
    });
    return;
  }

  let attachment;
  try {
    attachment = await uploadAttachment({
      recordType: recordType as RecordType,
      recordId,
      filename: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
      uploaderId: req.user!.id,
      uploaderName: req.user!.name,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'STORAGE_CAP_EXCEEDED') {
      res.status(400).json({
        error: {
          code: 'STORAGE_CAP_EXCEEDED',
          message: 'Attachment storage cap reached for this record (100 MB)',
        },
      });
      return;
    }
    if (code === 'STORAGE_NOT_CONFIGURED') {
      res.status(503).json({
        error: {
          code: 'STORAGE_NOT_CONFIGURED',
          message: 'File storage is not configured — contact your admin',
        },
      });
      return;
    }
    throw err;
  }

  res.status(201).json({ attachment });
}

/**
 * GET /api/attachments/:id/download
 * Streams the file content back through the API (proxied download).
 *
 * @param req - Express request with id param.
 * @param res - Express response.
 */
export async function downloadAttachmentHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  let result;
  try {
    result = await downloadAttachment(id, req.user!.id, req.user!.role);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'NOT_FOUND') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
      return;
    }
    throw err;
  }

  const { attachment, stream } = result;
  res.setHeader('Content-Type', attachment.mime_type);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
  );
  res.setHeader('Content-Length', String(attachment.file_size));
  stream.pipe(res);
}

/**
 * DELETE /api/attachments/:id
 * Deletes an attachment. Only the uploader or an admin may delete.
 *
 * @param req - Express request with id param.
 * @param res - Express response.
 */
export async function deleteAttachmentHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  try {
    await deleteAttachment(id, req.user!.id, req.user!.role, req.user!.name);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'NOT_FOUND') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
      return;
    }
    if (code === 'FORBIDDEN') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to delete this attachment',
        },
      });
      return;
    }
    throw err;
  }

  res.status(204).send();
}

// ── Storage settings (MINCRM-169) ─────────────────────────────────────────────

/**
 * GET /api/settings/storage/status
 * Returns only whether storage is configured. Authenticated users (not admin-only).
 * Used by AttachmentsSection to decide whether to show the upload UI.
 *
 * @param _req - Express request (unused).
 * @param res - Express response.
 */
export async function getStorageStatusHandler(_req: Request, res: Response): Promise<void> {
  const config = await getStorageConfig();
  res.status(200).json({ configured: config !== null });
}

/**
 * GET /api/settings/storage
 * Returns the current storage configuration (secret masked). Admin only.
 *
 * @param _req - Express request (unused).
 * @param res - Express response.
 */
export async function getStorageConfigHandler(_req: Request, res: Response): Promise<void> {
  const config = await getStorageConfig();
  if (!config) {
    res.status(200).json({ configured: false, config: null });
    return;
  }
  res.status(200).json({
    configured: true,
    config: {
      endpoint: config.endpoint,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: '********',
    },
  });
}

/**
 * PUT /api/settings/storage
 * Saves storage configuration. Admin only.
 *
 * @param req - Express request with body { endpoint, bucket, accessKeyId, secretAccessKey }.
 * @param res - Express response.
 */
export async function setStorageConfigHandler(req: Request, res: Response): Promise<void> {
  const { endpoint, bucket, accessKeyId, secretAccessKey } = req.body as Record<string, unknown>;

  if (
    typeof endpoint !== 'string' ||
    !endpoint ||
    typeof bucket !== 'string' ||
    !bucket ||
    typeof accessKeyId !== 'string' ||
    !accessKeyId ||
    typeof secretAccessKey !== 'string' ||
    !secretAccessKey
  ) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'endpoint, bucket, accessKeyId, and secretAccessKey are required',
      },
    });
    return;
  }

  const saved = await setStorageConfig({ endpoint, bucket, accessKeyId, secretAccessKey });
  res.status(200).json({ configured: true, config: saved });
}

/**
 * DELETE /api/settings/storage
 * Clears storage configuration. Admin only.
 * Does not delete existing attachment records or objects.
 *
 * @param _req - Express request (unused).
 * @param res - Express response.
 */
export async function clearStorageConfigHandler(_req: Request, res: Response): Promise<void> {
  await setStorageConfig(null);
  res.status(200).json({ configured: false, config: null });
}

/**
 * POST /api/settings/storage/test
 * Tests candidate storage credentials without saving them. Admin only.
 *
 * @param req - Express request with body { endpoint, bucket, accessKeyId, secretAccessKey }.
 * @param res - Express response.
 */
export async function testStorageConfigHandler(req: Request, res: Response): Promise<void> {
  const { endpoint, bucket, accessKeyId, secretAccessKey } = req.body as Record<string, unknown>;

  if (
    typeof endpoint !== 'string' ||
    !endpoint ||
    typeof bucket !== 'string' ||
    !bucket ||
    typeof accessKeyId !== 'string' ||
    !accessKeyId ||
    typeof secretAccessKey !== 'string' ||
    !secretAccessKey
  ) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'endpoint, bucket, accessKeyId, and secretAccessKey are required',
      },
    });
    return;
  }

  const ok = await testStorageConnection({ endpoint, bucket, accessKeyId, secretAccessKey });
  res.status(200).json({ success: ok });
}
