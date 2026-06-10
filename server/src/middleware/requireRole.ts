/**
 * Role-based authorization middleware factory.
 * Returns an Express middleware that allows the request only if the
 * authenticated user holds at least one of the specified roles.
 *
 * Must be used after the `authenticate` middleware so that req.user is set.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { UserRole } from '@minicrm/shared/schemas/userSchema.js';

/**
 * Creates an Express middleware that enforces role-based access control.
 * Accepts one or more allowed roles — the request is permitted when the
 * authenticated user's role matches any entry in the list (MINCRM-533).
 *
 * @param roles - One or more roles that are permitted to access the route.
 *
 * @example
 * // Single role (existing usage — unchanged call-site syntax)
 * router.patch('/', authenticate, requireRole('admin'), handler);
 *
 * @example
 * // Multiple roles
 * router.get('/', authenticate, requireRole('admin', 'manager'), handler);
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'AUTH_MISSING_TOKEN',
          message: 'Authentication required',
        },
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: {
          code: 'AUTH_FORBIDDEN',
          message: 'You do not have permission to perform this action',
        },
      });
      return;
    }

    next();
  };
}

/**
 * Blocks service_account tokens from routes that require a human session.
 * Service accounts are API-only principals — they must not access any route
 * that drives the browser UI (MINCRM-533).
 *
 * Intended to be applied as a router-level guard ahead of UI-facing route groups,
 * or individually on endpoints where service accounts must be excluded.
 */
export function blockServiceAccount(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.role === 'service_account') {
      res.status(403).json({
        error: {
          code: 'SERVICE_ACCOUNT_UI_BLOCKED',
          message: 'Service account tokens may not be used on this endpoint',
        },
      });
      return;
    }
    next();
  };
}
