/**
 * Feature flag controller — request/response shaping only.
 * All business logic lives in featureFlagService.
 * (MINCRM-463)
 */

import type { Request, Response } from 'express';
import {
  listFeatureFlags,
  updateFeatureFlag,
  isFlagEnabledForUser,
  getBetaUsersForFlag,
  enrollBetaUser,
  removeBetaUser,
} from '../services/featureFlagService.js';
import { removeDemo } from '../services/demoService.js';
import {
  updateFeatureFlagSchema,
  enrollBetaUserSchema,
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
  const { id: userId, role } = req.user!; // authenticate ensures req.user exists
  const entries = await Promise.all(
    FEATURE_FLAG_KEYS.map(
      async (key) => [key, await isFlagEnabledForUser(key, userId, role)] as const,
    ),
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

/**
 * GET /api/v1/admin/feature-flags/:key/beta-users
 * Returns the list of users enrolled in the beta for this flag. Admin only.
 */
export async function listBetaUsersHandler(req: Request, res: Response): Promise<void> {
  const key = req.params['key'] as string;
  const users = await getBetaUsersForFlag(key);
  res.json({ users });
}

/**
 * POST /api/v1/admin/feature-flags/:key/beta-users
 * Enrolls a user in the beta for this flag. Admin only.
 * Body: { userId: string }
 */
export async function enrollBetaUserHandler(req: Request, res: Response): Promise<void> {
  const key = req.params['key'] as string;

  const parsed = enrollBetaUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request body',
      },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name }; // authenticate ensures req.user exists

  let entry: Awaited<ReturnType<typeof enrollBetaUser>>;
  try {
    entry = await enrollBetaUser(key, parsed.data.userId, actor);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'FEATURE_FLAG_NOT_FOUND') {
      res.status(404).json({
        error: {
          code: 'FEATURE_FLAG_NOT_FOUND',
          message: err instanceof Error ? err.message : 'Flag not found',
        },
      });
      return;
    }
    if (code === 'USER_NOT_FOUND') {
      res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: err instanceof Error ? err.message : 'User not found',
        },
      });
      return;
    }
    if (code === 'BETA_USER_ALREADY_ENROLLED') {
      res.status(409).json({
        error: {
          code: 'BETA_USER_ALREADY_ENROLLED',
          message: err instanceof Error ? err.message : 'Already enrolled',
        },
      });
      return;
    }
    throw err;
  }

  res.status(201).json({ user: entry });
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/v1/admin/feature-flags/:key/beta-users/:userId
 * Removes a user from the beta for this flag. Admin only.
 */
export async function removeBetaUserHandler(req: Request, res: Response): Promise<void> {
  const key = req.params['key'] as string;
  const userId = req.params['userId'] as string;

  if (!UUID_REGEX.test(userId)) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'userId must be a valid UUID' },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name }; // authenticate ensures req.user exists

  const removed = await removeBetaUser(key, userId, actor);
  if (!removed) {
    res.status(404).json({
      error: {
        code: 'BETA_USER_NOT_ENROLLED',
        message: `User is not enrolled in the beta for '${key}'`,
      },
    });
    return;
  }

  res.status(204).send();
}
