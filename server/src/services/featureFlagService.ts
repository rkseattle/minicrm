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
} from '@minicrm/shared/schemas/featureFlagSchema.js';
import type { UserRole } from '@minicrm/shared/schemas/userSchema.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Raw DB row from the feature_flags table joined with updated_by name. */
interface FeatureFlagDbRow {
  flag_key: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  role_overrides: RoleOverrides;
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
       ff.updated_by,
       u.name AS updated_by_name,
       ff.updated_at,
       ff.system_flag
     FROM feature_flags ff
     LEFT JOIN users u ON u.id = ff.updated_by
     ORDER BY ff.category, ff.label`,
  );

  cache = { rows: result.rows, expiresAt: Date.now() + CACHE_TTL_MS };
  return result.rows;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns all feature flags with their active user counts for the last 30 days.
 */
export async function listFeatureFlags(): Promise<FeatureFlagRow[]> {
  const [rows, usageCounts] = await Promise.all([getCachedRows(), getActiveUserCounts()]);

  return rows.map((row) => ({
    ...row,
    updated_at: row.updated_at.toISOString(),
    active_user_count: usageCounts.get(row.flag_key) ?? 0,
  })) as FeatureFlagRow[];
}

/**
 * Returns a single feature flag row. Returns null if the key does not exist.
 */
export async function getFeatureFlag(key: string): Promise<FeatureFlagRow | null> {
  const rows = await getCachedRows();
  const row = rows.find((r) => r.flag_key === key);
  if (!row) return null;

  const count = await getActiveUserCountForFlag(key);
  return {
    ...row,
    updated_at: row.updated_at.toISOString(),
    active_user_count: count,
  } as FeatureFlagRow;
}

/**
 * Returns true if the flag is enabled for the given role (or org-wide if no role given).
 * This is the hot-path check used by requireFeatureEnabled middleware — always cache-backed.
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const rows = await getCachedRows();
  const row = rows.find((r) => r.flag_key === key);
  // Unknown flag keys are treated as disabled to fail safely.
  if (!row) {
    logger.warn(`isFeatureEnabled: unknown flag key '${key}' — treating as disabled`);
    return false;
  }
  return row.enabled;
}

/**
 * Returns true if the flag is enabled for a specific user role.
 * Checks role_overrides[role] first; falls back to the org-wide enabled value.
 */
export async function isFlagEnabledForRole(key: string, role: UserRole): Promise<boolean> {
  const rows = await getCachedRows();
  const row = rows.find((r) => r.flag_key === key);
  if (!row) {
    logger.warn(`isFlagEnabledForRole: unknown flag key '${key}' — treating as disabled`);
    return false;
  }

  const overrides = row.role_overrides;
  if (overrides != null && overrides[role] !== undefined) {
    return overrides[role] as boolean;
  }
  return row.enabled;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

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
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<FeatureFlagDbRow>(
      `SELECT ff.flag_key, ff.label, ff.enabled, ff.role_overrides
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

    const result = await client.query<FeatureFlagDbRow>(
      `UPDATE feature_flags
       SET enabled        = $1,
           role_overrides = $2,
           updated_by     = $3,
           updated_at     = now()
       WHERE flag_key = $4
       RETURNING
         flag_key, label, description, category, enabled,
         role_overrides, updated_by, updated_at, system_flag`,
      [patch.enabled, newRoleOverrides, actor.id, key],
    );
    const updated = result.rows[0];

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

    await client.query('COMMIT');
    invalidateCache();

    if (patch.enabled === false && opts?.onDisabled) {
      void opts.onDisabled();
    }

    return {
      ...updated,
      updated_by_name: actor.name,
      updated_at: updated.updated_at.toISOString(),
      active_user_count: await getActiveUserCountForFlag(key),
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
