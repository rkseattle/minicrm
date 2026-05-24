/**
 * Shared utilities for user-related operations used across controllers.
 */

import type { UserRow } from '../services/userService.js';

/**
 * Strips sensitive fields before returning a user object to the client.
 * Removes password_hash, MFA secrets, and recovery code hashes. (MINCRM-392)
 *
 * @param user - The full user row from the database.
 * @returns The user object safe to send to the client.
 */
export function sanitizeUser(
  user: UserRow,
): Omit<UserRow, 'password_hash' | 'mfa_secret' | 'mfa_pending_secret' | 'mfa_recovery_codes'> {
  const {
    password_hash: _ph,
    mfa_secret: _ms,
    mfa_pending_secret: _mps,
    mfa_recovery_codes: _mrc,
    ...safeUser
  } = user;
  return safeUser;
}
