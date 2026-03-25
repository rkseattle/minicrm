/**
 * Shared utilities for user-related operations used across controllers.
 */

import type { UserRow } from '../services/userService.js';

/**
 * Strips the password_hash field before returning a user object to the client.
 *
 * @param user - The full user row from the database.
 * @returns The user object without the password_hash field.
 */
export function sanitizeUser(user: UserRow): Omit<UserRow, 'password_hash'> {
  const { password_hash: _password_hash, ...safeUser } = user;
  return safeUser;
}
