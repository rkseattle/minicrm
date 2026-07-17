/**
 * Data hygiene controller — request/response shaping only. (MINCRM-476)
 * No business logic here; all DB access goes through dataHygieneService.
 */

import type { Request, Response } from 'express';
import {
  listHygieneFindings,
  dismissHygieneFinding,
  clearFindingsForEntity,
  mergeDuplicateContactFindings,
  getDataHygieneConfig,
  setDataHygieneConfig,
  runDataHygieneScan,
} from '../services/dataHygieneService.js';
import {
  dismissHygieneFindingSchema,
  listHygieneFindingsQuerySchema,
  setDataHygieneConfigSchema,
} from '@minicrm/shared/schemas/dataHygieneSchema.js';
import type { DataHygieneEntityType } from '@minicrm/shared/schemas/dataHygieneSchema.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';
import logger from '../logger.js';
import { z } from 'zod';

/**
 * GET /api/v1/data-hygiene/findings
 * scope=mine (default) restricts to the caller's own records; scope=all is
 * admin-only (rejected with 403 for non-admins).
 */
export async function listHygieneFindingsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listHygieneFindingsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const scope = parsed.data.scope ?? 'mine';
  if (scope === 'all' && req.user!.role !== 'admin') {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only admins may view the org-wide hygiene queue.' },
    });
    return;
  }

  const ownerId = scope === 'all' ? null : req.user!.id;
  const findings = await listHygieneFindings(
    ownerId,
    parsed.data.entity_type as DataHygieneEntityType | undefined,
  );
  res.status(200).json({ findings, total: findings.length });
}

/**
 * POST /api/v1/data-hygiene/findings/:id/dismiss
 * Requires a reason. Suppresses the finding for the admin-configured window.
 */
export async function dismissHygieneFindingHandler(req: Request, res: Response): Promise<void> {
  const findingId = String(req.params['id']);
  const parsed = dismissHygieneFindingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const isAdmin = req.user!.role === 'admin';
  try {
    await dismissHygieneFinding(findingId, parsed.data.reason, actor, isAdmin);
    res.status(200).json({ dismissed: true });
  } catch (err) {
    // NOT_FOUND is returned both when the finding truly doesn't exist and when a
    // non-admin's WHERE ... AND (owner_id = $x OR admin) excludes a finding they
    // don't own — same response either way, so ownership can't be probed via a
    // 403-vs-404 status difference.
    if ((err as { code?: string }).code === 'NOT_FOUND') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Hygiene finding not found' } });
      return;
    }
    throw err;
  }
}

const clearFindingsParamsSchema = z.object({
  entityType: z.enum(['contact', 'account', 'opportunity']),
  entityId: z.string().uuid(),
});

/**
 * POST /api/v1/data-hygiene/findings/clear/:entityType/:entityId
 * Removes all findings for a record once it has been updated/archived
 * outside this endpoint (e.g. via the normal contact/account/deal edit
 * flow) — this endpoint does not itself modify the underlying record.
 */
export async function clearFindingsForEntityHandler(req: Request, res: Response): Promise<void> {
  const parsed = clearFindingsParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const isAdmin = req.user!.role === 'admin';
  try {
    await clearFindingsForEntity(
      parsed.data.entityType,
      parsed.data.entityId,
      req.user!.id,
      isAdmin,
    );
    res.status(200).json({ cleared: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'NOT_FOUND') {
      res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'No hygiene findings for this entity' } });
      return;
    }
    if (code === 'FORBIDDEN') {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You do not have access to this record’s findings.' },
      });
      return;
    }
    throw err;
  }
}

const mergeDuplicatesSchema = z.object({
  winnerId: z.string().uuid(),
  loserId: z.string().uuid(),
});

/**
 * POST /api/v1/data-hygiene/findings/merge-contacts
 * Merges a flagged duplicate contact pair, reusing contactService.mergeContacts.
 */
export async function mergeDuplicateContactFindingsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = mergeDuplicatesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const isAdmin = req.user!.role === 'admin';
  try {
    await mergeDuplicateContactFindings(parsed.data.winnerId, parsed.data.loserId, actor, isAdmin);
    res.status(200).json({ merged: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'SELF_MERGE') {
      res
        .status(400)
        .json({ error: { code: 'SELF_MERGE', message: 'Cannot merge a contact with itself' } });
      return;
    }
    if (code === 'FORBIDDEN') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have access to merge these contacts.',
        },
      });
      return;
    }
    throw err;
  }
}

/** GET /api/v1/admin/ai/data-hygiene-config */
export async function getDataHygieneConfigHandler(_req: Request, res: Response): Promise<void> {
  const result = await getDataHygieneConfig();
  res.status(200).json(result);
}

/** PATCH /api/v1/admin/ai/data-hygiene-config */
export async function setDataHygieneConfigHandler(req: Request, res: Response): Promise<void> {
  const parsed = setDataHygieneConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const updated = await setDataHygieneConfig(parsed.data, actor);
  res.status(200).json(updated);
}

/**
 * POST /api/v1/admin/ai/data-hygiene/run
 * Triggers an immediate hygiene scan outside the nightly schedule. Reuses
 * the exact same runDataHygieneScan logic as the cron job.
 */
export async function triggerManualHygieneScanHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, name: req.user!.name };

  void writeAuditEntryBestEffort({
    recordType: 'ai_settings',
    recordName: 'Data Hygiene Assistant Configuration',
    eventType: 'updated',
    fieldName: 'manual_scan_triggered',
    newValue: 'Manual data hygiene scan triggered',
    changedById: actor.id,
    changedByName: actor.name,
  });

  runDataHygieneScan().catch((err: unknown) => {
    logger.error({ err }, 'dataHygieneController: manual hygiene scan failed');
  });

  res.status(202).json({ accepted: true, message: 'Data hygiene scan started' });
}
