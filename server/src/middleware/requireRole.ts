/**
 * Authorization middleware for MiniCRM.
 *
 * Three tiers of enforcement:
 *
 *   requireRole()         — legacy role-string check; retained for simple admin-only
 *                           routes where role is sufficient and a full capability
 *                           check would be unnecessary overhead.
 *
 *   requireCapability()   — DB-backed; resolves the user's effective capability set
 *                           (union of all assigned roles) and enforces a single
 *                           capability. Result is cached on res.locals.capabilities
 *                           per-request.
 *
 *   requireCapabilities() — AND logic over multiple capabilities; uses the same
 *                           per-request cache so only the first call hits the DB.
 *
 * All three must be used after the `authenticate` middleware so req.user is set.
 *
 * blockViewer() and blockServiceAccount() are removed in favour of
 * requireCapability() — they are now enforced via specific capability checks
 * (e.g. contacts:create, api:access) rather than role-string matching.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { UserRole } from '@minicrm/shared/schemas/userSchema.js';
import type { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { userCapabilities } from '../services/roleService.js';

/**
 * Creates an Express middleware that enforces role-based access control.
 * Accepts one or more allowed roles — the request is permitted when the
 * authenticated user's role matches any entry in the list.
 *
 * Prefer requireCapability() for new routes. Use requireRole() only when a
 * simple role-string check is sufficient (e.g. admin-only management routes
 * that have no fine-grained capability equivalent).
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
 * Creates an Express middleware that enforces a single capability check.
 *
 * On the first capability check in a request, resolves the user's full
 * capability set from the DB (union of all assigned roles) and caches it on
 * res.locals.capabilities. Subsequent requireCapability() calls in the same
 * request reuse the cached set — no additional DB queries.
 *
 * Service accounts that authenticate via cookie (not bearer token) are rejected with
 * 403 SERVICE_ACCOUNT_UI_BLOCKED — they must use the bearer token path for data access.
 * Bearer token requests from service accounts go through normal capability resolution
 * so that integrations can read and write CRM data.
 */
export function requireCapability(capability: Capability): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: { code: 'AUTH_MISSING_TOKEN', message: 'Authentication required' },
      });
      return;
    }

    // Cookie-authenticated service accounts are always blocked — they must use a
    // bearer token. Bearer-authenticated service accounts are subject to normal
    // capability resolution so integrations can call data endpoints.
    if (req.user.role === 'service_account' && req.user.authMethod !== 'bearer') {
      res.status(403).json({
        error: {
          code: 'SERVICE_ACCOUNT_UI_BLOCKED',
          message: 'Service account tokens may not be used on this endpoint',
        },
      });
      return;
    }

    try {
      if (!res.locals.capabilities) {
        res.locals.capabilities = await userCapabilities(req.user.id);
      }
    } catch {
      next(new Error('Failed to resolve user capabilities'));
      return;
    }

    if (!res.locals.capabilities.has(capability)) {
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
 * Creates an Express middleware that enforces multiple capabilities (AND logic).
 * All listed capabilities must be present in the user's effective set.
 * Uses the same per-request cache as requireCapability().
 */
export function requireCapabilities(...capabilities: Capability[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: { code: 'AUTH_MISSING_TOKEN', message: 'Authentication required' },
      });
      return;
    }

    if (req.user.role === 'service_account' && req.user.authMethod !== 'bearer') {
      res.status(403).json({
        error: {
          code: 'SERVICE_ACCOUNT_UI_BLOCKED',
          message: 'Service account tokens may not be used on this endpoint',
        },
      });
      return;
    }

    try {
      if (!res.locals.capabilities) {
        res.locals.capabilities = await userCapabilities(req.user.id);
      }
    } catch {
      next(new Error('Failed to resolve user capabilities'));
      return;
    }

    const missing = capabilities.find((c) => !res.locals.capabilities!.has(c));
    if (missing) {
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
