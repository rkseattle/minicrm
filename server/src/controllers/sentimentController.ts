/**
 * Sentiment tracking controller — request/response shaping only. (MINCRM-472)
 * No business logic here; all AI orchestration and DB access goes through sentimentService.
 */

import type { Request, Response } from 'express';
import { findContactById } from '../services/contactService.js';
import { findAccountById } from '../services/accountService.js';
import { findActivityById } from '../services/activityService.js';
import {
  getContactSentimentTrend,
  getAccountSentimentTrend,
  flagSentimentScoreInaccurate,
} from '../services/sentimentService.js';

/**
 * GET /api/contacts/:id/sentiment-trend
 * Returns the sentiment trend for the contact's last 10 interactions.
 */
export async function getContactSentimentTrendHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const contact = await findContactById(id);
  if (!contact) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  if (contact.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message:
          'You can only view sentiment trends for contacts you own. Contact an admin to view trends for contacts owned by others.',
      },
    });
    return;
  }

  const result = await getContactSentimentTrend(id);
  res.status(200).json(result);
}

/**
 * GET /api/accounts/:id/sentiment-trend
 * Returns the aggregate sentiment trend across all contacts at the account, last 90 days.
 */
export async function getAccountSentimentTrendHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const account = await findAccountById(id);
  if (!account) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return;
  }

  if (account.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message:
          'You can only view sentiment trends for accounts you own. Contact an admin to view trends for accounts owned by others.',
      },
    });
    return;
  }

  const result = await getAccountSentimentTrend(id);
  res.status(200).json(result);
}

/**
 * POST /api/activities/:id/sentiment/flag-inaccurate
 * Records a rep's "Not accurate" feedback on the activity's sentiment score.
 */
export async function flagActivitySentimentInaccurateHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = String(req.params['id']);
  const activity = await findActivityById(id);
  if (!activity) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Activity not found' } });
    return;
  }

  if (activity.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message:
          'You can only flag sentiment scores for activities you own. Contact an admin to flag scores for activities owned by others.',
      },
    });
    return;
  }

  const found = await flagSentimentScoreInaccurate(id, { id: req.user!.id, name: req.user!.name });
  if (!found) {
    res
      .status(404)
      .json({
        error: { code: 'NOT_FOUND', message: 'No sentiment score exists for this activity' },
      });
    return;
  }

  res.status(200).json({ activity_id: id, flagged_inaccurate: true });
}
