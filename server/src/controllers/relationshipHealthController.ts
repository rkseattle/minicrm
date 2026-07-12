/**
 * Relationship health controller — request/response shaping only. (MINCRM-467)
 * No business logic here; all cached-read and config access goes through relationshipHealthService.
 */

import type { Request, Response } from 'express';
import { findAccountById } from '../services/accountService.js';
import { canAccessOwnedRecord } from '../services/visibilityService.js';
import {
  getAccountHealthScore,
  getAccountHealthHistory,
  getAccountHealthScoringConfig,
  setAccountHealthScoringConfig,
} from '../services/relationshipHealthService.js';
import { setAccountHealthScoringConfigSchema } from '@minicrm/shared/schemas/accountHealthScoreSchema.js';

async function assertAccountAccess(
  req: Request,
  res: Response,
  accountId: string,
): Promise<boolean> {
  const account = await findAccountById(accountId);
  if (!account) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return false;
  }

  const canAccess = await canAccessOwnedRecord(
    'account',
    account.owner_id,
    req.user!.id,
    req.user!.role,
  );
  if (!canAccess) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'You do not have visibility into this account.' },
    });
    return false;
  }
  return true;
}

/**
 * GET /api/accounts/:id/health-score
 * Returns the cached relationship health score for the account, or null when
 * no score has been computed yet (insufficient data or not yet run).
 */
export async function getAccountHealthScoreHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  if (!(await assertAccountAccess(req, res, id))) return;

  const score = await getAccountHealthScore(id);
  res.status(200).json({ score });
}

/**
 * GET /api/accounts/:id/health-score/history
 * Returns up to 6 months of health score history for the trend sparkline.
 */
export async function getAccountHealthHistoryHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  if (!(await assertAccountAccess(req, res, id))) return;

  const history = await getAccountHealthHistory(id);
  res.status(200).json(history);
}

/**
 * GET /api/admin/relationship-health/config
 * Returns the admin-editable scoring weights/thresholds. Admin only.
 */
export async function getAccountHealthScoringConfigHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const config = await getAccountHealthScoringConfig();
  res.status(200).json(config);
}

/**
 * PATCH /api/admin/relationship-health/config
 * Updates the admin-editable scoring weights/thresholds. Admin only.
 */
export async function setAccountHealthScoringConfigHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = setAccountHealthScoringConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  const config = await setAccountHealthScoringConfig(parsed.data, req.user!.id);
  res.status(200).json(config);
}
