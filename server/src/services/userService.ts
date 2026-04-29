/**
 * User service — all database operations related to users.
 * Business logic belongs here. Controllers must not query the database directly.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import logger from '../logger.js';
import type { UserRole, UserStatus } from '@minicrm/shared/schemas/userSchema.js';
import { SUPPORTED_LOCALES } from '@minicrm/shared/schemas/settingsSchema.js';
import type { SupportedLocale } from '@minicrm/shared/schemas/settingsSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import { writeAuditEntry } from './auditService.js';

/** Actor info required to write audit entries on write operations */
export interface AuditActor {
  id: string;
  name: string;
}

/** Fallback actor used when no user context is available (e.g. tests, system operations) */
const SYSTEM_ACTOR: AuditActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

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
  notify_overdue_tasks: boolean;
  notify_assignments: boolean;
  notify_deal_stage_changes: boolean;
  password_reset_token_hash: string | null;
  password_reset_expires_at: Date | null;
  password_changed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Notification preferences shape */
export interface NotificationPrefs {
  notify_overdue_tasks: boolean;
  notify_assignments: boolean;
  notify_deal_stage_changes: boolean;
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
 * Creates a new user record and writes an audit entry when an actor is provided.
 * (MINCRM-170)
 *
 * @param actor - Admin who created the user; omitted for seed / test operations
 */
export async function createUser(
  { email, name, role, passwordHash, status }: CreateUserParams,
  actor?: AuditActor,
): Promise<UserRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<UserRow>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [email.toLowerCase().trim(), name.trim(), role, passwordHash, status],
    );

    const user = result.rows[0];

    if (actor) {
      await writeAuditEntry(client, {
        recordType: 'user',
        recordId: user.id,
        recordName: user.name,
        eventType: 'created',
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
    return user;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Updates a user's status field and writes a deactivated/reactivated audit entry.
 * (MINCRM-170)
 *
 * @param id - The user UUID.
 * @param status - The new status.
 * @param actor - Admin performing the action.
 */
export async function updateUserStatus(
  id: string,
  status: UserStatus,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<UserRow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<UserRow>(
      `UPDATE users
       SET status = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );

    const user = result.rows[0] ?? null;

    if (user) {
      const eventType = status === 'inactive' ? 'deactivated' : 'reactivated';
      await writeAuditEntry(client, {
        recordType: 'user',
        recordId: user.id,
        recordName: user.name,
        eventType,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
    return user;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Updates a user's role field and writes a role_changed audit entry.
 * (MINCRM-170)
 *
 * @param id - The user UUID.
 * @param role - The new role.
 * @param actor - Admin performing the action.
 */
export async function updateUserRole(
  id: string,
  role: UserRole,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<UserRow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<UserRow>(
      `UPDATE users
       SET role = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, role],
    );

    const user = result.rows[0] ?? null;

    if (user) {
      await writeAuditEntry(client, {
        recordType: 'user',
        recordId: user.id,
        recordName: user.name,
        eventType: 'role_changed',
        fieldName: 'Role',
        newValue: role,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
    return user;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Options for paginating the users list */
interface ListUsersOptions {
  /** 1-based page number; defaults to 1 */
  page?: number;
  /** Records per page; defaults to 50 */
  limit?: number;
  /** When set, restrict results to users whose email starts with this prefix (test isolation only) */
  emailPrefix?: string;
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

  if (options.emailPrefix) {
    const prefix = options.emailPrefix;
    const [countResult, dataResult] = await Promise.all([
      pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM users WHERE email LIKE $1', [
        `${prefix}%`,
      ]),
      pool.query<UserRow>(
        'SELECT * FROM users WHERE email LIKE $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
        [`${prefix}%`, limit, offset],
      ),
    ]);
    return {
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    };
  }

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
 *
 * @param emailPrefix - When set, restrict to users whose email starts with this prefix (test isolation only)
 */
export async function listActiveUsers(emailPrefix?: string): Promise<ActiveUserRow[]> {
  const result = emailPrefix
    ? await pool.query<ActiveUserRow>(
        `SELECT id, name FROM users WHERE status = 'active' AND email LIKE $1 ORDER BY name ASC`,
        [`${emailPrefix}%`],
      )
    : await pool.query<ActiveUserRow>(
        `SELECT id, name FROM users WHERE status = 'active' ORDER BY name ASC`,
      );
  return result.rows;
}

/**
 * Seeds a default admin user if no users exist in the database.
 * Reads credentials from ADMIN_EMAIL, ADMIN_NAME, and ADMIN_PASSWORD env vars.
 * No-op if any user already exists.
 *
 * @param emailPrefix - When set, the "no users exist" check is scoped to emails starting with
 *   this prefix (test isolation only — do not pass in production).
 */
export async function seedDefaultAdmin(emailPrefix?: string): Promise<void> {
  const { rows } = emailPrefix
    ? await pool.query('SELECT 1 FROM users WHERE email LIKE $1 LIMIT 1', [`${emailPrefix}%`])
    : await pool.query('SELECT 1 FROM users LIMIT 1');
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
  adminName = 'System',
): Promise<UserRow | null> {
  const user = await findUserById(targetUserId);
  if (!user) return null;

  const passwordHash = await bcrypt.hash(plaintext, BCRYPT_SALT_ROUNDS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<UserRow>(
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
      // Audit: password_changed event — no value stored for sensitive field (MINCRM-170)
      await writeAuditEntry(client, {
        recordType: 'user',
        recordId: updated.id,
        recordName: updated.name,
        eventType: 'password_changed',
        changedById: adminId,
        changedByName: adminName,
      });

      logger.info(
        { adminId, targetUserId, timestamp: new Date().toISOString() },
        `[AUDIT] Admin password set: admin_id=${adminId} target_user_id=${targetUserId}`,
      );
    }

    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── Password reset (MINCRM-156, MINCRM-157) ───────────────────────────────────

/** Length of the plaintext reset token in bytes (produces a 64-char hex string) */
const RESET_TOKEN_BYTES = 32;

/** Reset token expiry in milliseconds (60 minutes) */
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Hashes a plaintext reset token using SHA-256.
 * The hash is stored in the DB; the plaintext is sent only in the email link.
 *
 * @param plaintext - The plaintext hex token.
 * @returns The SHA-256 hex digest.
 */
function hashResetToken(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Result returned by createPasswordResetToken.
 * The plaintext token must be embedded in the reset URL sent to the user.
 * It is never stored in the database.
 */
export interface CreatePasswordResetTokenResult {
  /** The plaintext token to embed in the reset URL. */
  plaintextToken: string;
  /** ISO timestamp when the token expires (60 minutes from now). */
  expiresAt: Date;
}

/**
 * Generates a cryptographically random reset token for the given user,
 * stores its SHA-256 hash in the database, and returns the plaintext token.
 *
 * If the user already has an unexpired token it is overwritten (invalidated).
 * Only called for active users — callers must verify status before calling.
 *
 * @param userId - The UUID of the user requesting a reset.
 * @returns The plaintext token and expiry timestamp.
 */
export async function createPasswordResetToken(
  userId: string,
): Promise<CreatePasswordResetTokenResult> {
  const plaintextToken = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
  const tokenHash = hashResetToken(plaintextToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

  await pool.query(
    `UPDATE users
     SET password_reset_token_hash = $2,
         password_reset_expires_at = $3,
         updated_at = now()
     WHERE id = $1`,
    [userId, tokenHash, expiresAt],
  );

  return { plaintextToken, expiresAt };
}

/**
 * Looks up a user by a plaintext reset token.
 * Returns null when the token is not found, already used, or expired.
 *
 * @param plaintextToken - The plaintext token from the reset URL.
 * @returns The matching user row, or null if the token is invalid/expired.
 */
export async function findUserByResetToken(plaintextToken: string): Promise<UserRow | null> {
  const tokenHash = hashResetToken(plaintextToken);
  const result = await pool.query<UserRow>(
    `SELECT * FROM users
     WHERE password_reset_token_hash = $1
       AND password_reset_expires_at > now()
     LIMIT 1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

// ── Notification preferences (MINCRM-163) ────────────────────────────────────

/**
 * Returns the notification preferences for a user.
 *
 * @param id - The user UUID.
 * @returns The notification preference flags, or null if the user was not found.
 */
export async function getNotificationPrefs(id: string): Promise<NotificationPrefs | null> {
  const result = await pool.query<NotificationPrefs>(
    `SELECT notify_overdue_tasks, notify_assignments, notify_deal_stage_changes
     FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Persists a user's notification preference flags.
 *
 * @param id - The user UUID.
 * @param prefs - The new preference values.
 * @returns The updated user row, or null if the user was not found.
 */
export async function updateNotificationPrefs(
  id: string,
  prefs: NotificationPrefs,
): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `UPDATE users
     SET notify_overdue_tasks = $2,
         notify_assignments = $3,
         notify_deal_stage_changes = $4,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, prefs.notify_overdue_tasks, prefs.notify_assignments, prefs.notify_deal_stage_changes],
  );
  return result.rows[0] ?? null;
}

/**
 * Returns all active users who have opted in to a given notification type,
 * alongside their email address. Used by notification dispatch logic.
 *
 * @param notifColumn - Column name of the notification flag to filter by.
 * @returns Array of users with id, email, name.
 */
export async function listUsersOptedIn(
  notifColumn: 'notify_overdue_tasks' | 'notify_assignments' | 'notify_deal_stage_changes',
): Promise<Pick<UserRow, 'id' | 'email' | 'name'>[]> {
  // Column name is from a closed enum — safe to interpolate
  const result = await pool.query<Pick<UserRow, 'id' | 'email' | 'name'>>(
    `SELECT id, email, name FROM users WHERE status = 'active' AND ${notifColumn} = true`,
  );
  return result.rows;
}

/**
 * Returns a count of active users who have at least one notification type enabled.
 * Used by the admin settings page to show blast radius. (MINCRM-163)
 *
 * @returns Count of active users with at least one notification enabled.
 */
export async function countActiveNotificationRecipients(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM users
     WHERE status = 'active'
       AND (notify_overdue_tasks = true OR notify_assignments = true OR notify_deal_stage_changes = true)`,
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Resets a user's password using a plaintext token.
 *
 * - Validates that the token exists and has not expired.
 * - Hashes the new password with bcrypt.
 * - Updates the password, clears the reset token fields, sets password_changed_at.
 * - Returns the updated user row, or null when the token is invalid/expired.
 *
 * Setting password_changed_at invalidates all existing JWTs issued before this
 * timestamp (session invalidation on other devices — MINCRM-157).
 *
 * @param plaintextToken - The plaintext token from the reset URL.
 * @param newPassword - The user's desired new plaintext password.
 * @returns The updated user row, or null if the token was invalid or expired.
 */
export async function resetPasswordWithToken(
  plaintextToken: string,
  newPassword: string,
): Promise<UserRow | null> {
  const user = await findUserByResetToken(plaintextToken);
  if (!user) return null;

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

  const result = await pool.query<UserRow>(
    `UPDATE users
     SET password_hash = $2,
         password_reset_token_hash = NULL,
         password_reset_expires_at = NULL,
         password_changed_at = now(),
         must_change_password = false,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [user.id, passwordHash],
  );

  return result.rows[0] ?? null;
}
