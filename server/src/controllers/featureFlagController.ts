/**
 * Feature flag controller — request/response shaping only.
 * All business logic lives in featureFlagService.
 * (MINCRM-463)
 */

import type { Request, Response } from 'express';
import {
  listFeatureFlags,
  updateFeatureFlag,
  isFlagEnabledForRole,
} from '../services/featureFlagService.js';
import { removeDemo } from '../services/demoService.js';
import {
  updateFeatureFlagSchema,
  FEATURE_FLAG_KEYS,
} from '@minicrm/shared/schemas/featureFlagSchema.js';
import type { MyFeatureFlagsResponse } from '@minicrm/shared/schemas/featureFlagSchema.js';

/**
 * GET /api/v1/admin/feature-flags
 * Returns all feature flags with active user counts. Admin only.
 */
export async function listFeatureFlagsHandler(req: Request, res: Response): Promise<void> {
  const flags = await listFeatureFlags();
  res.json({ flags });
}

/**
 * GET /api/v1/feature-flags/me
 * Returns the resolved enabled state for every feature flag for the calling user's role.
 * Available to all authenticated users (not admin-only).
 */
export async function getMyFeatureFlagsHandler(req: Request, res: Response): Promise<void> {
  const role = req.user!.role; // authenticate ensures req.user exists
  const entries = await Promise.all(
    FEATURE_FLAG_KEYS.map(async (key) => [key, await isFlagEnabledForRole(key, role)] as const),
  );
  const flags = Object.fromEntries(entries) as MyFeatureFlagsResponse;
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

  const onDisabled =
    key === 'demo_data'
      ? async (): Promise<void> => {
          await removeDemo();
        }
      : undefined;
  let updated: Awaited<ReturnType<typeof updateFeatureFlag>>;
  try {
    updated = await updateFeatureFlag(key, parsed.data, actor, { onDisabled });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'FEATURE_FLAG_INVALID_ROLE_OVERRIDE') {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: err instanceof Error ? err.message : 'Invalid role_overrides',
        },
      });
      return;
    }
    throw err;
  }

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
