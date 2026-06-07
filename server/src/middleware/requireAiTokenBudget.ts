/**
 * AI token budget enforcement middleware.
 * Rejects requests from reps who have consumed 100% of their monthly token budget.
 * Admins are always allowed through (they are exempt from per-user budget limits).
 *
 * Must be used after the `authenticate` middleware so that req.user is available.
 * Compose after requireAiEnabled so AI is confirmed on before checking budgets:
 *
 *   router.post('/nli', authenticate, requireAiEnabled, requireAiTokenBudget, asyncHandler(handler))
 *
 * (MINCRM-458)
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getUserBudgetStatus } from '../services/aiTokenBudgetService.js';

export const requireAiTokenBudget: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
      return;
    }

    // Admins are exempt — always allowed through.
    if (req.user.role === 'admin') {
      next();
      return;
    }

    const status = await getUserBudgetStatus(req.user.id, req.user.role);
    if (status.status === 'exceeded') {
      res.status(429).json({
        error: {
          code: 'AI_BUDGET_EXCEEDED',
          message: "You've reached your monthly AI limit — contact your admin to increase it",
        },
      });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
};
