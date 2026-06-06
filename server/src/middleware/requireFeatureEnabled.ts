/**
 * Feature-flag authorization middleware factory.
 * Returns an Express middleware that rejects the request if the named flag is disabled.
 *
 * Must be used after the `authenticate` middleware so that req.user is set for role checks.
 * Composes naturally with requireRole: router.get('/path', authenticate, requireRole('admin'),
 * requireFeatureEnabled('reporting'), asyncHandler(handler))
 * (MINCRM-463)
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { isFlagEnabledForRole } from '../services/featureFlagService.js';
import type { UserRole } from '@minicrm/shared/schemas/userSchema.js';

/**
 * Creates an Express middleware that rejects the request with 403 if the named
 * feature flag is disabled (org-wide or for the authenticated user's role).
 *
 * @param flagKey - The feature flag key to check, e.g. 'notes', 'reporting'.
 */
export function requireFeatureEnabled(flagKey: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
        });
        return;
      }
      const role = req.user.role as UserRole;
      const enabled = await isFlagEnabledForRole(flagKey, role);

      if (!enabled) {
        res.status(403).json({
          error: {
            code: 'FEATURE_DISABLED',
            message: 'Feature not available',
          },
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
