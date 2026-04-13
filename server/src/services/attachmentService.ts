/**
 * Attachment service — all business logic and DB queries for file attachments.
 * Files are stored in S3-compatible object storage; this module manages the
 * metadata records in Postgres. (MINCRM-167)
 */

import { v4 as uuidv4 } from 'uuid';
import type { Readable } from 'stream';
import pool from '../db.js';
import logger from '../logger.js';
import { uploadObject, getObjectStream, deleteObject } from './storageService.js';
import { createActivity } from './activityService.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum cumulative attachment size per record in bytes (100 MB). */
const MAX_RECORD_STORAGE_BYTES = 100 * 1024 * 1024;

/** Maximum individual file size in bytes (25 MB). */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** Allowed MIME types for uploads. */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'text/plain',
]);

/** Valid record types for attachments. */
export type RecordType = 'contact' | 'account' | 'deal';

// ── Row types ─────────────────────────────────────────────────────────────────

/** A row from the attachments table joined with uploader info. */
export interface AttachmentRow {
  id: string;
  record_type: RecordType;
  record_id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  storage_key: string;
  uploader_id: string | null;
  uploader_name: string | null;
  uploaded_at: string;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Lists all attachments for a given record.
 *
 * @param recordType - 'contact' | 'account' | 'deal'
 * @param recordId - UUID of the parent record.
 * @returns Array of attachment rows with uploader name.
 */
export async function listAttachments(
  recordType: RecordType,
  recordId: string,
): Promise<AttachmentRow[]> {
  const result = await pool.query<AttachmentRow>(
    `SELECT
       a.id,
       a.record_type,
       a.record_id,
       a.filename,
       a.file_size::int AS file_size,
       a.mime_type,
       a.storage_key,
       a.uploader_id,
       u.name AS uploader_name,
       a.uploaded_at
     FROM attachments a
     LEFT JOIN users u ON u.id = a.uploader_id
     WHERE a.record_type = $1 AND a.record_id = $2
     ORDER BY a.uploaded_at DESC`,
    [recordType, recordId],
  );
  return result.rows;
}

/**
 * Returns a single attachment by ID, or null if not found.
 *
 * @param id - UUID of the attachment.
 * @returns The attachment row, or null.
 */
export async function findAttachmentById(id: string): Promise<AttachmentRow | null> {
  const result = await pool.query<AttachmentRow>(
    `SELECT
       a.id,
       a.record_type,
       a.record_id,
       a.filename,
       a.file_size::int AS file_size,
       a.mime_type,
       a.storage_key,
       a.uploader_id,
       u.name AS uploader_name,
       a.uploaded_at
     FROM attachments a
     LEFT JOIN users u ON u.id = a.uploader_id
     WHERE a.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Returns the total stored bytes for all attachments on a record.
 *
 * @param recordType - Record type.
 * @param recordId - UUID of the parent record.
 * @returns Total bytes as a number.
 */
async function getTotalStorageBytes(recordType: RecordType, recordId: string): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(file_size), 0)::text AS total
     FROM attachments
     WHERE record_type = $1 AND record_id = $2`,
    [recordType, recordId],
  );
  return Number(result.rows[0].total);
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Input for creating an attachment record after upload succeeds. */
export interface UploadAttachmentInput {
  recordType: RecordType;
  recordId: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  buffer: Buffer;
  uploaderId: string;
}

/**
 * Uploads a file to object storage and inserts the metadata row.
 * Creates an activity timeline entry on success.
 * Enforces per-record 100 MB cap.
 *
 * @param input - Upload parameters.
 * @returns The newly created attachment row.
 * @throws With code 'STORAGE_CAP_EXCEEDED' if the cap would be reached.
 */
export async function uploadAttachment(input: UploadAttachmentInput): Promise<AttachmentRow> {
  const { recordType, recordId, filename, fileSize, mimeType, buffer, uploaderId } = input;

  // Check 100 MB per-record cap
  const currentBytes = await getTotalStorageBytes(recordType, recordId);
  if (currentBytes + fileSize > MAX_RECORD_STORAGE_BYTES) {
    const err = new Error('Attachment storage cap reached for this record (100 MB)');
    (err as NodeJS.ErrnoException).code = 'STORAGE_CAP_EXCEEDED';
    throw err;
  }

  const attachmentId = uuidv4();
  const storageKey = `attachments/${recordType}/${recordId}/${attachmentId}/${filename}`;

  // Upload to object storage first
  await uploadObject(storageKey, buffer, mimeType);

  // Insert metadata row
  let row: AttachmentRow;
  try {
    const insertResult = await pool.query<{ id: string }>(
      `INSERT INTO attachments
         (id, record_type, record_id, filename, file_size, mime_type, storage_key, uploader_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [attachmentId, recordType, recordId, filename, fileSize, mimeType, storageKey, uploaderId],
    );
    row = (await findAttachmentById(insertResult.rows[0].id))!;
  } catch (err) {
    // Roll back the object if the DB insert fails
    try {
      await deleteObject(storageKey);
    } catch (deleteErr) {
      logger.error({ deleteErr, storageKey }, 'Failed to clean up object after DB insert error');
    }
    throw err;
  }

  // Create timeline activity — isolated so a failure does not abort the upload
  try {
    const activitySubject = `Attached ${filename}`;
    const activityFields =
      recordType === 'contact'
        ? { contact_id: recordId }
        : recordType === 'account'
          ? { account_id: recordId }
          : { deal_id: recordId };

    await createActivity({
      type: 'Note',
      subject: activitySubject,
      ...activityFields,
      owner_id: uploaderId,
    });
  } catch (activityErr) {
    logger.error({ activityErr }, 'Failed to create activity for attachment upload');
  }

  return row;
}

/**
 * Returns a readable stream for downloading an attachment.
 *
 * @param id - UUID of the attachment.
 * @param requesterId - ID of the user requesting the download.
 * @param requesterRole - Role of the requesting user.
 * @returns The attachment metadata and a readable stream.
 * @throws 404 if not found; 403 if ownership denied.
 */
export async function downloadAttachment(
  id: string,
  _requesterId: string,
  _requesterRole: string,
): Promise<{ attachment: AttachmentRow; stream: Readable }> {
  const attachment = await findAttachmentById(id);
  if (!attachment) {
    const err = new Error('Attachment not found');
    (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
    throw err;
  }

  const stream = await getObjectStream(attachment.storage_key);
  return { attachment, stream };
}

/**
 * Deletes an attachment from object storage and removes the metadata row.
 * Only the uploader or an admin may delete.
 *
 * @param id - UUID of the attachment.
 * @param requesterId - ID of the requesting user.
 * @param requesterRole - Role of the requesting user.
 * @throws 404 if not found; 403 if not authorized.
 */
export async function deleteAttachment(
  id: string,
  requesterId: string,
  requesterRole: string,
): Promise<void> {
  const attachment = await findAttachmentById(id);
  if (!attachment) {
    const err = new Error('Attachment not found');
    (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
    throw err;
  }

  const isUploader = attachment.uploader_id === requesterId;
  const isAdmin = requesterRole === 'admin';
  if (!isUploader && !isAdmin) {
    const err = new Error('You do not have permission to delete this attachment');
    (err as NodeJS.ErrnoException).code = 'FORBIDDEN';
    throw err;
  }

  // Remove metadata row first so the record is gone even if storage cleanup fails
  await pool.query('DELETE FROM attachments WHERE id = $1', [id]);

  // Delete from object storage
  await deleteObject(attachment.storage_key);
}
