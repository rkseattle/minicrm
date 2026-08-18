/**
 * Middleware that validates SCIM bearer tokens for /scim/v2/* routes.
 * Separate from the main JWT authenticate middleware — SCIM uses its own
 * long-lived token issued via /api/v1/scim-token.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { validateScimToken } from '../services/scimTokenService.js';

/**
 * Authenticates inbound SCIM requests via a long-lived bearer token.
 *
 * Reads the Authorization header, extracts the bearer token, and validates it
 * against the stored SHA-256 hash. The last_used_at timestamp update is handled
 * fire-and-forget inside validateScimToken — it does not block this middleware.
 *
 * On success, calls next(). On failure, responds with 401 and the standard
 * error shape.
 */
export const authenticateScim: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization ?? '';

  if (!authHeader.startsWith('Bearer ')) {
    res
      .status(401)
      .type('application/scim+json')
      .json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '401',
        detail: 'SCIM bearer token required',
      });
    return;
  }

  const rawToken = authHeader.slice(7);

  const isValid = await validateScimToken(rawToken);
  if (!isValid) {
    res
      .status(401)
      .type('application/scim+json')
      .json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '401',
        detail: 'Invalid or revoked SCIM token',
      });
    return;
  }

  next();
};
