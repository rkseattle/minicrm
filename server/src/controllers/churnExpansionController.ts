/**
 * Churn/expansion controller — request/response shaping only. (MINCRM-469)
 * No business logic here; all cached-read access goes through churnExpansionService.
 */

import type { Request, Response } from 'express';
import { findAccountById } from '../services/accountService.js';
import { canAccessOwnedRecord } from '../services/visibilityService.js';
import {
  getAccountChurnExpansionSignal,
  listChurnExpansionSignals,
} from '../services/churnExpansionService.js';

/**
 * GET /api/accounts/:id/churn-expansion-signal
 * Returns the active churn/expansion signal for the account, or null when none is active.
 */
export async function getAccountChurnExpansionSignalHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = String(req.params['id']);
  const account = await findAccountById(id);
  if (!account) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return;
  }

  const canAccess = await canAccessOwnedRecord(
    'account',
    account.owner_id,
    req.user!.id,
    req.user!.role,
  );
  if (!canAccess) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have visibility into this account.',
      },
    });
    return;
  }

  const result = await getAccountChurnExpansionSignal(id);
  res.status(200).json(result);
}

/**
 * GET /api/insights/churn-expansion
 * Returns all active at-risk and expansion account signals from the most recent nightly run,
 * scoped to accounts the caller owns. Admins see signals across all accounts.
 */
export async function listChurnExpansionSignalsHandler(req: Request, res: Response): Promise<void> {
  const ownerId = req.user!.role === 'admin' ? null : req.user!.id;
  const result = await listChurnExpansionSignals(ownerId);
  res.status(200).json(result);
}
