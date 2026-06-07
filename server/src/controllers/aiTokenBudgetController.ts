/**
 * AI token budget controller — request/response shaping for token budget endpoints.
 * No business logic or database access here — delegates entirely to aiTokenBudgetService.
 * (MINCRM-458)
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  setOrgTokenBudgetSchema,
  setUserTokenBudgetSchema,
} from '@minicrm/shared/schemas/settingsSchema.js';
import {
  getOrgConsumptionSummary,
  getUserBudgetStatus,
  setOrgTokenBudget,
  setUserTokenBudget,
} from '../services/aiTokenBudgetService.js';

export async function getAiTokenBudgetsHandler(req: Request, res: Response): Promise<void> {
  const summary = await getOrgConsumptionSummary();
  res.status(200).json(summary);
}

export async function setOrgTokenBudgetHandler(req: Request, res: Response): Promise<void> {
  const parsed = setOrgTokenBudgetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name }; // authenticate guarantees req.user
  const newLimit = await setOrgTokenBudget(parsed.data, actor);
  res.status(200).json({ monthly_limit: newLimit });
}

export async function setUserTokenBudgetHandler(req: Request, res: Response): Promise<void> {
  const parsed = setUserTokenBudgetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const userIdResult = z.string().uuid().safeParse(req.params['userId']);
  if (!userIdResult.success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid user ID format' } });
    return;
  }
  const userId = userIdResult.data;
  const actor = { id: req.user!.id, name: req.user!.name };
  await setUserTokenBudget(userId, parsed.data, actor);
  res.status(200).json({ user_id: userId, monthly_limit: parsed.data.monthly_limit });
}

export async function getMyTokenBudgetStatusHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id; // authenticate guarantees req.user
  const userRole = req.user!.role;
  const status = await getUserBudgetStatus(userId, userRole);
  res.status(200).json(status);
}
