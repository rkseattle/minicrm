/**
 * Feature flag controller — request/response shaping only.
 * All business logic lives in featureFlagService.
 * (MINCRM-463)
 */

import type { Request, Response } from 'express';
import { listFeatureFlags, updateFeatureFlag } from '../services/featureFlagService.js';
import { updateFeatureFlagSchema } from '@minicrm/shared/schemas/featureFlagSchema.js';

/**
 * GET /api/v1/admin/feature-flags
 * Returns all feature flags with active user counts. Admin only.
 */
export async function listFeatureFlagsHandler(req: Request, res: Response): Promise<void> {
  const flags = await listFeatureFlags();
  res.json({ flags });
}

/**
 * PATCH /api/v1/admin/feature-flags/:key
 * Updates the enabled state and/or role overrides for a feature flag. Admin only.
 */
export async function updateFeatureFlagHandler(req: Request, res: Response): Promise<void> {
  const key = req.params['key'] as string;

  const parsed = updateFeatureFlagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request body',
      },
    });
    return;
  }

  // req.user is guaranteed by authenticate middleware upstream
  const actor = { id: req.user!.id, name: req.user!.name }; // authenticate ensures req.user exists

  const updated = await updateFeatureFlag(key, parsed.data, actor);
  if (!updated) {
    res.status(404).json({
      error: {
        code: 'FEATURE_FLAG_NOT_FOUND',
        message: `Feature flag '${key}' not found`,
      },
    });
    return;
  }

  res.json({ flag: updated });
}
