/**
 * Augments the Express Request and Response types with the MiniCRM-specific
 * fields attached by authentication and capability middleware.
 */

import type { UserRole, UserStatus } from '@minicrm/shared/schemas/userSchema.js';
import type { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

/** Shape of the JWT payload signed at login and decoded by the authenticate middleware. */
export interface JwtTokenPayload {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  /** Present only on invite tokens */
  purpose?: string;
  /** Unix timestamp (seconds) when the original session was created — used for absolute session cap (MINCRM-365) */
  login_at?: number;
  iat?: number;
  exp?: number;
  /**
   * How the request was authenticated (MINCRM-542).
   * 'bearer' = service account API token via Authorization header.
   * 'cookie' = JWT in httpOnly cookie (human session).
   * Used by requireCapability() to distinguish machine-to-machine calls from
   * UI calls — service accounts may use data endpoints via bearer but are
   * blocked from UI-only routes that are cookie-only by design.
   */
  authMethod?: 'cookie' | 'bearer';
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtTokenPayload;
    }
    interface Locals {
      /**
       * Effective capability set for the authenticated user — populated lazily by
       * requireCapability() on the first capability check in a request and cached
       * for subsequent checks in the same request lifecycle (MINCRM-542).
       */
      capabilities?: Set<Capability>;
    }
  }
}
