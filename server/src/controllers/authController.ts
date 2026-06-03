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
  passwordComplexitySchema,
} from '@minicrm/shared/schemas/userSchema.js';
import * as userService from '../services/userService.js';
import { sendPasswordResetEmail } from '../services/emailService.js';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';
import { sanitizeUser } from '../utils/userUtils.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';
import {
  isLockedOut,
  recordFailedAttempt,
  clearFailedAttempts,
  secondsUntilUnlocked,
} from '../services/loginLockoutService.js';
import { issueMfaToken } from '../services/mfaService.js';
import { getMfaRequired } from '../services/settingsService.js';
import { isSsoBoundUser } from '../services/ssoService.js';
import logger from '../logger.js';

/**
 * JWT idle-expiry window — 30 minutes (MINCRM-365).
 * The token is refreshed by the client on activity, so the expiry slides with use.
 */
const JWT_IDLE_EXPIRY_SECONDS = 30 * 60;

/** Cookie max-age in milliseconds for idle-expiry tokens */
const COOKIE_MAX_AGE_MS = JWT_IDLE_EXPIRY_SECONDS * 1000;

/** Absolute session cap — 8 hours from original login (MINCRM-365) */
export const ABSOLUTE_SESSION_CAP_SECONDS = 8 * 60 * 60;

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

  // Account lockout check (MINCRM-391): reject before any DB or bcrypt work.
  if (isLockedOut(email)) {
    const retryAfter = secondsUntilUnlocked(email);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: {
        code: 'ACCOUNT_TEMPORARILY_LOCKED',
        message:
          'Your account is temporarily locked due to too many failed login attempts. Please try again later.',
      },
    });
    return;
  }

  const user = await userService.findUserByEmail(email);
  if (!user) {
    recordFailedAttempt(email);
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
    recordFailedAttempt(email);
    res.status(401).json({
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
    return;
  }

  clearFailedAttempts(email);

  // SSO-bound users (non-admin) must authenticate via their IdP, not a password. (MINCRM-399)
  // Admins are exempt so there is always an escape hatch to recover from a misconfigured IdP.
  if (isSsoBoundUser(user)) {
    res.status(403).json({
      error: {
        code: 'AUTH_SSO_REQUIRED',
        message: 'Your account uses single sign-on. Please log in via your identity provider.',
      },
    });
    return;
  }

  // MFA challenge: if user has MFA enabled, issue a short-lived pre-auth token
  // instead of the session cookie. The client completes login via /auth/mfa/verify-login. (MINCRM-392)
  if (user.mfa_enabled) {
    const mfaToken = issueMfaToken(user.id);
    res.status(200).json({ mfaRequired: true, mfaToken });
    return;
  }

  // If MFA is org-required but user has not set it up, return a flag so the
  // client can redirect to the setup flow. Session cookie is still issued so
  // the user can complete setup without being fully locked out.
  const mfaRequired = await getMfaRequired();
  const mfaSetupRequired = mfaRequired && !user.mfa_enabled;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    // login_at marks when this session was originally created; preserved across
    // every refresh so the 8-hour absolute cap is always measured from first login. (MINCRM-365)
    login_at: nowSeconds,
  };

  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET ?? '', {
    expiresIn: JWT_IDLE_EXPIRY_SECONDS,
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
    mfaSetupRequired,
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

  const complexityResult = passwordComplexitySchema.safeParse(newPassword);
  if (!complexityResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: complexityResult.error.errors[0].message,
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
  const resetNowSeconds = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    login_at: resetNowSeconds,
  };

  const sessionToken = jwt.sign(tokenPayload, process.env.JWT_SECRET ?? '', {
    expiresIn: JWT_IDLE_EXPIRY_SECONDS,
  });

  res.cookie(AUTH_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
  });

  res.status(200).json({ user: sanitizeUser(user) });
}

/**
 * POST /api/auth/refresh
 * Issues a refreshed JWT for an authenticated user, resetting the idle timeout.
 *
 * The original `login_at` claim is preserved so the 8-hour absolute session cap
 * is enforced regardless of how many times the token is refreshed. (MINCRM-365)
 *
 * Returns 401 AUTH_SESSION_ABSOLUTE_TIMEOUT if the absolute cap has been reached;
 * this check is redundant with the authenticate middleware but explicit here for
 * clarity. The client treats any 401 from this endpoint as a forced logout.
 */
export async function refreshSession(req: Request, res: Response): Promise<void> {
  const decoded = req.user!;
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Derive original login_at: use value from decoded token or fall back to now
  // (graceful handling of tokens issued before this feature was deployed).
  const loginAt = decoded.login_at ?? nowSeconds;

  const sessionAgeSeconds = nowSeconds - loginAt;
  if (sessionAgeSeconds >= ABSOLUTE_SESSION_CAP_SECONDS) {
    res.status(401).json({
      error: {
        code: 'AUTH_SESSION_ABSOLUTE_TIMEOUT',
        message: 'Your session has reached the maximum allowed duration. Please sign in again.',
      },
    });
    return;
  }

  const tokenPayload = {
    id: decoded.id,
    email: decoded.email,
    name: decoded.name,
    role: decoded.role,
    status: decoded.status,
    login_at: loginAt,
  };

  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET ?? '', {
    expiresIn: JWT_IDLE_EXPIRY_SECONDS,
  });

  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
  });

  res.status(200).json({ ok: true });
}
