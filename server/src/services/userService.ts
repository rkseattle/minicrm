/**
 * User service — all database operations related to users.
 * Business logic belongs here. Controllers must not query the database directly.
 */

import bcrypt from 'bcryptjs';
import pool from '../db.js';
import logger from '../logger.js';
import type { UserRole, UserStatus } from '@minicrm/shared/schemas/userSchema.js';

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

/**
 * Returns all users ordered by creation date ascending.
 */
export async function listUsers(): Promise<UserRow[]> {
  const result = await pool.query<UserRow>('SELECT * FROM users ORDER BY created_at ASC');
  return result.rows;
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
 * Sets (or resets) a user's password hash. Used in the invite-acceptance flow.
 *
 * @param id - The user UUID.
 * @param passwordHash - The bcrypt hash of the new password.
 */
export async function setUserPassword(id: string, passwordHash: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `UPDATE users
     SET password_hash = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, passwordHash],
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
