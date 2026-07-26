/**
 * Coverage/TIA health controller — request/response shaping only. All
 * health-check logic lives in coverageHealthService. (MINCRM-637)
 */

import type { Request, Response } from 'express';
import { getCoverageHealth } from '../services/coverageHealthService.js';

export async function getCoverageHealthHandler(_req: Request, res: Response): Promise<void> {
  const health = await getCoverageHealth();
  res.status(health.status === 'ok' ? 200 : 503).json(health);
}
