/**
 * Shared utilities for user-related operations used across controllers.
 */

import type { UserRow } from '../services/userService.js';
export { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

/**
 * Safe user shape returned to API consumers.
 * api_token_hash is replaced with the boolean has_api_token (MINCRM-536).
 */
export type SafeUser = Omit<
  UserRow,
  'password_hash' | 'mfa_secret' | 'mfa_pending_secret' | 'mfa_recovery_codes' | 'api_token_hash'
> & { has_api_token: boolean };

/**
 * Strips sensitive fields before returning a user object to the client.
 * Removes password_hash, MFA secrets, and recovery code hashes. (MINCRM-392)
 * Replaces api_token_hash with the boolean has_api_token so callers can check
 * whether a token is active without exposing the hash. (MINCRM-536)
 *
 * @param user - The full user row from the database.
 * @returns The user object safe to send to the client.
 */
export function sanitizeUser(user: UserRow): SafeUser {
  const {
    password_hash: _ph,
    mfa_secret: _ms,
    mfa_pending_secret: _mps,
    mfa_recovery_codes: _mrc,
    api_token_hash,
    ...safeUser
  } = user;
  return { ...safeUser, has_api_token: api_token_hash !== null };
}
