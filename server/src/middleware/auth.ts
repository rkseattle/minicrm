/**
 * Authentication middleware.
 * Verifies the JWT stored in the httpOnly cookie and attaches the decoded
 * user payload to req.user. Returns 401 if the token is missing or invalid.
 */

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { JwtTokenPayload } from '../types/express.js';

/** Name of the cookie that holds the JWT */
export const AUTH_COOKIE_NAME = 'minicrm_token';

/**
 * Express middleware that validates the JWT from the httpOnly cookie.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;

  if (!token) {
    res.status(401).json({
      error: { code: 'AUTH_MISSING_TOKEN', message: 'Authentication required' },
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET ?? '') as JwtTokenPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({
      error: { code: 'AUTH_INVALID_TOKEN', message: 'Invalid or expired token' },
    });
  }
}
