/**
 * GDPR controller — request/response shaping for GDPR erasure and export endpoints.
 * No business logic here; all work goes through gdprService.
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
  cascadeGdprErasureToAiData,
  getAiCascadeLogForRecord,
  hasGdprErasureForRecord,
  getOriginalPiiFromCascadeLog,
  type CascadeRecordType,
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
 * POST /api/v1/gdpr/{contacts|leads}/:id/ai-cascade
 * Triggers a manual re-run of the GDPR AI data cascade for a record. Admin only.
 * Returns immediately — the cascade runs asynchronously.
 */
function makeTriggerAiCascadeHandler(recordType: CascadeRecordType) {
  return async function triggerAiCascade(req: Request, res: Response): Promise<void> {
    const id = String(req.params['id']);
    const idParsed = uuidSchema.safeParse(id);
    if (!idParsed.success) {
      res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a valid UUID' } });
      return;
    }

    const actor = { id: req.user!.id, name: req.user!.name };

    // Verify that a GDPR erasure has already been performed for this record.
    // The cascade is only meaningful after erasure — running it on a live record
    // would redact legitimate messages.
    const erased = await hasGdprErasureForRecord(id, recordType);
    if (!erased) {
      res.status(409).json({
        error: {
          code: 'GDPR_ERASURE_NOT_FOUND',
          message: `No GDPR erasure record found for this ${recordType}. Cascade requires a prior erasure.`,
        },
      });
      return;
    }

    // Re-running the cascade: recover the original name and email from a failed
    // log row. With no such row the name is left out rather than defaulting to
    // the '[GDPR deleted]' placeholder — that string matches itself, and the
    // cascade's searches are not scoped to one record, so it would rewrite every
    // other subject's already-redacted rows and count them as this one's. The
    // synthetic email is unique per record and stands in safely.
    const originalPii = await getOriginalPiiFromCascadeLog(id, recordType);
    if (!originalPii?.original_name && !originalPii?.original_email) {
      // Without the pre-erasure name or email there is nothing to search for.
      // The synthetic placeholder appears in no message by construction, so a
      // re-run would match nothing and still record a completed cascade — a
      // receipt for a purge that never happened.
      res.status(409).json({
        error: {
          code: 'GDPR_CASCADE_PII_UNAVAILABLE',
          message: `No recoverable identifiers for this ${recordType}. A re-run needs the name or email captured by a failed cascade; none is on record.`,
        },
      });
      return;
    }

    void cascadeGdprErasureToAiData(
      id,
      recordType,
      originalPii.original_name,
      originalPii.original_email,
      actor,
    );

    res.status(202).json({ accepted: true, message: 'AI cascade re-run accepted' });
  };
}

export const triggerAiCascadeHandler = makeTriggerAiCascadeHandler('contact');
export const triggerLeadAiCascadeHandler = makeTriggerAiCascadeHandler('lead');

/**
 * GET /api/v1/gdpr/{contacts|leads}/:id/ai-cascade
 * Returns all ai_gdpr_cascade_log rows for a record. Admin only.
 */
function makeGetAiCascadeLogHandler(recordType: CascadeRecordType) {
  return async function getAiCascadeLog(req: Request, res: Response): Promise<void> {
    const id = String(req.params['id']);
    const idParsed = uuidSchema.safeParse(id);
    if (!idParsed.success) {
      res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: 'id must be a valid UUID' } });
      return;
    }

    const rows = await getAiCascadeLogForRecord(id, recordType);
    res.status(200).json({ data: rows });
  };
}

export const getAiCascadeLogHandler = makeGetAiCascadeLogHandler('contact');
export const getLeadAiCascadeLogHandler = makeGetAiCascadeLogHandler('lead');

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
