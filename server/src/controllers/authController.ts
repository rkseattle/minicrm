/**
 * Auth controller — handles login, logout, and current-user endpoints.
 * Request/response shaping only — no direct DB access.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { loginSchema } from '@minicrm/shared/schemas/userSchema.js';
import * as userService from '../services/userService.js';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';
import { sanitizeUser } from '../utils/userUtils.js';

/** JWT expiry — 8 hours expressed in seconds */
const JWT_EXPIRY_SECONDS = 8 * 60 * 60;

/** Cookie max-age in milliseconds (same duration as JWT) */
const COOKIE_MAX_AGE_MS = JWT_EXPIRY_SECONDS * 1000;

/**
 * POST /api/auth/login
 * Validates credentials, signs a JWT, and sets it as an httpOnly cookie.
 */
export async function login(req: Request, res: Response): Promise<void> {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
    return;
  }

  const { email, password } = parseResult.data;

  const user = await userService.findUserByEmail(email);
  if (!user) {
    res.status(401).json({
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
    return;
  }

  if (user.status === 'inactive') {
    res.status(403).json({
      error: {
        code: 'AUTH_ACCOUNT_DEACTIVATED',
        message: 'Your account has been deactivated. Contact an admin.',
      },
    });
    return;
  }

  if (user.status === 'invited' || !user.password_hash) {
    res.status(403).json({
      error: {
        code: 'AUTH_ACCOUNT_NOT_ACTIVATED',
        message: 'You must set your password before logging in.',
      },
    });
    return;
  }

  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) {
    res.status(401).json({
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
    return;
  }

  const tokenPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
  };

  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET ?? '', {
    expiresIn: JWT_EXPIRY_SECONDS,
  });

  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
  });

  res.status(200).json({
    user: sanitizeUser(user),
    mustChangePassword: user.must_change_password,
  });
}

/**
 * POST /api/auth/logout
 * Clears the auth cookie.
 */
export function logout(_req: Request, res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.status(200).json({ message: 'Logged out successfully' });
}

/**
 * GET /api/auth/me
 * Returns the currently authenticated user (decoded from JWT via middleware).
 */
export async function me(req: Request, res: Response): Promise<void> {
  // Refresh from DB to get current status/role (token may be stale)
  const user = await userService.findUserById(req.user!.id);
  if (!user || user.status === 'inactive') {
    res.status(401).json({
      error: { code: 'AUTH_INVALID_TOKEN', message: 'User not found or deactivated' },
    });
    return;
  }
  res.status(200).json({ user: sanitizeUser(user) });
}

/** Minimum password length constant — must match shared schema */
const PASSWORD_MIN_LENGTH = 8;

/**
 * POST /api/auth/change-password
 * Allows an authenticated user to change their own password.
 * Clears the must_change_password flag on success.
 */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };

  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'currentPassword and newPassword are required' },
    });
    return;
  }

  if (
    newPassword.length < PASSWORD_MIN_LENGTH ||
    !/[a-zA-Z]/.test(newPassword) ||
    !/[0-9]/.test(newPassword)
  ) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters and contain at least one letter and one number`,
      },
    });
    return;
  }

  const user = await userService.findUserById(req.user!.id);
  if (!user || !user.password_hash) {
    res.status(401).json({
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' },
    });
    return;
  }

  const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
  if (!passwordMatch) {
    res.status(401).json({
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Current password is incorrect' },
    });
    return;
  }

  await userService.setUserPasswordFromPlaintext(user.id, newPassword);
  // Clear the must_change_password flag now that the user has chosen their own password
  await userService.clearMustChangePassword(user.id);

  res.status(200).json({ message: 'Password changed successfully' });
}
