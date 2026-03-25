/**
 * Role-based authorization middleware factory.
 * Returns an Express middleware that allows the request only if the
 * authenticated user has the required role.
 *
 * Must be used after the `authenticate` middleware so that req.user is set.
 */

/**
 * Creates an Express middleware that enforces a required role.
 *
 * @param {'admin' | 'rep'} role - The role the user must have.
 * @returns {import('express').RequestHandler} Express middleware
 */
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'AUTH_MISSING_TOKEN',
          message: 'Authentication required',
        },
      });
    }

    if (req.user.role !== role) {
      return res.status(403).json({
        error: {
          code: 'AUTH_FORBIDDEN',
          message: 'You do not have permission to perform this action',
        },
      });
    }

    return next();
  };
}
