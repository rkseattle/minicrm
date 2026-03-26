/**
 * Augments the Express Request type to include the JWT payload
 * attached by the authenticate middleware.
 */

import type { UserRole, UserStatus } from '@minicrm/shared/schemas/userSchema.js';

/** Shape of the JWT payload signed at login and decoded by the authenticate middleware. */
export interface JwtTokenPayload {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  /** Present only on invite tokens */
  purpose?: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtTokenPayload;
    }
  }
}
