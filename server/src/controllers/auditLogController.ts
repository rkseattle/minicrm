/**
 * Audit log controller — request/response shaping for audit log endpoints.
 * No business logic here; all queries go through auditService.
 */

import type { Request, Response } from 'express';
import { recordAuditLogParamsSchema } from '@minicrm/shared/schemas/auditSchema.js';
import { getRecordAuditLog, listAuditLogActors } from '../services/auditService.js';

/**
 * GET /api/v1/audit-log/record
 * Returns audit log entries for a single record.
 * Available to any authenticated user (scoped to record context on the detail page).
 * Query params: record_type, record_id, all (optional, returns full history when true)
 */
export async function getRecordAuditLogHandler(req: Request, res: Response): Promise<void> {
  const parsed = recordAuditLogParamsSchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const { record_type, record_id, all } = parsed.data;

  const entries = await getRecordAuditLog({
    recordType: record_type,
    recordId: record_id,
    all,
  });

  res.status(200).json({ entries });
}

/**
 * GET /api/v1/audit-log/actors
 * Returns distinct users who appear in the audit log.
 * Used to populate the user filter dropdown on the admin audit log page. Admin only.
 */
export async function listAuditLogActorsHandler(_req: Request, res: Response): Promise<void> {
  const actors = await listAuditLogActors();
  res.status(200).json({ actors });
}
