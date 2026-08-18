/**
 * Middleware that rejects requests to /api/v1/ai/* with 503 when the master
 * AI toggle is off. Client-side hiding is UX-only; this guard is the actual
 * security and availability control.
 */

import type { Request, Response, NextFunction } from 'express';
import { isAiEnabled } from '../services/aiConfigService.js';

export async function requireAiEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const enabled = await isAiEnabled();
    if (!enabled) {
      res.status(503).json({
        error: { code: 'AI_DISABLED', message: 'AI features are disabled' },
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
