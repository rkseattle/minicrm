/**
 * Demo data controller.
 * Request/response shaping for the /api/v1/admin/demo endpoints.
 * All business logic lives in demoService.
 */

import type { Request, Response } from 'express';
import * as demoService from '../services/demoService.js';

/**
 * GET /api/v1/admin/demo/status
 * Returns whether demo data is currently present.
 */
export async function getDemoStatusHandler(_req: Request, res: Response): Promise<void> {
  const status = await demoService.getDemoStatus();
  res.status(200).json(status);
}

/**
 * POST /api/v1/admin/demo/seed
 * Seeds demo data. 409 if already present.
 */
export async function seedDemoHandler(_req: Request, res: Response): Promise<void> {
  const result = await demoService.seedDemo();
  if (!result.seeded) {
    res.status(409).json({
      error: {
        code: 'DEMO_ALREADY_EXISTS',
        message: 'Demo data is already present. Use reset to re-seed.',
      },
    });
    return;
  }
  res.status(200).json({ success: true });
}

/**
 * POST /api/v1/admin/demo/reset
 * Removes all demo data then re-seeds from scratch.
 */
export async function resetDemoHandler(_req: Request, res: Response): Promise<void> {
  await demoService.resetDemo();
  res.status(200).json({ success: true });
}

/**
 * DELETE /api/v1/admin/demo
 * Removes all demo-flagged records. 409 if none present.
 */
export async function removeDemoHandler(_req: Request, res: Response): Promise<void> {
  const result = await demoService.removeDemo();
  if (!result.removed) {
    res.status(409).json({
      error: {
        code: 'DEMO_NOT_PRESENT',
        message: 'No demo data is present to remove.',
      },
    });
    return;
  }
  res.status(200).json({ success: true });
}
