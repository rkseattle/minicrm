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
import type { AuditActor } from './auditService.js';
import { dispatchWebhookEvent } from './webhookService.js';

const SYSTEM_ACTOR: AuditActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

/** Number of bcrypt salt rounds for password hashing */
const BCRYPT_SALT_ROUNDS = 12;

/**
 * PostgreSQL unique_violation SQLSTATE. Declared module-locally, as ~20 other services
 * already do — migrate.ts has its own copy but is the migration runner, and importing
 * from it would couple this service to that layer for a two-character constant.
 * Consolidating all of them into a shared module is worth doing, but as its own change.
 */
const PG_UNIQUE_VIOLATION = '23505';

/** Unique constraint on users.email (db/migrations/001_create_users.js). */
const USERS_EMAIL_CONSTRAINT = 'users_email_key';

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
  // MFA fields
  mfa_enabled: boolean;
  mfa_secret: string | null;
  mfa_pending_secret: string | null;
  mfa_recovery_codes: string[];
  // SSO fields
  sso_provider: 'saml' | 'oidc' | null;
  sso_subject: string | null;
  // API token fields
  api_token_hash: string | null;
  api_token_issued_at: Date | null;
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

    // Dispatch user.invited for admin-initiated invite (actor present)
    if (actor) {
      void dispatchWebhookEvent('user.invited', {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });
    }

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

    if (user) {
      if (status === 'active') {
        void dispatchWebhookEvent('user.activated', {
          id: user.id,
          email: user.email,
          name: user.name,
        });
      } else if (status === 'inactive') {
        void dispatchWebhookEvent('user.deactivated', {
          id: user.id,
          email: user.email,
          name: user.name,
        });
      }
    }

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
 * not just admins. Service accounts are excluded — they cannot own CRM records.
 */
export async function listActiveUsers(): Promise<ActiveUserRow[]> {
  const result = await pool.query<ActiveUserRow>(
    `SELECT id, name FROM users WHERE status = 'active' AND role != 'service_account' ORDER BY name ASC`,
  );
  return result.rows;
}

/**
 * Logs a warning when `user` cannot actually be used to log in as the bootstrap admin.
 * Never throws — see the inline comment on the warn path for why.
 *
 * Reached from both seedDefaultAdmin paths: the pre-insert lookup and the post-insert
 * unique-violation recovery.
 */
function warnIfAdminUnusable(user: UserRow, normalizedAdminEmail: string): void {
  // password_hash is part of the contract, not a detail: authController rejects login
  // with AUTH_ACCOUNT_NOT_ACTIVATED when it is null, so an active admin with no hash
  // boots cleanly and still cannot sign in. Invited users and SCIM/SSO-provisioned
  // rows are created without one and can be promoted to admin later.
  if (user.role === 'admin' && user.status === 'active' && user.password_hash !== null) return;

  // Warn, never throw. ADMIN_EMAIL stays set for the life of a deployment
  // (docker-compose.yml passes it unconditionally), and demoting or deactivating that
  // user is a supported admin-UI action — userController's updateUserRole and
  // updateUserStatus. Throwing here would run inside server.ts's startup block, whose
  // catch calls process.exit(1), so an operator who promotes a second admin and
  // deactivates the original bootstrap account would turn their next restart into a
  // boot loop recoverable only by editing .env on the host. That is a worse failure
  // than the lockout this function fixes: previously the service still ran and only the
  // seed no-op'd silently. The seed is a bootstrap convenience, not a liveness
  // requirement — log loudly and let the server come up.
  logger.warn(
    `Skipping default admin seed: "${normalizedAdminEmail}" is taken by a user with ` +
      `role="${user.role}" status="${user.status}" ` +
      `password_hash=${user.password_hash === null ? 'null' : 'set'}, ` +
      'which cannot be used to log in. Reactivate or re-promote that account, or set a ' +
      'different ADMIN_EMAIL.',
  );
}

/**
 * Seeds the admin user identified by ADMIN_EMAIL, if that user does not already exist.
 *
 * Idempotent on the ADMIN_EMAIL address (case- and whitespace-insensitive). No-op when
 * any of ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD is unset.
 *
 * Never throws on a configuration conflict: when ADMIN_EMAIL is already taken by a user
 * that cannot serve as an admin (wrong role, deactivated, or no password hash), it logs
 * a warning and returns. This function is awaited inside server.ts's startup block,
 * whose catch calls process.exit(1), and demoting or deactivating the bootstrap admin is
 * a supported admin-UI action — so throwing would turn a routine user-management change
 * into a boot loop. Operators must watch for that warning; the server will come up with
 * no usable admin if the conflict is left unresolved.
 *
 * Scoped to ADMIN_EMAIL rather than "does any user exist": a table-wide guard lets any
 * unrelated row — a service account, a deactivated user, a leftover test fixture —
 * permanently block admin creation with no log line, which is unrecoverable without
 * direct DB access.
 */
export async function seedDefaultAdmin(): Promise<void> {
  const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = process.env;

  if (!ADMIN_EMAIL || !ADMIN_NAME || !ADMIN_PASSWORD) {
    logger.warn('Skipping default admin seed: ADMIN_EMAIL, ADMIN_NAME, or ADMIN_PASSWORD not set.');
    return;
  }

  // Log and compare the normalized form throughout: createUser stores
  // email.toLowerCase().trim(), so a raw comparison would miss the stored row whenever
  // ADMIN_EMAIL carries different case or padding — and a raw log line would show an
  // operator an address that does not match what is in the table.
  const normalizedAdminEmail = ADMIN_EMAIL.toLowerCase().trim();

  const existing = await findUserByEmail(normalizedAdminEmail);
  if (existing) {
    warnIfAdminUnusable(existing, normalizedAdminEmail);
    logger.info(`Default admin user already exists, skipping seed: ${normalizedAdminEmail}`);
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_SALT_ROUNDS);

  try {
    await createUser({
      email: normalizedAdminEmail,
      name: ADMIN_NAME,
      role: 'admin',
      passwordHash,
      status: 'active',
    });
  } catch (error) {
    // `in` narrowing rather than an `as` cast, matching migrate.ts:313. The constraint
    // name is checked too: 23505 on any other unique index is a different bug and must
    // not be swallowed as an already-seeded admin.
    const isEmailCollision =
      error instanceof Error &&
      'code' in error &&
      error.code === PG_UNIQUE_VIOLATION &&
      'constraint' in error &&
      error.constraint === USERS_EMAIL_CONSTRAINT;
    if (!isEmailCollision) throw error;

    // The lookup above is not atomic with this INSERT, so a concurrently-booting
    // server can create the row in between. That is the already-seeded outcome — a
    // no-op, not a failure.
    const conflicting = await findUserByEmail(normalizedAdminEmail);
    if (!conflicting) throw error; // Row vanished — not the race we handle; surface it.
    warnIfAdminUnusable(conflicting, normalizedAdminEmail);
    logger.info(`Default admin user created concurrently, skipping seed: ${normalizedAdminEmail}`);
    return;
  }

  logger.info(`Default admin user created: ${normalizedAdminEmail}`);
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
 * Emits a structured audit log entry so the action is forensically traceable.
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
      // Audit: password_changed event — no value stored for sensitive field
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

// ── Password reset ───────────────────────────────────

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

// ── Notification preferences ────────────────────────────────────

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
 * Used by the admin settings page to show blast radius.
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
 * timestamp (session invalidation on other devices —).
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

// ── Onboarding reset ─────────────────────────────────────────────

/**
 * Resets the onboarding_completed flag to false for a target user.
 * Writes an audit entry in the same transaction.
 * Admin only — the route is protected by requireRole('admin').
 *
 * @param targetUserId - UUID of the user whose flag to reset.
 * @param actor - Admin performing the action.
 * @throws {{ message: string; code: string }} when the user is not found.
 */
export async function resetUserOnboarding(targetUserId: string, actor: AuditActor): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // CTE captures the pre-update values so we can write a meaningful audit entry.
    const result = await client.query<{ name: string; old_completed: boolean }>(
      `WITH before AS (
         SELECT name, onboarding_completed FROM users WHERE id = $1
       )
       UPDATE users
         SET onboarding_completed = false,
             onboarding_completed_at = NULL,
             updated_at = now()
       FROM before
       WHERE users.id = $1
       RETURNING before.name, before.onboarding_completed AS old_completed`,
      [targetUserId],
    );

    if (result.rows.length === 0) {
      const notFoundError = new Error('User not found') as Error & { code: string };
      notFoundError.code = 'USER_NOT_FOUND';
      throw notFoundError;
    }

    const user = result.rows[0];

    await writeAuditEntry(client, {
      recordType: 'user',
      recordId: targetUserId,
      recordName: user.name,
      eventType: 'updated',
      fieldName: 'onboarding_completed',
      oldValue: String(user.old_completed),
      newValue: 'false',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── Service account API tokens ───────────────────────────────────

/** Byte length of the raw token — produces a 64-char hex string */
const API_TOKEN_BYTES = 32;

/**
 * Hashes a plaintext API token using SHA-256.
 * The hash is stored in the DB; the plaintext is returned only once at issuance.
 */
function hashApiToken(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

/** Shape returned by issueServiceAccountToken — the plaintext token is shown once */
export interface IssueApiTokenResult {
  /** The plaintext token to return to the caller. Never stored. */
  plaintextToken: string;
  /** Timestamp when the token was issued. */
  issuedAt: Date;
}

/**
 * Generates a cryptographically random API token for a service account user,
 * stores its SHA-256 hash, and returns the plaintext token (shown only once).
 *
 * Atomically revokes any previously issued token by overwriting the hash in the
 * same UPDATE statement. Writes an audit entry in the same transaction.
 *
 * @param userId - The UUID of the service account user.
 * @param actor  - Admin performing the action.
 * @returns The plaintext token and issuance timestamp, or null if the user was not found.
 */
export async function issueServiceAccountToken(
  userId: string,
  actor: AuditActor,
): Promise<IssueApiTokenResult | null> {
  const plaintextToken = crypto.randomBytes(API_TOKEN_BYTES).toString('hex');
  const tokenHash = hashApiToken(plaintextToken);
  const issuedAt = new Date();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<Pick<UserRow, 'id' | 'name' | 'role'>>(
      `UPDATE users
       SET api_token_hash = $2,
           api_token_issued_at = $3,
           updated_at = now()
       WHERE id = $1 AND role = 'service_account'
       RETURNING id, name, role`,
      [userId, tokenHash, issuedAt],
    );

    if (result.rows.length === 0) return null;

    const user = result.rows[0];

    await writeAuditEntry(client, {
      recordType: 'user',
      recordId: user.id,
      recordName: user.name,
      eventType: 'api_token_issued',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return { plaintextToken, issuedAt };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Revokes the API token for a service account user by NULLing the hash columns.
 * Writes an audit entry in the same transaction.
 *
 * @param userId - The UUID of the service account user.
 * @param actor  - Admin performing the revocation.
 * @returns True if the user was found and updated; false otherwise.
 */
export async function revokeServiceAccountToken(
  userId: string,
  actor: AuditActor,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<Pick<UserRow, 'id' | 'name'>>(
      `UPDATE users
       SET api_token_hash = NULL,
           api_token_issued_at = NULL,
           updated_at = now()
       WHERE id = $1 AND role = 'service_account' AND api_token_hash IS NOT NULL
       RETURNING id, name`,
      [userId],
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const user = result.rows[0];

    await writeAuditEntry(client, {
      recordType: 'user',
      recordId: user.id,
      recordName: user.name,
      eventType: 'api_token_revoked',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Looks up an active service account user by a plaintext API token.
 * Hashes the supplied token and queries for a matching, active service account.
 *
 * @param plaintextToken - The raw token from the Authorization header.
 * @returns The matching UserRow, or null if the token is invalid or the account is inactive.
 */
export async function findUserByApiToken(plaintextToken: string): Promise<UserRow | null> {
  const tokenHash = hashApiToken(plaintextToken);
  const result = await pool.query<UserRow>(
    `SELECT * FROM users
     WHERE api_token_hash = $1
       AND status = 'active'
       AND role = 'service_account'
     LIMIT 1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}
