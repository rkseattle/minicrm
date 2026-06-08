/**
 * RLS context middleware — populates the AsyncLocalStorage request context used
 * by the service layer to set the `app.current_user_id` PostgreSQL session variable.
 * (MINCRM-518)
 *
 * Must be applied AFTER the `authenticate` middleware so `req.user` is populated.
 * Wrap the call to `next()` inside `runWithRequestContext` so the async chain
 * inherits the context for the full request lifetime.
 */

import type { Request, Response, NextFunction } from 'express';
import { runWithRequestContext } from '../utils/requestContext.js';

/**
 * Express middleware that binds the authenticated user's ID and role to the
 * AsyncLocalStorage context for the duration of the request.
 *
 * When `req.user` is not set (unauthenticated routes), the context is populated
 * with null values so downstream code has a safe default.
 */
export function rlsContext(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.user?.id ?? null;
  const userRole = req.user?.role ?? null;
  runWithRequestContext(userId, userRole, next);
}
