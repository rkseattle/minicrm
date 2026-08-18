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
  /** Unix timestamp (seconds) when the original session was created — used for absolute session cap */
  login_at?: number;
  iat?: number;
  exp?: number;
  /**
   * How the request was authenticated.
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
      /**
       * Coverage/TIA correlation ID read from the x-coverage-correlation-id
       * header by the correlationId middleware. Undefined when
       * the header was absent — coverage session attribution is opt-in per
       * request, not required on every route.
       */
      coverageCorrelationId?: string;
    }
    interface Locals {
      /**
       * Effective capability set for the authenticated user — populated lazily by
       * requireCapability() on the first capability check in a request and cached
       * for subsequent checks in the same request lifecycle.
       */
      capabilities?: Set<Capability>;
    }
  }
}
