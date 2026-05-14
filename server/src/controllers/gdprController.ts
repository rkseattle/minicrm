/**
 * GDPR controller — request/response shaping for GDPR erasure and export endpoints.
 * No business logic here; all work goes through gdprService. (MINCRM-364)
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import {
  eraseContact,
  eraseLead,
  getGdprExportForContact,
  getGdprExportForLead,
  listGdprDeletions,
  getGdprStatusForRecord,
} from '../services/gdprService.js';

/** Schema for the optional notes field in erasure request bodies */
const eraseBodySchema = z.object({
  notes: z.string().optional(),
});

/** UUID schema used to validate path parameters */
const uuidSchema = z.string().uuid();

/**
 * POST /api/v1/contacts/:id/gdpr-erase
 * Erases PII for a contact. Admin only.
 */
export async function eraseContactHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a valid UUID' } });
    return;
  }

  const bodyParsed = eraseBodySchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: bodyParsed.error.errors[0].message },
    });
    return;
  }

  // req.user is guaranteed non-null by the authenticate middleware on this route
  const actor = { id: req.user!.id, name: req.user!.name };

  try {
    const row = await eraseContact(id, actor, bodyParsed.data.notes);
    res.status(200).json({ success: true, erasedAt: row.completed_at });
  } catch (err: unknown) {
    const domainErr = err as { code?: string };
    if (domainErr.code === 'GDPR_ALREADY_ERASED') {
      res.status(409).json({
        error: {
          code: 'GDPR_ALREADY_ERASED',
          message: 'This contact has already been erased under GDPR Art. 17',
        },
      });
      return;
    }
    if (domainErr.code === 'NOT_FOUND') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
      return;
    }
    throw err;
  }
}

/**
 * POST /api/v1/leads/:id/gdpr-erase
 * Erases PII for a lead. Admin only.
 */
export async function eraseLeadHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a valid UUID' } });
    return;
  }

  const bodyParsed = eraseBodySchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: bodyParsed.error.errors[0].message },
    });
    return;
  }

  // req.user is guaranteed non-null by the authenticate middleware on this route
  const actor = { id: req.user!.id, name: req.user!.name };

  try {
    const row = await eraseLead(id, actor, bodyParsed.data.notes);
    res.status(200).json({ success: true, erasedAt: row.completed_at });
  } catch (err: unknown) {
    const domainErr = err as { code?: string };
    if (domainErr.code === 'GDPR_ALREADY_ERASED') {
      res.status(409).json({
        error: {
          code: 'GDPR_ALREADY_ERASED',
          message: 'This lead has already been erased under GDPR Art. 17',
        },
      });
      return;
    }
    if (domainErr.code === 'NOT_FOUND') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
      return;
    }
    throw err;
  }
}

/**
 * GET /api/v1/contacts/:id/gdpr-export
 * Returns a JSON file download of all personal data held for a contact. Admin only.
 */
export async function gdprExportContactHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a valid UUID' } });
    return;
  }

  const exportData = await getGdprExportForContact(id);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="gdpr-export-contact-${id}.json"`);
  res.status(200).send(JSON.stringify(exportData, null, 2));
}

/**
 * GET /api/v1/leads/:id/gdpr-export
 * Returns a JSON file download of all personal data held for a lead. Admin only.
 */
export async function gdprExportLeadHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a valid UUID' } });
    return;
  }

  const exportData = await getGdprExportForLead(id);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="gdpr-export-lead-${id}.json"`);
  res.status(200).send(JSON.stringify(exportData, null, 2));
}

/**
 * GET /api/v1/gdpr/deletions
 * Returns a paginated list of all GDPR erasure log entries. Admin only.
 */
export async function listGdprDeletionsHandler(req: Request, res: Response): Promise<void> {
  const parsed = paginationParamsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const { page, limit } = parsed.data;
  const result = await listGdprDeletions(page, limit);
  res.status(200).json(result);
}

/**
 * GET /api/v1/gdpr/status/:recordType/:recordId
 * Returns the GDPR deletion log entry for a record, or null if none. Admin only.
 */
export async function getGdprStatusHandler(req: Request, res: Response): Promise<void> {
  const recordType = String(req.params['recordType']);
  const recordId = String(req.params['recordId']);

  const idParsed = uuidSchema.safeParse(recordId);
  if (!idParsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'recordId must be a valid UUID' },
    });
    return;
  }

  const status = await getGdprStatusForRecord(recordType, recordId);
  res.status(200).json({ status });
}
