/**
 * User controller — handles user management endpoints.
 * All endpoints except setPassword are admin-gated via requireRole middleware.
 * Request/response shaping only — no direct DB access.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import {
  inviteUserSchema,
  setPasswordSchema,
  updateRoleSchema,
} from '@minicrm/shared/schemas/userSchema.js';
import * as userService from '../services/userService.js';
import type { UserRow } from '../services/userService.js';
import type { JwtTokenPayload } from '../types/express.js';

/** bcrypt work factor */
const BCRYPT_SALT_ROUNDS = 12;

/** Invite token expiry — 72 hours */
const INVITE_TOKEN_EXPIRY = '72h';

/**
 * Strips the password_hash field before returning a user object to the client.
 */
function sanitizeUser(user: UserRow): Omit<UserRow, 'password_hash'> {
  const { password_hash: _password_hash, ...safeUser } = user;
  return safeUser;
}

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

  const user = await userService.createUser({
    email,
    name,
    role,
    passwordHash: null,
    status: 'invited',
  });

  // Generate a short-lived invite token so the invited user can set their password.
  // In a real deployment this token would be embedded in the invite email link.
  const inviteToken = jwt.sign({ id: user.id, purpose: 'invite' }, process.env.JWT_SECRET ?? '', {
    expiresIn: INVITE_TOKEN_EXPIRY,
  });

  res.status(201).json({
    user: sanitizeUser(user),
    inviteToken,
    // Informational: the frontend would construct /set-password?token=<inviteToken>
    setPasswordPath: `/set-password?token=${inviteToken}`,
  });
}

/**
 * GET /api/users
 * Returns all users. Admin only.
 */
export async function listUsers(_req: Request, res: Response): Promise<void> {
  const users = await userService.listUsers();
  res.status(200).json({ users: users.map(sanitizeUser) });
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

  const user = await userService.updateUserRole(id, role);
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

  const user = await userService.updateUserStatus(id, 'inactive');
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

  const user = await userService.updateUserStatus(id, 'active');
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

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  await userService.setUserPassword(user.id, passwordHash);
  await userService.updateUserStatus(user.id, 'active');

  res.status(200).json({ message: 'Password set successfully. You may now log in.' });
}
