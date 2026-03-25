/**
 * Role-based authorization middleware factory.
 * Returns an Express middleware that allows the request only if the
 * authenticated user has the required role.
 *
 * Must be used after the `authenticate` middleware so that req.user is set.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { UserRole } from '@minicrm/shared/schemas/userSchema.js';

/**
 * Creates an Express middleware that enforces a required role.
 *
 * @param role - The role the user must have.
 */
export function requireRole(role: UserRole): RequestHandler {
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

    if (req.user.role !== role) {
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
