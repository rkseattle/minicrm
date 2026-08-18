/**
 * Feature flag controller — request/response shaping only.
 * All business logic lives in featureFlagService.
 */

import type { Request, Response } from 'express';
import {
  listFeatureFlags,
  updateFeatureFlag,
  isFlagEnabledForUser,
  getBetaUsersForFlag,
  enrollBetaUser,
  removeBetaUser,
  listUserOverrides,
  upsertUserOverride,
  deleteUserOverride,
  listFlagGroups,
  createFlagGroup,
  updateFlagGroup,
  deleteFlagGroup,
  getFlagGroupBetaUsers,
  addGroupBetaUser,
  removeGroupBetaUser,
} from '../services/featureFlagService.js';
import { removeDemo } from '../services/demoService.js';
import {
  updateFeatureFlagSchema,
  enrollBetaUserSchema,
  upsertUserOverrideSchema,
  createFlagGroupSchema,
  updateFlagGroupSchema,
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

/** The ai_features master toggle's key — every other ai_* flag is its child. */
const AI_MASTER_FEATURE_FLAG_KEY = 'ai_features';

/**
 * GET /api/v1/feature-flags/me
 * Returns the resolved enabled state for every feature flag for the calling user's role.
 * Available to all authenticated users (not admin-only).
 */
export async function getMyFeatureFlagsHandler(req: Request, res: Response): Promise<void> {
  const { id: userId, role } = req.user!; // authenticate ensures req.user exists

  // Resolve ai_features once and pass it into every ai_* sub-feature flag's
  // resolution instead of letting each one recompute it — isFlagEnabledForUser's
  // own master-gate step otherwise reruns 2 fresh, uncached queries per sub-flag
  // for what is always the same result within a single request.
  const aiFeaturesEnabled = await isFlagEnabledForUser(AI_MASTER_FEATURE_FLAG_KEY, userId, role);

  const entries = await Promise.all(
    FEATURE_FLAG_KEYS.map(async (key) => {
      if (key === AI_MASTER_FEATURE_FLAG_KEY) {
        return [key, aiFeaturesEnabled] as const;
      }
      return [key, await isFlagEnabledForUser(key, userId, role, aiFeaturesEnabled)] as const;
    }),
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
    if (code === 'FEATURE_FLAG_UNKNOWN_ROLE_KEY') {
      res.status(422).json({
        error: {
          code: 'FEATURE_FLAG_UNKNOWN_ROLE_KEY',
          message: err instanceof Error ? err.message : 'Unknown role key in role_overrides',
        },
      });
      return;
    }
    if (code === 'FLAG_GROUP_NOT_FOUND') {
      res.status(400).json({
        error: {
          code: 'FLAG_GROUP_NOT_FOUND',
          message: err instanceof Error ? err.message : 'Group not found',
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

// ── Per-user overrides ────────────────────────────────────────────

/**
 * GET /api/v1/admin/feature-flags/:key/overrides
 * Returns all per-user overrides for this flag. Admin only.
 */
export async function listUserOverridesHandler(req: Request, res: Response): Promise<void> {
  const key = req.params['key'] as string;
  const overrides = await listUserOverrides(key);
  res.json({ overrides });
}

/**
 * PUT /api/v1/admin/feature-flags/:key/overrides/:userId
 * Upserts a per-user override (force_enabled or force_disabled). Admin only.
 * Body: { override: 'force_enabled' | 'force_disabled', reason?: string }
 */
export async function upsertUserOverrideHandler(req: Request, res: Response): Promise<void> {
  const key = req.params['key'] as string;
  const userId = req.params['userId'] as string;

  if (!UUID_REGEX.test(userId)) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'userId must be a valid UUID' },
    });
    return;
  }

  const parsed = upsertUserOverrideSchema.safeParse(req.body);
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

  let entry: Awaited<ReturnType<typeof upsertUserOverride>>;
  try {
    entry = await upsertUserOverride(
      key,
      userId,
      parsed.data.override,
      parsed.data.reason ?? null,
      actor,
    );
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
    throw err;
  }

  res.json({ override: entry });
}

/**
 * DELETE /api/v1/admin/feature-flags/:key/overrides/:userId
 * Removes a per-user override. Admin only.
 */
export async function deleteUserOverrideHandler(req: Request, res: Response): Promise<void> {
  const key = req.params['key'] as string;
  const userId = req.params['userId'] as string;

  if (!UUID_REGEX.test(userId)) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'userId must be a valid UUID' },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name }; // authenticate ensures req.user exists

  const removed = await deleteUserOverride(key, userId, actor);
  if (!removed) {
    res.status(404).json({
      error: {
        code: 'USER_OVERRIDE_NOT_FOUND',
        message: `No override exists for this user on flag '${key}'`,
      },
    });
    return;
  }

  res.status(204).send();
}

// ── Flag group handlers ─────────────────────────────────────────

/**
 * GET /api/v1/admin/feature-flags/groups
 * Returns all flag groups with member_count, beta_user_count. Admin only.
 */
export async function listFlagGroupsHandler(req: Request, res: Response): Promise<void> {
  const groups = await listFlagGroups();
  res.json({ groups });
}

/**
 * POST /api/v1/admin/feature-flags/groups
 * Creates a new flag group. Body: { group_key, label, description }. Admin only.
 */
export async function createFlagGroupHandler(req: Request, res: Response): Promise<void> {
  const parsed = createFlagGroupSchema.safeParse(req.body);
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

  let group: Awaited<ReturnType<typeof createFlagGroup>>;
  try {
    group = await createFlagGroup(parsed.data, actor);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'FLAG_GROUP_DUPLICATE_KEY') {
      res.status(409).json({
        error: {
          code: 'FLAG_GROUP_DUPLICATE_KEY',
          message: err instanceof Error ? err.message : 'Group key already exists',
        },
      });
      return;
    }
    throw err;
  }

  res.status(201).json({ group });
}

/**
 * PATCH /api/v1/admin/feature-flags/groups/:key
 * Updates a flag group's enabled state, enable_at, label, or description. Admin only.
 */
export async function updateFlagGroupHandler(req: Request, res: Response): Promise<void> {
  const groupKey = req.params['key'] as string;

  const parsed = updateFlagGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request body',
      },
    });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'At least one field (enabled, label, description, enable_at) is required',
      },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name }; // authenticate ensures req.user exists
  const updated = await updateFlagGroup(groupKey, parsed.data, actor);

  if (!updated) {
    res.status(404).json({
      error: {
        code: 'FLAG_GROUP_NOT_FOUND',
        message: `Feature flag group '${groupKey}' not found`,
      },
    });
    return;
  }

  res.json({ group: updated });
}

/**
 * DELETE /api/v1/admin/feature-flags/groups/:key
 * Deletes a flag group, atomically unassigning any member flags first. Admin only.
 */
export async function deleteFlagGroupHandler(req: Request, res: Response): Promise<void> {
  const groupKey = req.params['key'] as string; // Express guarantees :key is a string when route matches
  const actor = { id: req.user!.id, name: req.user!.name }; // authenticate ensures req.user exists

  const deleted = await deleteFlagGroup(groupKey, actor);

  if (!deleted) {
    res.status(404).json({
      error: {
        code: 'FLAG_GROUP_NOT_FOUND',
        message: `Feature flag group '${groupKey}' not found`,
      },
    });
    return;
  }

  res.status(204).send();
}

/**
 * GET /api/v1/admin/feature-flags/groups/:key/beta-users
 * Returns the list of users enrolled in a group's beta. Admin only.
 */
export async function listGroupBetaUsersHandler(req: Request, res: Response): Promise<void> {
  const groupKey = req.params['key'] as string;
  try {
    const users = await getFlagGroupBetaUsers(groupKey);
    res.json({ users });
  } catch (err) {
    const domainErr = err as { code?: string };
    if (domainErr.code === 'FLAG_GROUP_NOT_FOUND') {
      res.status(404).json({
        error: { code: 'FLAG_GROUP_NOT_FOUND', message: `Group '${groupKey}' not found` },
      });
      return;
    }
    throw err;
  }
}

/**
 * POST /api/v1/admin/feature-flags/groups/:key/beta-users
 * Enrolls a user in a group's beta. Admin only.
 * Body: { userId: string }
 */
export async function enrollGroupBetaUserHandler(req: Request, res: Response): Promise<void> {
  const groupKey = req.params['key'] as string;

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

  let entry: Awaited<ReturnType<typeof addGroupBetaUser>>;
  try {
    entry = await addGroupBetaUser(groupKey, parsed.data.userId, actor);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'FLAG_GROUP_NOT_FOUND') {
      res.status(404).json({
        error: {
          code: 'FLAG_GROUP_NOT_FOUND',
          message: err instanceof Error ? err.message : 'Group not found',
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
    if (code === 'GROUP_BETA_USER_ALREADY_ENROLLED') {
      res.status(409).json({
        error: {
          code: 'GROUP_BETA_USER_ALREADY_ENROLLED',
          message: err instanceof Error ? err.message : 'Already enrolled',
        },
      });
      return;
    }
    throw err;
  }

  res.status(201).json({ user: entry });
}

/**
 * DELETE /api/v1/admin/feature-flags/groups/:key/beta-users/:userId
 * Removes a user from a group's beta. Admin only.
 */
export async function removeGroupBetaUserHandler(req: Request, res: Response): Promise<void> {
  const groupKey = req.params['key'] as string;
  const userId = req.params['userId'] as string;

  if (!UUID_REGEX.test(userId)) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'userId must be a valid UUID' },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name }; // authenticate ensures req.user exists

  let removed: boolean;
  try {
    removed = await removeGroupBetaUser(groupKey, userId, actor);
  } catch (err) {
    const domainErr = err as { code?: string };
    if (domainErr.code === 'FLAG_GROUP_NOT_FOUND') {
      res.status(404).json({
        error: { code: 'FLAG_GROUP_NOT_FOUND', message: `Group '${groupKey}' not found` },
      });
      return;
    }
    throw err;
  }

  if (!removed) {
    res.status(404).json({
      error: {
        code: 'GROUP_BETA_USER_NOT_ENROLLED',
        message: `User is not enrolled in the beta for group '${groupKey}'`,
      },
    });
    return;
  }

  res.status(204).send();
}
