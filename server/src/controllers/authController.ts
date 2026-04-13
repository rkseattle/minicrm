/**
 * Auth controller — handles login, logout, and current-user endpoints.
 * Request/response shaping only — no direct DB access.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import {
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  PASSWORD_MIN_LENGTH,
} from '@minicrm/shared/schemas/userSchema.js';
import * as userService from '../services/userService.js';
import { sendPasswordResetEmail } from '../services/emailService.js';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';
import { sanitizeUser } from '../utils/userUtils.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';
import logger from '../logger.js';

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

  // Fire-and-forget: audit login event — failure must not block the login response (MINCRM-170)
  void writeAuditEntryBestEffort({
    recordType: 'user',
    recordId: user.id,
    recordName: user.name,
    eventType: 'login',
    changedById: user.id,
    changedByName: user.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write login audit entry'));
}

/**
 * POST /api/auth/logout
 * Clears the auth cookie and writes a logout audit entry.
 */
export async function logout(req: Request, res: Response): Promise<void> {
  const user = req.user!;

  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.status(200).json({ message: 'Logged out successfully' });

  // Fire-and-forget: audit logout event — failure must not block the response (MINCRM-170)
  void writeAuditEntryBestEffort({
    recordType: 'user',
    recordId: user.id,
    recordName: user.name,
    eventType: 'logout',
    changedById: user.id,
    changedByName: user.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write logout audit entry'));
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

  // setUserPasswordFromPlaintext calls setUserPassword with mustChangePassword=false (default),
  // which already clears the flag in the same UPDATE — no second query needed.
  await userService.setUserPasswordFromPlaintext(user.id, newPassword);

  res.status(200).json({ message: 'Password changed successfully' });
}

/** Base URL used to construct the reset link (falls back to localhost in dev) */
const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:5173';
if (!process.env.APP_BASE_URL && process.env.NODE_ENV === 'production') {
  console.warn(
    '[authController] APP_BASE_URL is not set — password reset links will point to localhost. Set APP_BASE_URL in production.',
  );
}

/**
 * POST /api/auth/forgot-password
 * Accepts an email address and initiates the password reset flow.
 * Always returns 200 regardless of whether the email matches a user,
 * to prevent user enumeration (MINCRM-156).
 */
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const parseResult = forgotPasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
    return;
  }

  const { email } = parseResult.data;

  // Look up the user — but do not reveal whether the email exists.
  const user = await userService.findUserByEmail(email);

  if (user && user.status === 'active') {
    const { plaintextToken } = await userService.createPasswordResetToken(user.id);
    const resetUrl = `${APP_BASE_URL}/reset-password?token=${plaintextToken}`;
    await sendPasswordResetEmail(user.email, resetUrl);
  }

  // Always respond with 200 — same message whether or not the user exists.
  res.status(200).json({
    message: 'If an account with that email exists, a reset link has been sent.',
  });
}

/**
 * POST /api/auth/reset-password
 * Validates a reset token, updates the user's password, and logs them in.
 * Invalidates the token after use (MINCRM-157).
 */
export async function resetPassword(req: Request, res: Response): Promise<void> {
  const parseResult = resetPasswordSchema.safeParse(req.body);
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

  const user = await userService.resetPasswordWithToken(token, password);
  if (!user) {
    res.status(400).json({
      error: {
        code: 'RESET_TOKEN_INVALID',
        message: 'This reset link is invalid or has expired.',
      },
    });
    return;
  }

  // Issue a fresh session for the user so they are logged in immediately.
  const tokenPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
  };

  const JWT_EXPIRY_SECONDS = 8 * 60 * 60;
  const COOKIE_MAX_AGE_MS = JWT_EXPIRY_SECONDS * 1000;

  const sessionToken = jwt.sign(tokenPayload, process.env.JWT_SECRET ?? '', {
    expiresIn: JWT_EXPIRY_SECONDS,
  });

  res.cookie(AUTH_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
  });

  res.status(200).json({ user: sanitizeUser(user) });
}
