/**
 * Request-scoped AsyncLocalStorage context.
 * Stores the authenticated user's ID and role for use by service-layer helpers
 * that need to set the `app.current_user_id` PostgreSQL session variable for RLS.
 * (MINCRM-518)
 *
 * Usage:
 *   - The `authenticate` middleware calls `runWithRequestContext(user.id, user.role, next)`
 *     immediately before `next()`, binding the context to the full async chain of the request.
 *   - Service helpers call `getRequestContext()` to read the current user.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** UUID of the authenticated user, or null for unauthenticated / system requests. */
  userId: string | null;
  /** Role of the authenticated user ('admin' | 'rep' | null). */
  userRole: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with the given user context bound to the current async chain.
 * Called by `authenticate` middleware after the user record is confirmed active.
 */
export function runWithRequestContext<T>(
  userId: string | null,
  userRole: string | null,
  fn: () => T,
): T {
  return storage.run({ userId, userRole }, fn);
}

/**
 * Returns the current request context, or a safe anonymous default if called
 * outside a request (e.g., in the SMTP/overdue-task cron jobs).
 */
export function getRequestContext(): RequestContext {
  return storage.getStore() ?? { userId: null, userRole: null };
}
