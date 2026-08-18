/**
 * Feature-flag authorization middleware factory.
 * Returns an Express middleware that rejects the request if the named flag is disabled.
 *
 * Must be used after the `authenticate` middleware so that req.user is set for role checks.
 * Composes naturally with requireRole: router.get('/path', authenticate, requireRole('admin'),
 * requireFeatureEnabled('reporting'), asyncHandler(handler))
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { isFeatureEnabled, isFlagEnabledForUser } from '../services/featureFlagService.js';
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
      const enabled = await isFlagEnabledForUser(flagKey, req.user.id, role);

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

/**
 * Creates an Express middleware that rejects the request with 403 if the named
 * feature flag is disabled ORG-WIDE, without consulting any authenticated user.
 *
 * Exists for routes reachable with no `req.user` at all — specifically the
 * coverage routers under COVERAGE_DASHBOARD_NO_AUTH, which skip `authenticate`
 * entirely. Those routers previously dropped `requireFeatureEnabled` alongside
 * auth, on the reasoning that a user-scoped check cannot be evaluated without a
 * user. That reasoning holds for the user-scoped PARTS of the check, but
 * discarding the whole thing also discarded the flag's org-wide kill switch, so
 * the flag read as enabled no matter what its stored value was — silently, with
 * no signal.
 *
 * This evaluates only what is meaningful without an identity: the org-wide
 * `enabled` column plus `enable_at` scheduling (featureFlagService's
 * isFeatureEnabled, documented as "the hot-path check used by routes not tied
 * to an authenticated user"). Per-user force overrides, per-team overrides, and
 * role rollout percentages are deliberately NOT consulted — there is no user to
 * evaluate them against, and inventing one would be worse than skipping them.
 *
 * Never use this on an authenticated route: it would silently ignore targeting
 * rules that route's callers rely on. `requireFeatureEnabled` is the correct
 * choice wherever `req.user` is set.
 */
export function requireFeatureEnabledOrgWide(flagKey: string): RequestHandler {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!(await isFeatureEnabled(flagKey))) {
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
