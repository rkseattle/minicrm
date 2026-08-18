/**
 * Authentication middleware.
 * Verifies the JWT stored in the httpOnly cookie, then performs a live DB
 * lookup to confirm the user is still active and does not have a forced
 * password-change pending.
 *
 * JWT expiry is 30 minutes (sliding idle timeout). The `login_at`
 * claim enforces an 8-hour absolute session cap regardless of refresh activity.
 */

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { JwtTokenPayload } from '../types/express.js';
import { findUserById, findUserByApiToken } from '../services/userService.js';
import { runWithRequestContext } from '../utils/requestContext.js';

/**
 * Session-cookie policy — name, lifetime, and attributes — lives in
 * auth/sessionCookie.ts, alongside the helpers that write and clear the cookie.
 * Re-exported here because callers have long imported the name from this
 * module.
 */
import { AUTH_COOKIE_NAME, ABSOLUTE_SESSION_CAP_SECONDS } from '../auth/sessionCookie.js';

// Only AUTH_COOKIE_NAME is re-exported: several callers import it from this module
// and predate the policy split. The session cap has no such callers, so
// re-exporting it would just give one constant two importable identities.
export { AUTH_COOKIE_NAME };

/**
 * Express middleware that validates the JWT from the httpOnly cookie and
 * checks the user's current status in the database.
 *
 * Returns 401 if the token is missing, invalid, or the user has been deactivated.
 * Returns 403 with code PASSWORD_CHANGE_REQUIRED if must_change_password is set,
 * except when the request targets /api/auth/change-password.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;

  // Service accounts authenticate via Authorization: Bearer <token>.
  // Cookie takes precedence — a request with both a valid cookie and a Bearer header
  // is treated as a human session.
  const authHeader = req.headers.authorization ?? '';
  const bearerToken = !cookieToken && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (bearerToken) {
    return authenticateBearer(req, res, next, bearerToken);
  }

  if (!cookieToken) {
    res.status(401).json({
      error: { code: 'AUTH_MISSING_TOKEN', message: 'Authentication required' },
    });
    return;
  }

  let decoded: JwtTokenPayload;
  try {
    decoded = jwt.verify(cookieToken, process.env.JWT_SECRET ?? '') as JwtTokenPayload;
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

  // Enforce absolute 8-hour session cap.
  // login_at is embedded at original login and preserved through every refresh.
  // A missing login_at means the token predates this feature — allow it through
  // so existing sessions are not abruptly invalidated on deploy.
  if (decoded.login_at !== undefined && decoded.iat !== undefined) {
    const sessionAgeSeconds = decoded.iat - decoded.login_at;
    if (sessionAgeSeconds >= ABSOLUTE_SESSION_CAP_SECONDS) {
      res.status(401).json({
        error: {
          code: 'AUTH_SESSION_ABSOLUTE_TIMEOUT',
          message: 'Your session has reached the maximum allowed duration. Please sign in again.',
        },
      });
      return;
    }
  }

  // Invalidate sessions from before a password reset.
  // Compare at second granularity to match JWT iat precision: floor password_changed_at
  // to whole seconds so a token issued in the same second as the reset is accepted,
  // while any token issued in an earlier second is correctly rejected.
  if (user.password_changed_at && decoded.iat !== undefined) {
    const passwordChangedAtSec = Math.floor(user.password_changed_at.getTime() / 1000);
    if (decoded.iat < passwordChangedAtSec) {
      res.status(401).json({
        error: { code: 'AUTH_INVALID_TOKEN', message: 'Session invalidated — please log in again' },
      });
      return;
    }
  }

  // Enforce password change — all routes except change-password itself are blocked.
  // Match by path suffix so the check works regardless of the API version prefix.
  // Strip query string before comparing — .includes() on the full originalUrl is bypassable
  // via crafted query params (e.g. ?redirect=/change-password).
  if (
    user.must_change_password &&
    !req.originalUrl.split('?')[0].endsWith('/auth/change-password')
  ) {
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
    authMethod: 'cookie',
    // Preserve the JWT claims that are not in the DB record.
    login_at: decoded.login_at,
    iat: decoded.iat,
    exp: decoded.exp,
  };

  // Bind the authenticated user's ID and role to the AsyncLocalStorage context
  // so service-layer helpers (setRlsUserId, withRlsQuery) can read it without
  // threading req.user through every function call. The context propagates to all
  // async work spawned from next() — controllers, services, and their awaited calls.
  runWithRequestContext(user.id, user.role, next);
}

/**
 * Bearer-token authentication path for service account users.
 * Hashes the supplied token and performs a live DB lookup. No JWT involved —
 * the token is a long-lived opaque secret, not a signed claim set.
 */
async function authenticateBearer(
  req: Request,
  res: Response,
  next: NextFunction,
  rawToken: string,
): Promise<void> {
  let user: Awaited<ReturnType<typeof findUserByApiToken>>;
  try {
    user = await findUserByApiToken(rawToken);
  } catch {
    next(new Error('Database error during authentication'));
    return;
  }

  if (!user) {
    res.status(401).json({
      error: { code: 'AUTH_INVALID_TOKEN', message: 'Invalid or revoked API token' },
    });
    return;
  }

  req.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    authMethod: 'bearer',
  };

  runWithRequestContext(user.id, user.role, next);
}
