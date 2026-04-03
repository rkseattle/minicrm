/**
 * User service — all database operations related to users.
 * Business logic belongs here. Controllers must not query the database directly.
 */

import bcrypt from 'bcryptjs';
import pool from '../db.js';
import logger from '../logger.js';
import type { UserRole, UserStatus } from '@minicrm/shared/schemas/userSchema.js';
import { SUPPORTED_LOCALES } from '@minicrm/shared/schemas/settingsSchema.js';
import type { SupportedLocale } from '@minicrm/shared/schemas/settingsSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';

/** Number of bcrypt salt rounds for password hashing */
const BCRYPT_SALT_ROUNDS = 12;

/** Full user row as stored in the database */
export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  name: string;
  role: UserRole;
  status: UserStatus;
  must_change_password: boolean;
  preferred_language: SupportedLocale | null;
  created_at: Date;
  updated_at: Date;
}

interface CreateUserParams {
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string | null;
  status: UserStatus;
}

/**
 * Finds a user by their email address.
 *
 * @param email - The email to look up (case-insensitive).
 */
export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1 LIMIT 1', [
    email.toLowerCase().trim(),
  ]);
  return result.rows[0] ?? null;
}

/**
 * Finds a user by their UUID.
 *
 * @param id - The user UUID.
 */
export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] ?? null;
}

/**
 * Creates a new user record.
 */
export async function createUser({
  email,
  name,
  role,
  passwordHash,
  status,
}: CreateUserParams): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `INSERT INTO users (email, name, role, password_hash, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [email.toLowerCase().trim(), name.trim(), role, passwordHash, status],
  );
  return result.rows[0];
}

/**
 * Updates a user's status field.
 *
 * @param id - The user UUID.
 * @param status - The new status.
 */
export async function updateUserStatus(id: string, status: UserStatus): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `UPDATE users
     SET status = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status],
  );
  return result.rows[0] ?? null;
}

/**
 * Updates a user's role field.
 *
 * @param id - The user UUID.
 * @param role - The new role.
 */
export async function updateUserRole(id: string, role: UserRole): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `UPDATE users
     SET role = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, role],
  );
  return result.rows[0] ?? null;
}

/** Options for paginating the users list */
interface ListUsersOptions {
  /** 1-based page number; defaults to 1 */
  page?: number;
  /** Records per page; defaults to 50 */
  limit?: number;
}

/**
 * Returns a paginated list of users ordered by creation date ascending.
 *
 * @param options - Pagination options
 * @returns Paginated response with user rows and total count
 */
export async function listUsers(
  options: ListUsersOptions = {},
): Promise<PaginatedResponse<UserRow>> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM users'),
    pool.query<UserRow>('SELECT * FROM users ORDER BY created_at ASC LIMIT $1 OFFSET $2', [
      limit,
      offset,
    ]),
  ]);

  return {
    data: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}

/** Minimal user shape returned by listActiveUsers — id and name only */
export interface ActiveUserRow {
  id: string;
  name: string;
}

/**
 * Returns id and name for every user with status = 'active', ordered alphabetically by name.
 * Intended for owner-assignment dropdowns accessible to all authenticated users,
 * not just admins.
 */
export async function listActiveUsers(): Promise<ActiveUserRow[]> {
  const result = await pool.query<ActiveUserRow>(
    `SELECT id, name FROM users WHERE status = 'active' ORDER BY name ASC`,
  );
  return result.rows;
}

/**
 * Seeds a default admin user if no users exist in the database.
 * Reads credentials from ADMIN_EMAIL, ADMIN_NAME, and ADMIN_PASSWORD env vars.
 * No-op if any user already exists.
 */
export async function seedDefaultAdmin(): Promise<void> {
  const { rows } = await pool.query('SELECT 1 FROM users LIMIT 1');
  if (rows.length > 0) return;

  const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = process.env;

  if (!ADMIN_EMAIL || !ADMIN_NAME || !ADMIN_PASSWORD) {
    logger.warn('Skipping default admin seed: ADMIN_EMAIL, ADMIN_NAME, or ADMIN_PASSWORD not set.');
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_SALT_ROUNDS);

  await createUser({
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    role: 'admin',
    passwordHash,
    status: 'active',
  });

  logger.info(`Default admin user created: ${ADMIN_EMAIL}`);
}

/**
 * Sets (or resets) a user's password hash.
 * Optionally marks the user as needing to change their password on next login.
 *
 * @param id - The user UUID.
 * @param passwordHash - The bcrypt hash of the new password.
 * @param mustChangePassword - Whether the user must change password on next login.
 */
export async function setUserPassword(
  id: string,
  passwordHash: string,
  mustChangePassword = false,
): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `UPDATE users
     SET password_hash = $2, must_change_password = $3, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, passwordHash, mustChangePassword],
  );
  return result.rows[0] ?? null;
}

/**
 * Hashes a plaintext password and stores it on the user. Used in the invite-acceptance flow.
 * Keeps password hashing (business logic) in the service layer.
 *
 * @param id - The user UUID.
 * @param plaintext - The user's chosen plaintext password.
 */
export async function setUserPasswordFromPlaintext(
  id: string,
  plaintext: string,
): Promise<UserRow | null> {
  const passwordHash = await bcrypt.hash(plaintext, BCRYPT_SALT_ROUNDS);
  return setUserPassword(id, passwordHash);
}

/**
 * Clears the must_change_password flag after a user successfully changes their own password.
 *
 * @param id - The user UUID.
 */
export async function clearMustChangePassword(id: string): Promise<void> {
  await pool.query(
    `UPDATE users SET must_change_password = false, updated_at = now() WHERE id = $1`,
    [id],
  );
}

/**
 * Returns the stored preferred language for a user, or null if none is set.
 *
 * @param id - The user UUID.
 * @returns The stored locale code, or null if the user has no preference.
 */
export async function getUserPreferredLanguage(id: string): Promise<SupportedLocale | null> {
  const result = await pool.query<Pick<UserRow, 'preferred_language'>>(
    `SELECT preferred_language FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (!result.rows[0]) return null;
  const stored = result.rows[0].preferred_language;
  if (stored === null) return null;
  // Validate at runtime in case the DB contains a stale / unsupported code
  if ((SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
    return stored as SupportedLocale;
  }
  logger.warn(`User ${id} has unsupported preferred_language '${stored}' — treating as null`);
  return null;
}

/**
 * Persists a user's preferred language. Pass null to clear the preference.
 *
 * @param id - The user UUID.
 * @param language - The locale code to store, or null to clear.
 * @returns The updated user row, or null if the user was not found.
 */
export async function setUserPreferredLanguage(
  id: string,
  language: SupportedLocale | null,
): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `UPDATE users
     SET preferred_language = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, language],
  );
  return result.rows[0] ?? null;
}

/**
 * Allows an admin to set another user's password directly, bypassing the invite flow.
 * Sets must_change_password = true so the user is prompted to choose a new one on login.
 * Also activates the user if they were in invited status.
 * Emits a structured audit log entry so the action is forensically traceable. (MINCRM-89)
 *
 * @param adminId - The UUID of the admin performing the action.
 * @param targetUserId - The UUID of the user whose password will be set.
 * @param plaintext - The new plaintext password chosen by the admin.
 */
export async function adminSetUserPassword(
  adminId: string,
  targetUserId: string,
  plaintext: string,
): Promise<UserRow | null> {
  const user = await findUserById(targetUserId);
  if (!user) return null;

  const passwordHash = await bcrypt.hash(plaintext, BCRYPT_SALT_ROUNDS);

  const result = await pool.query<UserRow>(
    `UPDATE users
     SET password_hash = $2,
         must_change_password = true,
         status = CASE WHEN status = 'invited' THEN 'active'::varchar ELSE status END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [targetUserId, passwordHash],
  );

  const updated = result.rows[0] ?? null;
  if (updated) {
    logger.info(
      { adminId, targetUserId, timestamp: new Date().toISOString() },
      `[AUDIT] Admin password set: admin_id=${adminId} target_user_id=${targetUserId}`,
    );
  }
  return updated;
}
