/**
 * User service — all database operations related to users.
 * Business logic belongs here. Controllers must not query the database directly.
 */

import pool from '../db.js';

/**
 * @typedef {Object} UserRow
 * @property {string} id
 * @property {string} email
 * @property {string} password_hash
 * @property {string} name
 * @property {'admin'|'rep'} role
 * @property {'active'|'invited'|'inactive'} status
 * @property {Date} created_at
 * @property {Date} updated_at
 */

/**
 * Finds a user by their email address.
 *
 * @param {string} email - The email to look up (case-insensitive).
 * @returns {Promise<UserRow|null>} The user row, or null if not found.
 */
export async function findUserByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM users WHERE email = $1 LIMIT 1',
    [email.toLowerCase().trim()],
  );
  return result.rows[0] ?? null;
}

/**
 * Finds a user by their UUID.
 *
 * @param {string} id - The user UUID.
 * @returns {Promise<UserRow|null>} The user row, or null if not found.
 */
export async function findUserById(id) {
  const result = await pool.query(
    'SELECT * FROM users WHERE id = $1 LIMIT 1',
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Creates a new user record.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.name
 * @param {'admin'|'rep'} params.role
 * @param {string|null} params.passwordHash - Null for invited users.
 * @param {'active'|'invited'|'inactive'} params.status
 * @returns {Promise<UserRow>} The newly created user row.
 */
export async function createUser({ email, name, role, passwordHash, status }) {
  const result = await pool.query(
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
 * @param {string} id - The user UUID.
 * @param {'active'|'invited'|'inactive'} status - The new status.
 * @returns {Promise<UserRow|null>} The updated user row, or null if not found.
 */
export async function updateUserStatus(id, status) {
  const result = await pool.query(
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
 * @param {string} id - The user UUID.
 * @param {'admin'|'rep'} role - The new role.
 * @returns {Promise<UserRow|null>} The updated user row, or null if not found.
 */
export async function updateUserRole(id, role) {
  const result = await pool.query(
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
 *
 * @returns {Promise<UserRow[]>} Array of all user rows.
 */
export async function listUsers() {
  const result = await pool.query(
    'SELECT * FROM users ORDER BY created_at ASC',
  );
  return result.rows;
}

/**
 * Sets (or resets) a user's password hash. Used in the invite-acceptance flow.
 *
 * @param {string} id - The user UUID.
 * @param {string} passwordHash - The bcrypt hash of the new password.
 * @returns {Promise<UserRow|null>} The updated user row, or null if not found.
 */
export async function setUserPassword(id, passwordHash) {
  const result = await pool.query(
    `UPDATE users
     SET password_hash = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, passwordHash],
  );
  return result.rows[0] ?? null;
}
