/**
 * User controller — handles user management endpoints.
 * All endpoints except setPassword are admin-gated via requireRole middleware.
 * Request/response shaping only — no direct DB access.
 */

import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  inviteUserSchema,
  setPasswordSchema,
  adminSetPasswordSchema,
  updateRoleSchema,
  updatePreferredLanguageSchema,
  updateNotificationPrefsSchema,
} from '@minicrm/shared/schemas/userSchema.js';

/** Zod schema for PATCH /users/:id/status body (MINCRM-561) */
const updateStatusSchema = z.object({
  active: z.boolean({
    required_error: 'active is required',
    invalid_type_error: 'active must be a boolean',
  }),
});
import * as userService from '../services/userService.js';
import type { ActiveUserRow } from '../services/userService.js';
import type { JwtTokenPayload } from '../types/express.js';
import { sanitizeUser } from '../utils/userUtils.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import { countActiveNotificationRecipients } from '../services/userService.js';
import { sendInviteEmail } from '../services/emailService.js';

/** Invite token expiry — 72 hours */
const INVITE_TOKEN_EXPIRY = '72h';

/**
 * POST /api/users/invite
 * Admin creates a new user with status='invited'. No password is set yet.
 * Returns the created user and an invite token the admin can share.
 */
export async function inviteUser(req: Request, res: Response): Promise<void> {
  const parseResult = inviteUserSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
    return;
  }

  const { email, name, role } = parseResult.data;

  const existing = await userService.findUserByEmail(email);
  if (existing) {
    res.status(409).json({
      error: {
        code: 'USER_EMAIL_CONFLICT',
        message: 'A user with that email already exists',
      },
    });
    return;
  }

  const user = await userService.createUser(
    {
      email,
      name,
      role,
      passwordHash: null,
      status: 'invited',
    },
    { id: req.user!.id, name: req.user!.name },
  );

  // Generate a short-lived invite token so the invited user can set their password.
  const inviteToken = jwt.sign({ id: user.id, purpose: 'invite' }, process.env.JWT_SECRET ?? '', {
    expiresIn: INVITE_TOKEN_EXPIRY,
  });

  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  const setPasswordUrl = `${appUrl}/set-password?token=${inviteToken}`;

  // Fire-and-forget — email failure must not block the invite response.
  void sendInviteEmail(user.email, user.name, setPasswordUrl);

  res.status(201).json({
    user: sanitizeUser(user),
    inviteToken,
    setPasswordPath: `/set-password?token=${inviteToken}`,
  });
}

/**
 * GET /api/users
 * Returns paginated users. Admin only.
 *   ?page=<n>  — 1-based page number (default 1)
 *   ?limit=<n> — records per page (default 50, max 100)
 */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const paginationParsed = paginationParamsSchema.safeParse({
    page: req.query.page,
    limit: req.query.limit,
  });
  if (!paginationParsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: paginationParsed.error.errors[0].message },
    });
    return;
  }

  const result = await userService.listUsers(paginationParsed.data);
  res.status(200).json({ ...result, data: result.data.map(sanitizeUser) });
}

/**
 * GET /api/users/active
 * Returns id and name for every active user. Available to all authenticated users
 * so that owner-assignment dropdowns work for reps as well as admins.
 */
export async function listActiveUsersHandler(_req: Request, res: Response): Promise<void> {
  const users: ActiveUserRow[] = await userService.listActiveUsers();
  res.status(200).json({ users });
}

/**
 * PATCH /api/users/:id/role
 * Updates a user's role. Admin only.
 */
export async function updateUserRole(req: Request, res: Response): Promise<void> {
  const parseResult = updateRoleSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
    return;
  }

  const id = String(req.params['id']);
  const { role } = parseResult.data;

  const user = await userService.updateUserRole(id, role, {
    id: req.user!.id,
    name: req.user!.name,
  });
  if (!user) {
    res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
    return;
  }

  res.status(200).json({ user: sanitizeUser(user) });
}

/**
 * PATCH /api/users/:id/deactivate
 * Sets user status to 'inactive'. Admin only.
 */
export async function deactivateUser(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const user = await userService.updateUserStatus(id, 'inactive', {
    id: req.user!.id,
    name: req.user!.name,
  });
  if (!user) {
    res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
    return;
  }

  res.status(200).json({ user: sanitizeUser(user) });
}

/**
 * PATCH /api/users/:id/reactivate
 * Sets user status to 'active'. Admin only.
 */
export async function reactivateUser(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const user = await userService.updateUserStatus(id, 'active', {
    id: req.user!.id,
    name: req.user!.name,
  });
  if (!user) {
    res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
    return;
  }

  res.status(200).json({ user: sanitizeUser(user) });
}

/**
 * PATCH /api/users/:id/status
 * Sets user status via { active: boolean }. Admin only.
 * Rejects self-deactivation with 409. (MINCRM-561)
 */
export async function updateUserStatusHandler(req: Request, res: Response): Promise<void> {
  const parseResult = updateStatusSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
    return;
  }

  const id = String(req.params['id']);
  const { active } = parseResult.data;

  if (!active && id === req.user!.id) {
    res.status(409).json({
      error: {
        code: 'SELF_DEACTIVATION_NOT_ALLOWED',
        message: 'Cannot deactivate your own account',
      },
    });
    return;
  }

  const newStatus = active ? 'active' : 'inactive';
  const user = await userService.updateUserStatus(id, newStatus, {
    id: req.user!.id,
    name: req.user!.name,
  });
  if (!user) {
    res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
    return;
  }

  res.status(200).json({ user: sanitizeUser(user) });
}

/**
 * POST /api/users/set-password
 * Unauthenticated endpoint. Accepts an invite token and a new password.
 * Verifies the token, hashes the password, sets it, and activates the user.
 */
export async function setPassword(req: Request, res: Response): Promise<void> {
  const parseResult = setPasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
    return;
  }

  const { token, password } = parseResult.data;

  let decoded: JwtTokenPayload;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET ?? '') as JwtTokenPayload;
  } catch {
    res.status(400).json({
      error: {
        code: 'AUTH_INVALID_TOKEN',
        message: 'Invite token is invalid or has expired',
      },
    });
    return;
  }

  if (decoded.purpose !== 'invite') {
    res.status(400).json({
      error: { code: 'AUTH_INVALID_TOKEN', message: 'Invalid invite token' },
    });
    return;
  }

  const user = await userService.findUserById(decoded.id);
  if (!user) {
    res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
    return;
  }

  if (user.status !== 'invited') {
    res.status(409).json({
      error: {
        code: 'USER_ALREADY_ACTIVATED',
        message: 'This account has already been activated',
      },
    });
    return;
  }

  await userService.setUserPasswordFromPlaintext(user.id, password);
  await userService.updateUserStatus(user.id, 'active');

  res.status(200).json({ message: 'Password set successfully. You may now log in.' });
}

/**
 * GET /api/users/me/language
 * Returns the authenticated user's stored language preference, or null if not set.
 */
export async function getMyPreferredLanguage(req: Request, res: Response): Promise<void> {
  const language = await userService.getUserPreferredLanguage(req.user!.id);
  res.status(200).json({ language });
}

/**
 * PATCH /api/users/me/language
 * Persists the authenticated user's language preference.
 * Accepts { language: SupportedLocale | null } — null clears the preference.
 */
export async function setMyPreferredLanguage(req: Request, res: Response): Promise<void> {
  const parseResult = updatePreferredLanguageSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
    return;
  }

  const { language } = parseResult.data;

  const user = await userService.setUserPreferredLanguage(req.user!.id, language);
  if (!user) {
    res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
    return;
  }

  res.status(200).json({ language: user.preferred_language });
}

/**
 * GET /api/users/me/notification-preferences
 * Returns the authenticated user's email notification preference flags. (MINCRM-163)
 */
export async function getMyNotificationPrefs(req: Request, res: Response): Promise<void> {
  const prefs = await userService.getNotificationPrefs(req.user!.id);
  if (!prefs) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    return;
  }
  res.status(200).json({ preferences: prefs });
}

/**
 * PATCH /api/users/me/notification-preferences
 * Persists the authenticated user's email notification preference flags. (MINCRM-163)
 */
export async function updateMyNotificationPrefs(req: Request, res: Response): Promise<void> {
  const parseResult = updateNotificationPrefsSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
    return;
  }

  const user = await userService.updateNotificationPrefs(req.user!.id, parseResult.data);
  if (!user) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    return;
  }

  res.status(200).json({
    preferences: {
      notify_overdue_tasks: user.notify_overdue_tasks,
      notify_assignments: user.notify_assignments,
      notify_deal_stage_changes: user.notify_deal_stage_changes,
    },
  });
}

/**
 * GET /api/users/me/notification-recipient-count
 * Returns the count of active users with at least one notification enabled. Admin only. (MINCRM-163)
 */
export async function getNotificationRecipientCount(_req: Request, res: Response): Promise<void> {
  const count = await countActiveNotificationRecipients();
  res.status(200).json({ count });
}

/**
 * POST /api/users/:id/reset-onboarding
 * Admin resets a user's onboarding_completed flag to false. Admin only. (MINCRM-410)
 *
 * @param req - Express request with `id` param (target user UUID).
 * @param res - Express response.
 */
export async function resetOnboardingHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const actor = { id: req.user!.id, name: req.user!.name };

  if (id === req.user!.id) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Admins cannot reset their own onboarding checklist' },
    });
    return;
  }

  try {
    await userService.resetUserOnboarding(id as string, actor);
    res.status(200).json({ success: true });
  } catch (err) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'USER_NOT_FOUND'
    ) {
      res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      return;
    }
    throw err;
  }
}

/**
 * POST /api/users/:id/api-token
 * Issues a new API token for a service account user. Admin only. (MINCRM-536)
 * Any previously issued token is atomically revoked on issuance.
 * The plaintext token is returned exactly once — it is never stored.
 */
export async function issueApiToken(req: Request, res: Response): Promise<void> {
  const targetUserId = String(req.params['id']);
  const actor = { id: req.user!.id, name: req.user!.name };

  const targetUser = await userService.findUserById(targetUserId);
  if (!targetUser) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    return;
  }

  if (targetUser.role !== 'service_account') {
    res.status(400).json({
      error: {
        code: 'INVALID_OPERATION',
        message: 'API tokens can only be issued for service_account users',
      },
    });
    return;
  }

  const result = await userService.issueServiceAccountToken(targetUserId, actor);
  if (!result) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    return;
  }

  res.status(201).json({ token: result.plaintextToken, issued_at: result.issuedAt });
}

/**
 * DELETE /api/users/:id/api-token
 * Revokes the API token for a service account user. Admin only. (MINCRM-536)
 * After revocation the token is immediately invalid — no grace period.
 */
export async function revokeApiToken(req: Request, res: Response): Promise<void> {
  const targetUserId = String(req.params['id']);
  const actor = { id: req.user!.id, name: req.user!.name };

  const targetUser = await userService.findUserById(targetUserId);
  if (!targetUser) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    return;
  }

  if (targetUser.role !== 'service_account') {
    res.status(400).json({
      error: {
        code: 'INVALID_OPERATION',
        message: 'API tokens can only be revoked for service_account users',
      },
    });
    return;
  }

  const revoked = await userService.revokeServiceAccountToken(targetUserId, actor);
  if (!revoked) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    return;
  }

  res.status(200).json({ success: true });
}

/**
 * POST /api/users/:id/admin-set-password
 * Admin sets a user's password directly, without requiring an invite token.
 * The target user will be prompted to change their password on next login.
 * Admin only.
 */
export async function adminSetPassword(req: Request, res: Response): Promise<void> {
  const parseResult = adminSetPasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
    return;
  }

  const targetUserId = String(req.params['id']);
  const { password } = parseResult.data;

  const targetUser = await userService.findUserById(targetUserId);
  if (!targetUser) {
    res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
    return;
  }

  if (targetUser.status === 'inactive') {
    res.status(409).json({
      error: {
        code: 'USER_INACTIVE',
        message: 'Cannot set password for a deactivated user',
      },
    });
    return;
  }

  const updated = await userService.adminSetUserPassword(
    req.user!.id,
    targetUserId,
    password,
    req.user!.name,
  );
  if (!updated) {
    res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
    return;
  }

  res.status(200).json({ user: sanitizeUser(updated) });
}
