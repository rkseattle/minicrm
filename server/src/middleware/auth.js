/**
 * Authentication middleware.
 * Verifies the JWT stored in the httpOnly cookie and attaches the decoded
 * user payload to req.user. Returns 401 if the token is missing or invalid.
 */

import jwt from 'jsonwebtoken';

/** Name of the cookie that holds the JWT */
export const AUTH_COOKIE_NAME = 'minicrm_token';

/**
 * Express middleware that validates the JWT from the httpOnly cookie.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function authenticate(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];

  if (!token) {
    return res.status(401).json({
      error: { code: 'AUTH_MISSING_TOKEN', message: 'Authentication required' },
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({
      error: { code: 'AUTH_INVALID_TOKEN', message: 'Invalid or expired token' },
    });
  }
}
