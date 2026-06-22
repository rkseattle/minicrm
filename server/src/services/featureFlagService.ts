/**
 * Feature flag service — all database operations and caching for the feature flag registry.
 * Business logic belongs here. Controllers must not query the database directly.
 * (MINCRM-463)
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { writeAuditEntry, type AuditActor } from './auditService.js';
import type {
  FeatureFlagKey,
  FeatureFlagRow,
  UpdateFeatureFlagInput,
  RoleOverrides,
  BetaUserEntry,
} from '@minicrm/shared/schemas/featureFlagSchema.js';
import type { UserRole } from '@minicrm/shared/schemas/userSchema.js';
import { USER_ROLES } from '@minicrm/shared/schemas/userSchema.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Raw DB row from the feature_flags table joined with updated_by name. */
interface FeatureFlagDbRow {
  flag_key: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  role_overrides: RoleOverrides;
  enable_at: Date | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: Date;
  system_flag: boolean;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

/** TTL for the feature flag cache in milliseconds. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  rows: FeatureFlagDbRow[];
  expiresAt: number;
}

let cache: CacheEntry | null = null;

/** Immediately clears the in-memory cache, forcing the next read to hit the DB. */
function invalidateCache(): void {
  cache = null;
}

/**
 * Exported for test use only — clears the TTL cache so a test's DB mutations
 * are visible to the next service call without waiting for TTL expiry.
 * Do not call this from application code.
 */
export function __clearCacheForTest(): void {
  invalidateCache();
}

/** Returns cached rows if still valid, otherwise fetches from DB and repopulates cache. */
async function getCachedRows(): Promise<FeatureFlagDbRow[]> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.rows;
  }

  const result = await pool.query<FeatureFlagDbRow>(
    `SELECT
       ff.flag_key,
       ff.label,
       ff.description,
       ff.category,
       ff.enabled,
       ff.role_overrides,
       ff.enable_at,
       ff.updated_by,
       u.name AS updated_by_name,
       ff.updated_at,
       ff.system_flag
     FROM feature_flags ff
     LEFT JOIN users u ON u.id = ff.updated_by
     ORDER BY ff.category,
              -- 'ai_features' is the master toggle; always list it first in the AI category.
              CASE WHEN ff.flag_key = 'ai_features' THEN 0 ELSE 1 END,
              ff.label`,
  );

  // Cap TTL at the time until the nearest future enable_at so a scheduled enable
  // fires without waiting for the full 60-second TTL. (MINCRM-488)
  const now = Date.now();
  const nearestEnableAt = result.rows
    .map((r) => r.enable_at?.getTime() ?? null)
    .filter((t): t is number => t !== null && t > now)
    .reduce((min, t) => Math.min(min, t), Infinity);

  const effectiveTtl =
    nearestEnableAt === Infinity ? CACHE_TTL_MS : Math.min(CACHE_TTL_MS, nearestEnableAt - now);

  cache = { rows: result.rows, expiresAt: now + effectiveTtl };
  return result.rows;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns true if a DB row is considered enabled via the scheduled enable_at column.
 * A row is schedule-enabled when enable_at is set and is in the past or present. (MINCRM-488)
 */
function isScheduledEnabled(row: Pick<FeatureFlagDbRow, 'enable_at'>): boolean {
  return row.enable_at !== null && row.enable_at.getTime() <= Date.now();
}

/**
 * Returns all feature flags with their active user counts for the last 30 days.
 */
export async function listFeatureFlags(): Promise<FeatureFlagRow[]> {
  const [rows, usageCounts, betaCounts] = await Promise.all([
    getCachedRows(),
    getActiveUserCounts(),
    getBetaUserCounts(),
  ]);

  return rows.map((row) => ({
    ...row,
    enable_at: row.enable_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
    active_user_count: usageCounts.get(row.flag_key) ?? 0,
    beta_user_count: betaCounts.get(row.flag_key) ?? 0,
  })) as FeatureFlagRow[];
}

/**
 * Returns a single feature flag row. Returns null if the key does not exist.
 */
export async function getFeatureFlag(key: string): Promise<FeatureFlagRow | null> {
  const rows = await getCachedRows();
  const row = rows.find((r) => r.flag_key === key);
  if (!row) return null;

  const [count, betaCount] = await Promise.all([
    getActiveUserCountForFlag(key),
    getBetaUserCountForFlag(key),
  ]);
  return {
    ...row,
    enable_at: row.enable_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
    active_user_count: count,
    beta_user_count: betaCount,
  } as FeatureFlagRow;
}

/**
 * Returns true if the flag is enabled org-wide.
 * Accounts for enable_at scheduled enables. (MINCRM-488)
 * This is the hot-path check used by routes not tied to an authenticated user — always cache-backed.
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const rows = await getCachedRows();
  const row = rows.find((r) => r.flag_key === key);
  // Unknown flag keys are treated as disabled to fail safely.
  if (!row) {
    logger.warn(`isFeatureEnabled: unknown flag key '${key}' — treating as disabled`);
    return false;
  }
  return row.enabled || isScheduledEnabled(row);
}

/**
 * Returns true if the flag is enabled for a specific user role.
 * Applies enable_at scheduling check first; then consults role_overrides;
 * falls back to the org-wide enabled value. (MINCRM-488)
 */
export async function isFlagEnabledForRole(key: string, role: UserRole): Promise<boolean> {
  const rows = await getCachedRows();
  const row = rows.find((r) => r.flag_key === key);
  if (!row) {
    logger.warn(`isFlagEnabledForRole: unknown flag key '${key}' — treating as disabled`);
    return false;
  }

  // A scheduled enable supersedes everything — treat as fully enabled. (MINCRM-488)
  if (isScheduledEnabled(row)) return true;

  const overrides = row.role_overrides;
  if (overrides != null && overrides[role] !== undefined) {
    return overrides[role] as boolean;
  }
  return row.enabled;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Allowed role keys in a role_overrides object. */
const ALLOWED_ROLE_OVERRIDE_KEYS = new Set(USER_ROLES);

/**
 * Validates that a role_overrides value contains only known role keys with boolean values.
 * Throws a typed domain error on invalid input so the controller can return 400.
 * This guard runs independently of the Zod layer as defence-in-depth. (MINCRM-511)
 */
function assertValidRoleOverrides(overrides: RoleOverrides): void {
  if (overrides == null) return;
  for (const [key, value] of Object.entries(overrides)) {
    if (!ALLOWED_ROLE_OVERRIDE_KEYS.has(key as (typeof USER_ROLES)[number])) {
      throw Object.assign(new Error(`role_overrides contains invalid role key: '${key}'`), {
        code: 'FEATURE_FLAG_INVALID_ROLE_OVERRIDE',
      });
    }
    if (typeof value !== 'boolean') {
      throw Object.assign(
        new Error(`role_overrides['${key}'] must be a boolean, got ${typeof value}`),
        { code: 'FEATURE_FLAG_INVALID_ROLE_OVERRIDE' },
      );
    }
  }
}

/**
 * Updates a feature flag's enabled state and optional role overrides.
 * Writes an audit entry in the same transaction, then invalidates the cache.
 *
 * @returns The updated flag row, or null if the key does not exist.
 */
export async function updateFeatureFlag(
  key: string,
  patch: UpdateFeatureFlagInput,
  actor: AuditActor,
  opts?: { onDisabled?: () => Promise<void> },
): Promise<FeatureFlagRow | null> {
  if (patch.role_overrides !== undefined) {
    assertValidRoleOverrides(patch.role_overrides);
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<FeatureFlagDbRow>(
      `SELECT ff.flag_key, ff.label, ff.enabled, ff.role_overrides, ff.enable_at
       FROM feature_flags ff
       WHERE ff.flag_key = $1
       FOR UPDATE`,
      [key],
    );
    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    const before = existing.rows[0];
    const newRoleOverrides =
      patch.role_overrides !== undefined ? patch.role_overrides : before.role_overrides;
    // undefined means "not in request body, keep existing"; null means "clear the schedule"
    const newEnableAt =
      patch.enable_at !== undefined ? patch.enable_at : (before.enable_at?.toISOString() ?? null);

    const result = await client.query<FeatureFlagDbRow>(
      `UPDATE feature_flags
       SET enabled        = $1,
           role_overrides = $2,
           enable_at      = $3,
           updated_by     = $4,
           updated_at     = now()
       WHERE flag_key = $5
       RETURNING
         flag_key, label, description, category, enabled,
         role_overrides, enable_at, updated_by, updated_at, system_flag`,
      [patch.enabled, newRoleOverrides, newEnableAt ?? null, actor.id, key],
    );
    const updated = result.rows[0];

    if (patch.enabled !== before.enabled) {
      await writeAuditEntry(client, {
        recordType: 'feature_flag',
        recordId: null,
        recordName: before.label,
        eventType: 'updated',
        fieldName: 'enabled',
        oldValue: String(before.enabled),
        newValue: String(patch.enabled),
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    if (
      patch.role_overrides !== undefined &&
      JSON.stringify(patch.role_overrides) !== JSON.stringify(before.role_overrides)
    ) {
      await writeAuditEntry(client, {
        recordType: 'feature_flag',
        recordId: null,
        recordName: before.label,
        eventType: 'updated',
        fieldName: 'role_overrides',
        oldValue: JSON.stringify(before.role_overrides),
        newValue: JSON.stringify(patch.role_overrides),
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    // Audit enable_at changes — compare as ISO strings to normalise timezone representation. (MINCRM-488)
    const beforeEnableAt = before.enable_at?.toISOString() ?? null;
    if (patch.enable_at !== undefined && patch.enable_at !== beforeEnableAt) {
      await writeAuditEntry(client, {
        recordType: 'feature_flag',
        recordId: null,
        recordName: before.label,
        eventType: 'updated',
        fieldName: 'enable_at',
        oldValue: beforeEnableAt ?? 'null',
        newValue: patch.enable_at ?? 'null',
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
    invalidateCache();

    if (patch.enabled === false && opts?.onDisabled) {
      void opts.onDisabled().catch((err: unknown) => {
        logger.error({ err, flagKey: key }, 'onDisabled side-effect failed');
      });
    }

    const [activeCount, betaCount] = await Promise.all([
      getActiveUserCountForFlag(key),
      getBetaUserCountForFlag(key),
    ]);

    return {
      ...updated,
      enable_at: updated.enable_at?.toISOString() ?? null,
      updated_by_name: actor.name,
      updated_at: updated.updated_at.toISOString(),
      active_user_count: activeCount,
      beta_user_count: betaCount,
    } as FeatureFlagRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Usage tracking ────────────────────────────────────────────────────────────

/**
 * Records that a user used a specific feature (upsert by flag_key + user_id).
 * Fire-and-forget — callers must not await this; errors are swallowed and logged.
 */
export function recordFeatureFlagUsage(key: FeatureFlagKey, userId: string): void {
  pool
    .query(
      `INSERT INTO feature_flag_usage (flag_key, user_id, used_at)
       VALUES ($1, $2, now())
       ON CONFLICT (flag_key, user_id) DO UPDATE SET used_at = now()`,
      [key, userId],
    )
    .catch((err: unknown) => {
      logger.error(`recordFeatureFlagUsage failed for key=${key} user=${userId}: ${String(err)}`);
    });
}

/**
 * Returns the count of distinct users who used a specific flag in the last 30 days.
 */
export async function getActiveUserCountForFlag(key: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(DISTINCT user_id)::text AS count
     FROM feature_flag_usage
     WHERE flag_key = $1
       AND used_at >= now() - interval '30 days'`,
    [key],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Returns a map of flag_key → active user count for all flags in the last 30 days.
 * Used by listFeatureFlags to avoid N+1 queries.
 */
async function getActiveUserCounts(): Promise<Map<string, number>> {
  const result = await pool.query<{ flag_key: string; count: string }>(
    `SELECT flag_key, COUNT(DISTINCT user_id)::text AS count
     FROM feature_flag_usage
     WHERE used_at >= now() - interval '30 days'
     GROUP BY flag_key`,
  );
  return new Map(result.rows.map((r) => [r.flag_key, parseInt(r.count, 10)]));
}

// ── Beta user counts ──────────────────────────────────────────────────────────
// Full beta enrollment CRUD (isFlagEnabledForUser, enrollBetaUser, removeBetaUser, getBetaUsersForFlag)
// is implemented below in the Beta Users section (MINCRM-489). These count helpers are used
// by listFeatureFlags/getFeatureFlag above.

/**
 * Returns the count of users enrolled in the beta for a specific flag.
 * Always queries fresh — beta membership is never served from the flag cache. (MINCRM-489)
 */
export async function getBetaUserCountForFlag(key: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM feature_flag_beta_users WHERE flag_key = $1`,
    [key],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Returns a map of flag_key → beta user count for all flags.
 * Used by listFeatureFlags to avoid N+1 queries. Always queries fresh. (MINCRM-489)
 */
async function getBetaUserCounts(): Promise<Map<string, number>> {
  const result = await pool.query<{ flag_key: string; count: string }>(
    `SELECT flag_key, COUNT(*)::text AS count FROM feature_flag_beta_users GROUP BY flag_key`,
  );
  return new Map(result.rows.map((r) => [r.flag_key, parseInt(r.count, 10)]));
}

// ── Beta user CRUD (MINCRM-489) ───────────────────────────────────────────────

/** Raw DB row from feature_flag_beta_users joined with user details. */
interface BetaUserDbRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  added_at: Date;
}

/**
 * Returns true if the flag is enabled for a specific user.
 * Checks beta membership first (always fresh, no cache); if enrolled, returns true
 * regardless of enabled/enable_at state. Otherwise falls back to isFlagEnabledForRole.
 * (MINCRM-489)
 */
export async function isFlagEnabledForUser(
  key: string,
  userId: string,
  role: UserRole,
): Promise<boolean> {
  const betaResult = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM feature_flag_beta_users
       WHERE flag_key = $1 AND user_id = $2
     ) AS exists`,
    [key, userId],
  );
  if (betaResult.rows[0]?.exists) return true;
  return isFlagEnabledForRole(key, role);
}

/**
 * Returns the list of users enrolled in the beta for a specific flag.
 * Always queries fresh. (MINCRM-489)
 */
export async function getBetaUsersForFlag(key: string): Promise<BetaUserEntry[]> {
  const result = await pool.query<BetaUserDbRow>(
    `SELECT
       ffbu.id,
       ffbu.user_id,
       u.name,
       u.email,
       ffbu.added_at
     FROM feature_flag_beta_users ffbu
     JOIN users u ON u.id = ffbu.user_id
     WHERE ffbu.flag_key = $1
     ORDER BY ffbu.added_at ASC`,
    [key],
  );
  return result.rows.map((r) => ({
    ...r,
    added_at: r.added_at.toISOString(),
  }));
}

/**
 * Enrolls a user in the beta for a feature flag.
 * Writes an audit log entry in the same transaction.
 * Throws a typed BETA_USER_ALREADY_ENROLLED error on duplicate (PG 23505). (MINCRM-489)
 *
 * @returns The new enrollment entry.
 */
export async function enrollBetaUser(
  flagKey: string,
  userId: string,
  actor: AuditActor,
): Promise<BetaUserEntry> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const flagRow = await client.query<{ label: string }>(
      `SELECT label FROM feature_flags WHERE flag_key = $1`,
      [flagKey],
    );
    if (!flagRow.rows[0]) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error(`Feature flag '${flagKey}' not found`), {
        code: 'FEATURE_FLAG_NOT_FOUND',
      });
    }

    const userRow = await client.query<{ name: string; email: string }>(
      `SELECT name, email FROM users WHERE id = $1`,
      [userId],
    );
    if (!userRow.rows[0]) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error(`User '${userId}' not found`), {
        code: 'USER_NOT_FOUND',
      });
    }

    const insertResult = await client.query<{ id: string; added_at: Date }>(
      `INSERT INTO feature_flag_beta_users (flag_key, user_id, added_by)
       VALUES ($1, $2, $3)
       RETURNING id, added_at`,
      [flagKey, userId, actor.id],
    );

    await writeAuditEntry(client, {
      recordType: 'feature_flag',
      recordId: null,
      recordName: flagRow.rows[0].label,
      eventType: 'updated',
      fieldName: 'beta_users',
      oldValue: 'null',
      newValue: userRow.rows[0].name,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    const row = insertResult.rows[0];
    return {
      id: row.id,
      user_id: userId,
      name: userRow.rows[0].name,
      email: userRow.rows[0].email,
      added_at: row.added_at.toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') {
      throw Object.assign(new Error(`User is already enrolled in the beta for '${flagKey}'`), {
        code: 'BETA_USER_ALREADY_ENROLLED',
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes a user's beta enrollment for a feature flag.
 * Writes an audit log entry in the same transaction.
 * Returns false if no enrollment existed. (MINCRM-489)
 */
export async function removeBetaUser(
  flagKey: string,
  userId: string,
  actor: AuditActor,
): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const flagRow = await client.query<{ label: string }>(
      `SELECT label FROM feature_flags WHERE flag_key = $1`,
      [flagKey],
    );

    const userRow = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
      userId,
    ]);

    const deleteResult = await client.query(
      `DELETE FROM feature_flag_beta_users WHERE flag_key = $1 AND user_id = $2`,
      [flagKey, userId],
    );

    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await writeAuditEntry(client, {
      recordType: 'feature_flag',
      recordId: null,
      recordName: flagRow.rows[0]?.label ?? flagKey,
      eventType: 'updated',
      fieldName: 'beta_users',
      oldValue: userRow.rows[0]?.name ?? userId,
      newValue: 'null',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
