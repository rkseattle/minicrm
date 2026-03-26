/**
 * Wraps an async route handler so that any thrown errors are forwarded
 * to Express's error-handling middleware via next(err).
 *
 * Express 4 does not automatically catch async errors — without this wrapper
 * an unhandled rejection would bypass the global error handler entirely.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async Express handler and forwards any rejections to next().
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
