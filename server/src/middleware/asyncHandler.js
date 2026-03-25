/**
 * Wraps an async route handler so that any thrown errors are forwarded
 * to Express's error-handling middleware via next(err).
 *
 * Express 4 does not automatically catch async errors — without this wrapper
 * an unhandled rejection would bypass the global error handler entirely.
 *
 * @param {function(import('express').Request, import('express').Response, import('express').NextFunction): Promise<void>} fn
 * @returns {function(import('express').Request, import('express').Response, import('express').NextFunction): void}
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
