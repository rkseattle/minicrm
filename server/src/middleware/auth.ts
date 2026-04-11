/**
 * Authentication middleware.
 * Verifies the JWT stored in the httpOnly cookie, then performs a live DB
 * lookup to confirm the user is still active and does not have a forced
 * password-change pending (MINCRM-74).
 */

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { JwtTokenPayload } from '../types/express.js';
import { findUserById } from '../services/userService.js';

/** Name of the cookie that holds the JWT */
export const AUTH_COOKIE_NAME = 'minicrm_token';

/**
 * Express middleware that validates the JWT from the httpOnly cookie and
 * checks the user's current status in the database.
 *
 * Returns 401 if the token is missing, invalid, or the user has been deactivated.
 * Returns 403 with code PASSWORD_CHANGE_REQUIRED if must_change_password is set,
 * except when the request targets /api/auth/change-password.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;

  if (!token) {
    res.status(401).json({
      error: { code: 'AUTH_MISSING_TOKEN', message: 'Authentication required' },
    });
    return;
  }

  let decoded: JwtTokenPayload;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET ?? '') as JwtTokenPayload;
  } catch {
    res.status(401).json({
      error: { code: 'AUTH_INVALID_TOKEN', message: 'Invalid or expired token' },
    });
    return;
  }

  // Live DB check — token may still be cryptographically valid after deactivation.
  // Wrapped in try/catch so a transient DB error returns 500 rather than hanging the request.
  let user: Awaited<ReturnType<typeof findUserById>>;
  try {
    user = await findUserById(decoded.id);
  } catch {
    next(new Error('Database error during authentication'));
    return;
  }

  if (!user || user.status !== 'active') {
    res.status(401).json({
      error: { code: 'USER_INACTIVE', message: 'Account is inactive' },
    });
    return;
  }

  // Invalidate sessions from before a password reset (MINCRM-157).
  // If password_changed_at is set, any JWT issued before that timestamp is invalid.
  // JWT iat is in whole seconds; password_changed_at has sub-second precision from Postgres.
  // Subtract 1 000 ms so that a token issued in the same second as the reset is not
  // rejected — the freshly issued auto-login JWT must not be immediately invalidated.
  if (user.password_changed_at && decoded.iat !== undefined) {
    const passwordChangedAtMs = user.password_changed_at.getTime();
    const tokenIssuedAtMs = decoded.iat * 1000;
    if (tokenIssuedAtMs < passwordChangedAtMs - 1000) {
      res.status(401).json({
        error: { code: 'AUTH_INVALID_TOKEN', message: 'Session invalidated — please log in again' },
      });
      return;
    }
  }

  // Enforce password change — all routes except change-password itself are blocked.
  // Use req.originalUrl so the check is path-prefix-agnostic.
  // Strip query string before comparing — .includes() on the full originalUrl is bypassable
  // via crafted query params (e.g. ?redirect=/change-password).
  if (user.must_change_password && req.originalUrl.split('?')[0] !== '/api/auth/change-password') {
    res.status(403).json({
      error: {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'You must change your password before continuing',
      },
    });
    return;
  }

  req.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
  };
  next();
}
