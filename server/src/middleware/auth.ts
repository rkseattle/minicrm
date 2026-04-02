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

  // Live DB check — token may still be cryptographically valid after deactivation
  const user = await findUserById(decoded.id);
  if (!user || user.status !== 'active') {
    res.status(401).json({
      error: { code: 'USER_INACTIVE', message: 'Account is inactive' },
    });
    return;
  }

  // Enforce password change — all routes except change-password itself are blocked
  if (user.must_change_password && req.path !== '/change-password') {
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
