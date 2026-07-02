/**
 * Churn/expansion controller — request/response shaping only. (MINCRM-469)
 * No business logic here; all cached-read access goes through churnExpansionService.
 */

import type { Request, Response } from 'express';
import { findAccountById } from '../services/accountService.js';
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

  const result = await getAccountChurnExpansionSignal(id);
  res.status(200).json(result);
}

/**
 * GET /api/insights/churn-expansion
 * Returns all active at-risk and expansion account signals from the most recent nightly run.
 */
export async function listChurnExpansionSignalsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const result = await listChurnExpansionSignals();
  res.status(200).json(result);
}
