/**
 * Feature flag service — all database operations and caching for the feature flag registry.
 * Business logic belongs here. Controllers must not query the database directly.
 * (MINCRM-463, MINCRM-490, MINCRM-492, MINCRM-565)
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
  RolloutStage,
  OverrideDirection,
  UserOverrideEntry,
  OverrideCount,
  CreateFlagGroupInput,
  UpdateFlagGroupInput,
  FlagGroupRow,
  GroupBetaUserEntry,
} from '@minicrm/shared/schemas/featureFlagSchema.js';

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
  rollout_percentage: number | null;
  rollout_stages: RolloutStage[] | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: Date;
  system_flag: boolean;
  /** Group this flag belongs to, or null if ungrouped. (MINCRM-491) */
  group_key: string | null;
}

/** Raw DB row from the feature_flag_groups table joined with updated_by name. (MINCRM-491) */
interface FlagGroupDbRow {
  group_key: string;
  label: string;
  description: string;
  enabled: boolean;
  enable_at: Date | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: Date;
}

// ── Stable hash (MINCRM-490) ──────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash — produces a deterministic unsigned integer for a string.
 * Used to assign users to stable rollout cohorts: bucket = stableHash(userId + flagKey) % 100.
 * The same input always produces the same output across server restarts and deployments.
 */
export function stableHash(input: string): number {
  // FNV-1a offset basis and prime for 32-bit variant.
  const FNV_OFFSET_BASIS = 0x811c9dc5;
  const FNV_PRIME = 0x01000193;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply modulo 2^32 using bit manipulation to stay within JS 32-bit int range.
    hash = Math.imul(hash, FNV_PRIME);
  }
  // >>> 0 converts to an unsigned 32-bit integer (0 to 4294967295).
  return hash >>> 0;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

/** TTL for the feature flag cache in milliseconds. Zero in E2E so DB resets take effect immediately. */
const CACHE_TTL_MS = process.env['E2E'] === 'true' ? 0 : 60_000;

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
       ff.rollout_percentage,
       ff.rollout_stages,
       ff.updated_by,
       u.name AS updated_by_name,
       ff.updated_at,
       ff.system_flag,
       ff.group_key
     FROM feature_flags ff
     LEFT JOIN users u ON u.id = ff.updated_by
     ORDER BY ff.category,
              -- 'ai_features' is the master toggle; always list it first in the AI category.
              CASE WHEN ff.flag_key = 'ai_features' THEN 0 ELSE 1 END,
              ff.label`,
  );

  // Cap TTL at the time until the nearest future enable_at across flags and groups,
  // so a scheduled enable fires without waiting for the full 60-second TTL. (MINCRM-488, MINCRM-491)
  const now = Date.now();

  const flagEnableAts = result.rows
    .map((r) => r.enable_at?.getTime() ?? null)
    .filter((t): t is number => t !== null && t > now);

  // Also query group enable_at values to keep cache TTL tight for group-level scheduling.
  const groupEnableAtResult = await pool.query<{ enable_at: Date | null }>(
    `SELECT enable_at FROM feature_flag_groups WHERE enable_at IS NOT NULL AND enable_at > now()`,
  );
  const groupEnableAts = groupEnableAtResult.rows
    .map((r) => r.enable_at?.getTime() ?? null)
    .filter((t): t is number => t !== null && t > now);

  const nearestEnableAt = [...flagEnableAts, ...groupEnableAts].reduce(
    (min, t) => Math.min(min, t),
    Infinity,
  );

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
  const [rows, usageCounts, betaCounts, overrideCounts] = await Promise.all([
    getCachedRows(),
    getActiveUserCounts(),
    getBetaUserCounts(),
    getOverrideCounts(),
  ]);

  return rows.map((row) => ({
    ...row,
    enable_at: row.enable_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
    active_user_count: usageCounts.get(row.flag_key) ?? 0,
    beta_user_count: betaCounts.get(row.flag_key) ?? 0,
    override_count: overrideCounts.get(row.flag_key) ?? { force_enabled: 0, force_disabled: 0 },
    group_key: row.group_key ?? null,
  })) as FeatureFlagRow[];
}

/**
 * Returns a single feature flag row. Returns null if the key does not exist.
 */
export async function getFeatureFlag(key: string): Promise<FeatureFlagRow | null> {
  const rows = await getCachedRows();
  const row = rows.find((r) => r.flag_key === key);
  if (!row) return null;

  const [count, betaCount, overrideCount] = await Promise.all([
    getActiveUserCountForFlag(key),
    getBetaUserCountForFlag(key),
    getOverrideCountForFlag(key),
  ]);
  return {
    ...row,
    enable_at: row.enable_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
    active_user_count: count,
    beta_user_count: betaCount,
    override_count: overrideCount,
    group_key: row.group_key ?? null,
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
 * falls back to the org-wide enabled value. (MINCRM-488, MINCRM-565)
 *
 * @param role - Role name string; accepts both built-in roles and custom role names.
 */
export async function isFlagEnabledForRole(key: string, role: string): Promise<boolean> {
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
    // role_overrides values are always boolean; the Zod schema and DB write enforce it.
    return overrides[role]!;
  }
  return row.enabled;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Validates that all role keys in a role_overrides map exist in the current role set.
 * Queries the live DB (built-in + custom roles) so that newly created custom roles are
 * accepted and deleted roles are rejected. Throws typed domain errors on invalid input.
 * Runs inside the caller's transaction so that no separate pool.query() is needed.
 * (MINCRM-565)
 */
async function assertValidRoleOverrides(
  overrides: RoleOverrides,
  client: PoolClient,
): Promise<void> {
  if (overrides == null) return;

  const keys = Object.keys(overrides);
  if (keys.length === 0) return;

  // custom_roles holds both built-in rows (is_builtin=true: admin, rep, manager, viewer,
  // service_account) and tenant-defined custom roles — one query covers the full valid set.
  // FOR SHARE scoped to only the keys being validated prevents a concurrent DELETE from removing
  // a validated role between this SELECT and the UPDATE feature_flags below, eliminating the
  // TOCTOU race while avoiding unnecessary locks on unrelated rows. (MINCRM-565)
  const knownRoles = await client.query<{ name: string }>(
    `SELECT name FROM public.custom_roles WHERE name = ANY($1::text[]) FOR SHARE`,
    [keys],
  );
  const knownRoleSet = new Set(knownRoles.rows.map((r) => r.name));

  for (const key of keys) {
    if (!knownRoleSet.has(key)) {
      throw Object.assign(new Error(`role_overrides contains unknown role key: '${key}'`), {
        code: 'FEATURE_FLAG_UNKNOWN_ROLE_KEY',
      });
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
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate role_overrides keys against live DB role set inside the transaction so the
    // check is consistent with the state visible to the concurrent UPDATE below. (MINCRM-565)
    if (patch.role_overrides !== undefined) {
      await assertValidRoleOverrides(patch.role_overrides, client);
    }

    const existing = await client.query<FeatureFlagDbRow>(
      `SELECT ff.flag_key, ff.label, ff.enabled, ff.role_overrides, ff.enable_at,
              ff.rollout_percentage, ff.rollout_stages, ff.group_key
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
    const newRolloutPercentage =
      patch.rollout_percentage !== undefined ? patch.rollout_percentage : before.rollout_percentage;
    const newRolloutStages =
      patch.rollout_stages !== undefined ? patch.rollout_stages : before.rollout_stages;
    // undefined means "not in request body, keep existing"; null means "unassign from group"
    const newGroupKey =
      patch.group_key !== undefined ? patch.group_key : (before.group_key ?? null);

    // Validate that the target group exists when assigning. (MINCRM-491)
    if (patch.group_key != null) {
      const groupExists = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM feature_flag_groups WHERE group_key = $1) AS exists`,
        [patch.group_key],
      );
      if (!groupExists.rows[0]?.exists) {
        await client.query('ROLLBACK');
        throw Object.assign(new Error(`Feature flag group '${patch.group_key}' does not exist`), {
          code: 'FLAG_GROUP_NOT_FOUND',
        });
      }
    }

    const result = await client.query<FeatureFlagDbRow>(
      `UPDATE feature_flags
       SET enabled            = $1,
           role_overrides     = $2,
           enable_at          = $3,
           rollout_percentage = $4,
           rollout_stages     = $5,
           group_key          = $6,
           updated_by         = $7,
           updated_at         = now()
       WHERE flag_key = $8
       RETURNING
         flag_key, label, description, category, enabled,
         role_overrides, enable_at, rollout_percentage, rollout_stages,
         group_key, updated_by, updated_at, system_flag`,
      [
        patch.enabled,
        newRoleOverrides,
        newEnableAt ?? null,
        newRolloutPercentage ?? null,
        newRolloutStages ? JSON.stringify(newRolloutStages) : null,
        newGroupKey ?? null,
        actor.id,
        key,
      ],
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

    // Audit rollout_percentage changes. (MINCRM-490)
    if (
      patch.rollout_percentage !== undefined &&
      patch.rollout_percentage !== before.rollout_percentage
    ) {
      await writeAuditEntry(client, {
        recordType: 'feature_flag',
        recordId: null,
        recordName: before.label,
        eventType: 'updated',
        fieldName: 'rollout_percentage',
        oldValue: before.rollout_percentage === null ? 'null' : String(before.rollout_percentage),
        newValue: patch.rollout_percentage === null ? 'null' : String(patch.rollout_percentage),
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    // Audit rollout_stages changes. (MINCRM-490)
    if (
      patch.rollout_stages !== undefined &&
      JSON.stringify(patch.rollout_stages) !== JSON.stringify(before.rollout_stages)
    ) {
      await writeAuditEntry(client, {
        recordType: 'feature_flag',
        recordId: null,
        recordName: before.label,
        eventType: 'updated',
        fieldName: 'rollout_stages',
        oldValue: JSON.stringify(before.rollout_stages ?? null),
        newValue: JSON.stringify(patch.rollout_stages ?? null),
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    // Audit group assignment changes. (MINCRM-491)
    if (patch.group_key !== undefined && newGroupKey !== (before.group_key ?? null)) {
      await writeAuditEntry(client, {
        recordType: 'feature_flag',
        recordId: null,
        recordName: before.label,
        eventType: 'updated',
        fieldName: 'group_key',
        oldValue: before.group_key ?? 'null',
        newValue: newGroupKey ?? 'null',
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

    const [activeCount, betaCount, overrideCount] = await Promise.all([
      getActiveUserCountForFlag(key),
      getBetaUserCountForFlag(key),
      getOverrideCountForFlag(key),
    ]);

    return {
      ...updated,
      enable_at: updated.enable_at?.toISOString() ?? null,
      updated_by_name: actor.name,
      updated_at: updated.updated_at.toISOString(),
      active_user_count: activeCount,
      beta_user_count: betaCount,
      override_count: overrideCount,
      group_key: updated.group_key ?? null,
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

// ── Override counts (MINCRM-492) ──────────────────────────────────────────────

/**
 * Returns the override count (force_enabled + force_disabled) for a single flag.
 * Always queries fresh — override membership is never served from the flag cache.
 */
async function getOverrideCountForFlag(key: string): Promise<OverrideCount> {
  const result = await pool.query<{ override: OverrideDirection; count: string }>(
    `SELECT override, COUNT(*)::text AS count
     FROM feature_flag_user_overrides
     WHERE flag_key = $1
     GROUP BY override`,
    [key],
  );
  const counts: OverrideCount = { force_enabled: 0, force_disabled: 0 };
  for (const row of result.rows) {
    counts[row.override] = parseInt(row.count, 10);
  }
  return counts;
}

/**
 * Returns a map of flag_key → OverrideCount for all flags.
 * Used by listFeatureFlags to avoid N+1 queries. Always queries fresh.
 */
async function getOverrideCounts(): Promise<Map<string, OverrideCount>> {
  const result = await pool.query<{ flag_key: string; override: OverrideDirection; count: string }>(
    `SELECT flag_key, override, COUNT(*)::text AS count
     FROM feature_flag_user_overrides
     GROUP BY flag_key, override`,
  );
  const map = new Map<string, OverrideCount>();
  for (const row of result.rows) {
    const existing = map.get(row.flag_key) ?? { force_enabled: 0, force_disabled: 0 };
    existing[row.override] = parseInt(row.count, 10);
    map.set(row.flag_key, existing);
  }
  return map;
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
 * The 'ai_features' master toggle's key. AI sub-feature flags (ai_nli_page
 * through ai_stage_advancement — see FEATURE_FLAG_KEYS) are child flags of
 * this master toggle: it must gate them before any of their own per-user
 * overrides, beta membership, or rollout bucketing, matching its documented
 * behavior ("hidden from all users regardless of per-feature or per-role
 * settings"). (MINCRM-460)
 */
const AI_MASTER_FEATURE_FLAG_KEY = 'ai_features';

/** True for every AI sub-feature flag key that is gated by ai_features (not ai_features itself). */
function isAiSubFeatureFlag(key: string): boolean {
  return key.startsWith('ai_') && key !== AI_MASTER_FEATURE_FLAG_KEY;
}

/**
 * Returns true if the flag is enabled for a specific user.
 *
 * Evaluation order (MINCRM-492, MINCRM-490, MINCRM-489, MINCRM-460):
 *   0. AI sub-feature flags only: if the ai_features master toggle is disabled
 *      for this user, deny immediately — supersedes every other rule below.
 *   1. User override (force_enabled → true; force_disabled → false) — unconditional.
 *   2. Beta membership → true.
 *   3. Rollout bucketing: stableHash(userId + key) % 100 < rollout_percentage → result.
 *   4. Org-wide enabled / enable_at / role overrides.
 *
 * Steps 1 and 2 always query fresh — never served from the flag cache.
 */
export async function isFlagEnabledForUser(
  key: string,
  userId: string,
  role: string,
): Promise<boolean> {
  // Step 0: the ai_features master toggle gates every ai_* sub-feature flag before
  // any of its own targeting rules are consulted.
  if (isAiSubFeatureFlag(key)) {
    const masterEnabled = await isFlagEnabledForUser(AI_MASTER_FEATURE_FLAG_KEY, userId, role);
    if (!masterEnabled) return false;
  }

  const rows = await getCachedRows();
  const row = rows.find((r) => r.flag_key === key);

  // Unknown flag keys are not in the registry — treat as disabled and avoid live DB round-trips.
  if (!row) {
    logger.warn(`isFlagEnabledForUser: unknown flag key '${key}' — treating as disabled`);
    return false;
  }

  // Step 1: per-user force overrides win over everything, including the group gate.
  // (documented at POST /api/v1/feature-flags/:key/overrides — "unconditionally overrides
  // all other targeting rules including group gates") (MINCRM-492, MINCRM-491)
  const overrideResult = await pool.query<{ override: OverrideDirection }>(
    `SELECT override FROM feature_flag_user_overrides WHERE flag_key = $1 AND user_id = $2`,
    [key, userId],
  );
  const userOverride = overrideResult.rows[0]?.override;
  if (userOverride === 'force_enabled') return true;
  if (userOverride === 'force_disabled') return false;

  // Step 2: group gate — if the flag belongs to a group, check the group before flag-level rules.
  // A disabled group blocks the flag for everyone except users in the group's own beta list.
  // The group gate is a kill switch for all non-force-overridden users. (MINCRM-491)
  if (row?.group_key) {
    const groupPassResult = await pool.query<{
      enabled: boolean;
      enable_at: Date | null;
      in_group_beta: boolean;
    }>(
      `SELECT
         g.enabled,
         g.enable_at,
         EXISTS(
           SELECT 1 FROM feature_flag_group_beta_users gb
           WHERE gb.group_key = g.group_key AND gb.user_id = $2
         ) AS in_group_beta
       FROM feature_flag_groups g
       WHERE g.group_key = $1`,
      [row.group_key, userId],
    );

    const groupRow = groupPassResult.rows[0];
    if (groupRow) {
      const groupEnabled =
        groupRow.enabled ||
        (groupRow.enable_at !== null && groupRow.enable_at.getTime() <= Date.now());
      // If the group is disabled and the user is not in the group beta, deny immediately.
      if (!groupEnabled && !groupRow.in_group_beta) return false;
    }
    // If the group row is missing (deleted between cache population and now), allow through.
  }

  // Step 3: flag-level beta membership → always enabled for beta users (MINCRM-489).
  const betaResult = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM feature_flag_beta_users
       WHERE flag_key = $1 AND user_id = $2
     ) AS exists`,
    [key, userId],
  );
  if (betaResult.rows[0]?.exists) return true;

  // Step 4: rollout bucketing (MINCRM-490).
  // Only consult the cache for the rollout_percentage value — beta/override are always fresh.
  // Rollout acts as its own activation path: a flag with rollout_percentage set can enable
  // users even when enabled=false, allowing gradual rollout before a full org-wide flip.
  // To kill the rollout, clear rollout_percentage (set to null) or set it to 0.
  if (row && row.rollout_percentage !== null) {
    const bucket = stableHash(userId + key) % 100;
    return bucket < row.rollout_percentage;
  }

  // Step 5: org-wide enabled / enable_at / role overrides.
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
    // Pre-flight checks outside the transaction — avoids a double-ROLLBACK when
    // the outer catch unconditionally rolls back after an inner throw.
    const flagRow = await client.query<{ label: string }>(
      `SELECT label FROM feature_flags WHERE flag_key = $1`,
      [flagKey],
    );
    if (!flagRow.rows[0]) {
      throw Object.assign(new Error(`Feature flag '${flagKey}' not found`), {
        code: 'FEATURE_FLAG_NOT_FOUND',
      });
    }

    const userRow = await client.query<{ name: string; email: string }>(
      `SELECT name, email FROM users WHERE id = $1`,
      [userId],
    );
    if (!userRow.rows[0]) {
      throw Object.assign(new Error(`User '${userId}' not found`), {
        code: 'USER_NOT_FOUND',
      });
    }

    await client.query('BEGIN');

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

// ── Per-user override CRUD (MINCRM-492) ──────────────────────────────────────

/** Raw DB row from feature_flag_user_overrides joined with user details. */
interface UserOverrideDbRow {
  id: string;
  flag_key: string;
  user_id: string;
  name: string;
  email: string;
  override: OverrideDirection;
  reason: string | null;
  added_at: Date;
}

/**
 * Returns all per-user overrides for a feature flag, ordered by added_at ASC.
 * Always queries fresh — override membership is never served from the flag cache.
 * (MINCRM-492)
 */
export async function listUserOverrides(flagKey: string): Promise<UserOverrideEntry[]> {
  const result = await pool.query<UserOverrideDbRow>(
    `SELECT
       o.id,
       o.flag_key,
       o.user_id,
       u.name,
       u.email,
       o.override,
       o.reason,
       o.added_at
     FROM feature_flag_user_overrides o
     JOIN users u ON u.id = o.user_id
     WHERE o.flag_key = $1
     ORDER BY o.added_at ASC`,
    [flagKey],
  );
  return result.rows.map((r) => ({ ...r, added_at: r.added_at.toISOString() }));
}

/**
 * Upserts a per-user override for a feature flag.
 * A user may have at most one override per flag — an existing override is replaced (MINCRM-492).
 * Writes an audit entry in the same transaction.
 *
 * @throws FEATURE_FLAG_NOT_FOUND if the flag does not exist.
 * @throws USER_NOT_FOUND if the target user does not exist.
 * @returns The upserted override entry.
 */
export async function upsertUserOverride(
  flagKey: string,
  userId: string,
  direction: OverrideDirection,
  reason: string | null,
  actor: AuditActor,
): Promise<UserOverrideEntry> {
  const client: PoolClient = await pool.connect();
  try {
    // Pre-flight checks outside transaction to avoid double-ROLLBACK on pre-check failures.
    const flagRow = await client.query<{ label: string }>(
      `SELECT label FROM feature_flags WHERE flag_key = $1`,
      [flagKey],
    );
    if (!flagRow.rows[0]) {
      throw Object.assign(new Error(`Feature flag '${flagKey}' not found`), {
        code: 'FEATURE_FLAG_NOT_FOUND',
      });
    }

    const userRow = await client.query<{ name: string; email: string }>(
      `SELECT name, email FROM users WHERE id = $1`,
      [userId],
    );
    if (!userRow.rows[0]) {
      throw Object.assign(new Error(`User '${userId}' not found`), { code: 'USER_NOT_FOUND' });
    }

    await client.query('BEGIN');

    const existingOverrideResult = await client.query<{ override: OverrideDirection }>(
      `SELECT override FROM feature_flag_user_overrides WHERE flag_key = $1 AND user_id = $2`,
      [flagKey, userId],
    );
    const priorDirection = existingOverrideResult.rows[0]?.override ?? null;

    const upsertResult = await client.query<{ id: string; added_at: Date }>(
      `INSERT INTO feature_flag_user_overrides (flag_key, user_id, override, reason, added_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (flag_key, user_id) DO UPDATE
         SET override  = EXCLUDED.override,
             reason    = EXCLUDED.reason,
             added_by  = EXCLUDED.added_by,
             added_at  = now()
       RETURNING id, added_at`,
      [flagKey, userId, direction, reason ?? null, actor.id],
    );

    await writeAuditEntry(client, {
      recordType: 'feature_flag',
      recordId: null,
      recordName: flagRow.rows[0].label,
      eventType: 'updated',
      fieldName: 'user_override',
      oldValue: priorDirection ? `${priorDirection} for ${userRow.rows[0].name}` : 'null',
      newValue: `${direction} for ${userRow.rows[0].name}${reason ? ` (${reason})` : ''}`,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    const row = upsertResult.rows[0];
    return {
      id: row.id,
      flag_key: flagKey,
      user_id: userId,
      name: userRow.rows[0].name,
      email: userRow.rows[0].email,
      override: direction,
      reason: reason ?? null,
      added_at: row.added_at.toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes a per-user override for a feature flag.
 * Returns false if no override existed. Writes an audit entry in the same transaction.
 * (MINCRM-492)
 */
export async function deleteUserOverride(
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
    const overrideRow = await client.query<{ override: OverrideDirection }>(
      `SELECT override FROM feature_flag_user_overrides WHERE flag_key = $1 AND user_id = $2`,
      [flagKey, userId],
    );
    const priorDirection = overrideRow.rows[0]?.override;

    const deleteResult = await client.query(
      `DELETE FROM feature_flag_user_overrides WHERE flag_key = $1 AND user_id = $2`,
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
      fieldName: 'user_override',
      oldValue: `${priorDirection ?? 'unknown'} for ${userRow.rows[0]?.name ?? userId}`,
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

// ── Flag group CRUD (MINCRM-491) ──────────────────────────────────────────────

/**
 * Maps a raw DB group row to the API shape.
 */
function toFlagGroupRow(
  row: FlagGroupDbRow,
  memberCount: number,
  betaUserCount: number,
): FlagGroupRow {
  return {
    group_key: row.group_key,
    label: row.label,
    description: row.description,
    enabled: row.enabled,
    enable_at: row.enable_at?.toISOString() ?? null,
    updated_by: row.updated_by ?? null,
    updated_by_name: row.updated_by_name ?? null,
    updated_at: row.updated_at.toISOString(),
    member_count: memberCount,
    beta_user_count: betaUserCount,
  };
}

/**
 * Returns all flag groups with member_count and beta_user_count. Admin only.
 */
export async function listFlagGroups(): Promise<FlagGroupRow[]> {
  const result = await pool.query<
    FlagGroupDbRow & { member_count: string; beta_user_count: string }
  >(
    `SELECT
       g.group_key,
       g.label,
       g.description,
       g.enabled,
       g.enable_at,
       g.updated_by,
       u.name AS updated_by_name,
       g.updated_at,
       COUNT(DISTINCT ff.flag_key)::text AS member_count,
       COUNT(DISTINCT gb.user_id)::text AS beta_user_count
     FROM feature_flag_groups g
     LEFT JOIN users u ON u.id = g.updated_by
     LEFT JOIN feature_flags ff ON ff.group_key = g.group_key
     LEFT JOIN feature_flag_group_beta_users gb ON gb.group_key = g.group_key
     GROUP BY g.group_key, u.name
     ORDER BY g.label`,
  );

  return result.rows.map((r) =>
    toFlagGroupRow(r, parseInt(r.member_count, 10), parseInt(r.beta_user_count, 10)),
  );
}

/**
 * Creates a new flag group. Throws FLAG_GROUP_DUPLICATE_KEY on 23505. (MINCRM-491)
 */
export async function createFlagGroup(
  input: CreateFlagGroupInput,
  actor: AuditActor,
): Promise<FlagGroupRow> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query<FlagGroupDbRow>(
      `INSERT INTO feature_flag_groups (group_key, label, description, updated_by)
       VALUES ($1, $2, $3, $4)
       RETURNING group_key, label, description, enabled, enable_at, updated_by, updated_at`,
      [input.group_key, input.label, input.description ?? '', actor.id],
    );
    const inserted = insertResult.rows[0]!;

    await writeAuditEntry(client, {
      recordType: 'feature_flag_group',
      recordId: null,
      recordName: input.label,
      eventType: 'created',
      fieldName: 'group_key',
      oldValue: 'null',
      newValue: input.group_key,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    invalidateCache();

    return toFlagGroupRow({ ...inserted, updated_by_name: actor.name }, 0, 0);
  } catch (err) {
    await client.query('ROLLBACK');
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') {
      throw Object.assign(new Error(`Feature flag group '${input.group_key}' already exists`), {
        code: 'FLAG_GROUP_DUPLICATE_KEY',
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates a flag group's label, description, enabled state, or enable_at schedule.
 * Returns null if the group does not exist. (MINCRM-491)
 */
export async function updateFlagGroup(
  groupKey: string,
  patch: UpdateFlagGroupInput,
  actor: AuditActor,
): Promise<FlagGroupRow | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<FlagGroupDbRow>(
      `SELECT group_key, label, description, enabled, enable_at, updated_by, updated_at
       FROM feature_flag_groups
       WHERE group_key = $1
       FOR UPDATE`,
      [groupKey],
    );
    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    const before = existing.rows[0];
    const newLabel = patch.label !== undefined ? patch.label : before.label;
    const newDescription = patch.description !== undefined ? patch.description : before.description;
    const newEnabled = patch.enabled !== undefined ? patch.enabled : before.enabled;
    const newEnableAt =
      patch.enable_at !== undefined ? patch.enable_at : (before.enable_at?.toISOString() ?? null);

    const updateResult = await client.query<FlagGroupDbRow>(
      `UPDATE feature_flag_groups
       SET label       = $1,
           description = $2,
           enabled     = $3,
           enable_at   = $4,
           updated_by  = $5,
           updated_at  = now()
       WHERE group_key = $6
       RETURNING group_key, label, description, enabled, enable_at, updated_by, updated_at`,
      [newLabel, newDescription, newEnabled, newEnableAt ?? null, actor.id, groupKey],
    );
    const updated = updateResult.rows[0]!;

    if (patch.enabled !== undefined && patch.enabled !== before.enabled) {
      await writeAuditEntry(client, {
        recordType: 'feature_flag_group',
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

    if (patch.label !== undefined && patch.label !== before.label) {
      await writeAuditEntry(client, {
        recordType: 'feature_flag_group',
        recordId: null,
        recordName: before.label,
        eventType: 'updated',
        fieldName: 'label',
        oldValue: before.label,
        newValue: patch.label,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    if (patch.description !== undefined && patch.description !== before.description) {
      await writeAuditEntry(client, {
        recordType: 'feature_flag_group',
        recordId: null,
        recordName: before.label,
        eventType: 'updated',
        fieldName: 'description',
        oldValue: before.description,
        newValue: patch.description,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    const beforeEnableAt = before.enable_at?.toISOString() ?? null;
    if (patch.enable_at !== undefined && patch.enable_at !== beforeEnableAt) {
      await writeAuditEntry(client, {
        recordType: 'feature_flag_group',
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

    const [memberCount, betaUserCount] = await Promise.all([
      getFlagGroupMemberCount(groupKey),
      getFlagGroupBetaUserCount(groupKey),
    ]);

    return toFlagGroupRow({ ...updated, updated_by_name: actor.name }, memberCount, betaUserCount);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes a flag group and atomically unassigns all member flags (sets their group_key to NULL).
 * Returns false if the group does not exist. Writes audit entries for each unassigned flag and
 * for the group deletion itself, all within the same transaction. (MINCRM-567)
 */
export async function deleteFlagGroup(groupKey: string, actor: AuditActor): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const groupRow = await client.query<{ label: string }>(
      `SELECT label FROM feature_flag_groups WHERE group_key = $1 FOR UPDATE`,
      [groupKey],
    );
    if (!groupRow.rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    const groupLabel = groupRow.rows[0].label;

    // Fetch member flags before unassigning so we can write per-flag audit entries.
    const membersResult = await client.query<{ flag_key: string; label: string }>(
      `SELECT flag_key, label FROM feature_flags WHERE group_key = $1 FOR UPDATE`,
      [groupKey],
    );

    if (membersResult.rows.length > 0) {
      await client.query(
        `UPDATE feature_flags SET group_key = NULL, updated_by = $2, updated_at = NOW() WHERE group_key = $1`,
        [groupKey, actor.id],
      );
      for (const flag of membersResult.rows) {
        await writeAuditEntry(client, {
          recordType: 'feature_flag',
          recordId: null,
          recordName: flag.label,
          eventType: 'updated',
          fieldName: 'group_key',
          oldValue: groupKey,
          newValue: 'null',
          changedById: actor.id,
          changedByName: actor.name,
        });
      }
    }

    await client.query(`DELETE FROM feature_flag_groups WHERE group_key = $1`, [groupKey]);

    await writeAuditEntry(client, {
      recordType: 'feature_flag_group',
      recordId: null,
      recordName: groupLabel,
      eventType: 'deleted',
      fieldName: 'group_key',
      oldValue: groupKey,
      newValue: 'null',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    invalidateCache();
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns count of feature flags assigned to a group.
 */
async function getFlagGroupMemberCount(groupKey: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM feature_flags WHERE group_key = $1`,
    [groupKey],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Returns count of beta users enrolled in a group.
 */
async function getFlagGroupBetaUserCount(groupKey: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM feature_flag_group_beta_users WHERE group_key = $1`,
    [groupKey],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

// ── Group beta user CRUD (MINCRM-491) ─────────────────────────────────────────

/** Raw DB row from feature_flag_group_beta_users joined with user details. */
interface GroupBetaUserDbRow {
  group_key: string;
  user_id: string;
  name: string;
  email: string;
  added_at: Date;
}

/**
 * Returns the list of users enrolled in the beta for a specific group. Always queries fresh.
 */
export async function getFlagGroupBetaUsers(groupKey: string): Promise<GroupBetaUserEntry[]> {
  const exists = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM feature_flag_groups WHERE group_key = $1) AS exists`,
    [groupKey],
  );
  if (!exists.rows[0]?.exists) {
    throw Object.assign(new Error(`Feature flag group '${groupKey}' not found`), {
      code: 'FLAG_GROUP_NOT_FOUND',
    });
  }

  const result = await pool.query<GroupBetaUserDbRow>(
    `SELECT
       gb.group_key,
       gb.user_id,
       u.name,
       u.email,
       gb.added_at
     FROM feature_flag_group_beta_users gb
     JOIN users u ON u.id = gb.user_id
     WHERE gb.group_key = $1
     ORDER BY gb.added_at ASC`,
    [groupKey],
  );
  return result.rows.map((r) => ({ ...r, added_at: r.added_at.toISOString() }));
}

/**
 * Enrolls a user in the beta for a flag group.
 * Writes an audit entry in the same transaction.
 * Throws GROUP_BETA_USER_ALREADY_ENROLLED on duplicate. (MINCRM-491)
 */
export async function addGroupBetaUser(
  groupKey: string,
  userId: string,
  actor: AuditActor,
): Promise<GroupBetaUserEntry> {
  const client: PoolClient = await pool.connect();
  try {
    // Verify user exists before opening a transaction (user rows are never concurrently deleted
    // in normal operation; no lock needed here).
    const userRow = await client.query<{ name: string; email: string }>(
      `SELECT name, email FROM users WHERE id = $1`,
      [userId],
    );
    if (!userRow.rows[0]) {
      throw Object.assign(new Error(`User '${userId}' not found`), { code: 'USER_NOT_FOUND' });
    }

    await client.query('BEGIN');

    // Lock the group row inside the transaction so a concurrent DELETE cannot remove the
    // group between the existence check and the FK-referencing INSERT (closes the 23503 race).
    const groupRow = await client.query<{ label: string }>(
      `SELECT label FROM feature_flag_groups WHERE group_key = $1 FOR UPDATE`,
      [groupKey],
    );
    if (!groupRow.rows[0]) {
      throw Object.assign(new Error(`Feature flag group '${groupKey}' not found`), {
        code: 'FLAG_GROUP_NOT_FOUND',
      });
    }

    const insertResult = await client.query<{ added_at: Date }>(
      `INSERT INTO feature_flag_group_beta_users (group_key, user_id, added_by)
       VALUES ($1, $2, $3)
       RETURNING added_at`,
      [groupKey, userId, actor.id],
    );

    await writeAuditEntry(client, {
      recordType: 'feature_flag_group',
      recordId: null,
      recordName: groupRow.rows[0].label,
      eventType: 'updated',
      fieldName: 'beta_users',
      oldValue: 'null',
      newValue: userRow.rows[0].name,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    return {
      group_key: groupKey,
      user_id: userId,
      name: userRow.rows[0].name,
      email: userRow.rows[0].email,
      added_at: insertResult.rows[0].added_at.toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') {
      throw Object.assign(
        new Error(`User is already enrolled in the beta for group '${groupKey}'`),
        { code: 'GROUP_BETA_USER_ALREADY_ENROLLED' },
      );
    }
    // 23503 = FK violation: group was deleted between FOR UPDATE and INSERT (should not
    // happen now that we lock the group row, but handle defensively).
    if (pgErr.code === '23503') {
      throw Object.assign(new Error(`Feature flag group '${groupKey}' not found`), {
        code: 'FLAG_GROUP_NOT_FOUND',
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes a user's beta enrollment from a flag group.
 * Returns false if no enrollment existed. (MINCRM-491)
 */
export async function removeGroupBetaUser(
  groupKey: string,
  userId: string,
  actor: AuditActor,
): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the group row first — throws FLAG_GROUP_NOT_FOUND if unknown, consistent with
    // GET and POST siblings on this resource.
    const groupRow = await client.query<{ label: string }>(
      `SELECT label FROM feature_flag_groups WHERE group_key = $1 FOR UPDATE`,
      [groupKey],
    );
    if (!groupRow.rows[0]) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error(`Feature flag group '${groupKey}' not found`), {
        code: 'FLAG_GROUP_NOT_FOUND',
      });
    }

    const userRow = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
      userId,
    ]);

    const deleteResult = await client.query(
      `DELETE FROM feature_flag_group_beta_users WHERE group_key = $1 AND user_id = $2`,
      [groupKey, userId],
    );

    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await writeAuditEntry(client, {
      recordType: 'feature_flag_group',
      recordId: null,
      recordName: groupRow.rows[0]?.label ?? groupKey,
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

// ── Rollout scheduler (MINCRM-490) ────────────────────────────────────────────

/**
 * The rollout scheduler interval handle — stored so callers can stop it on shutdown.
 */
let rolloutSchedulerHandle: ReturnType<typeof setInterval> | null = null;

/** Interval between rollout stage advancement checks. */
const ROLLOUT_SCHEDULER_INTERVAL_MS = 60_000;

/**
 * Checks all feature flags for pending rollout stages and advances rollout_percentage
 * when the next stage's scheduled_at is <= now().
 *
 * Writes an audit entry per advancement and invalidates the cache after each update.
 * Called by the scheduler; also exported for direct use in tests with a past scheduled_at.
 */
export async function advanceRolloutStages(actor: AuditActor): Promise<void> {
  // Candidate scan: find flags with non-empty rollout_stages (no lock yet — just a quick read).
  const candidatesResult = await pool.query<{ flag_key: string }>(
    `SELECT flag_key
     FROM feature_flags
     WHERE rollout_stages IS NOT NULL
       AND jsonb_array_length(rollout_stages) > 0`,
  );

  if (candidatesResult.rows.length === 0) return;

  const now = new Date();
  let advanced = false;

  for (const { flag_key } of candidatesResult.rows) {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // Re-fetch with FOR UPDATE SKIP LOCKED inside the transaction so the lock is held
      // for the full duration of the update. If another instance already holds the lock
      // on this flag, we skip it — it will advance the stage instead. (MINCRM-490)
      const lockedResult = await client.query<{
        label: string;
        rollout_percentage: number | null;
        rollout_stages: RolloutStage[] | null;
        updated_by: string | null;
      }>(
        `SELECT label, rollout_percentage, rollout_stages, updated_by
         FROM feature_flags
         WHERE flag_key = $1
         FOR UPDATE SKIP LOCKED`,
        [flag_key],
      );

      if (lockedResult.rows.length === 0) {
        // Another instance holds the lock — skip this flag.
        await client.query('ROLLBACK');
        continue;
      }

      const flag = lockedResult.rows[0]!;
      const stages = flag.rollout_stages ?? [];
      const dueStages = stages.filter((s) => new Date(s.scheduled_at) <= now);
      if (dueStages.length === 0) {
        await client.query('ROLLBACK');
        continue;
      }

      // The most recently due stage wins; remove all consumed stages from the array.
      const nextStage = dueStages[dueStages.length - 1]!;
      const remainingStages = stages.filter((s) => new Date(s.scheduled_at) > now);

      if (nextStage.percentage === flag.rollout_percentage) {
        // Percentage already matches — still remove the consumed stages from the array.
        await client.query(
          `UPDATE feature_flags
           SET rollout_stages = $1::jsonb, updated_at = now()
           WHERE flag_key = $2`,
          [JSON.stringify(remainingStages), flag_key],
        );
        await client.query('COMMIT');
        advanced = true;
        continue;
      }

      await client.query(
        `UPDATE feature_flags
         SET rollout_percentage = $1,
             rollout_stages     = $2::jsonb,
             updated_by         = NULL,
             updated_at         = now()
         WHERE flag_key = $3`,
        [nextStage.percentage, JSON.stringify(remainingStages), flag_key],
      );

      await writeAuditEntry(client, {
        recordType: 'feature_flag',
        recordId: null,
        recordName: flag.label,
        eventType: 'updated',
        fieldName: 'rollout_percentage',
        oldValue: flag.rollout_percentage === null ? 'null' : String(flag.rollout_percentage),
        newValue: String(nextStage.percentage),
        changedById: actor.id,
        changedByName: actor.name,
      });

      await client.query('COMMIT');
      advanced = true;

      logger.info(
        { flagKey: flag_key, from: flag.rollout_percentage, to: nextStage.percentage },
        'Rollout stage advanced',
      );
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, flagKey: flag_key }, 'Failed to advance rollout stage');
    } finally {
      client.release();
    }
  }

  if (advanced) invalidateCache();
}

/**
 * Starts the background rollout scheduler.
 * Fires every 60 seconds and advances rollout_percentage for any flag with a due stage.
 * Must not be called in test environments (gate with NODE_ENV !== 'test').
 * Call stopRolloutScheduler() on process shutdown. (MINCRM-490)
 */
export function startRolloutScheduler(): void {
  if (rolloutSchedulerHandle !== null) {
    logger.warn('startRolloutScheduler: scheduler is already running — ignoring duplicate call');
    return;
  }
  rolloutSchedulerHandle = setInterval(() => {
    void advanceRolloutStages({ id: '00000000-0000-0000-0000-000000000000', name: 'System' }).catch(
      (err: unknown) => {
        logger.error({ err }, 'Rollout scheduler tick failed');
      },
    );
  }, ROLLOUT_SCHEDULER_INTERVAL_MS);

  logger.info('Rollout scheduler started (60 s interval)');
}

/**
 * Stops the background rollout scheduler, releasing the interval timer.
 * Safe to call even if the scheduler was never started.
 */
export function stopRolloutScheduler(): void {
  if (rolloutSchedulerHandle !== null) {
    clearInterval(rolloutSchedulerHandle);
    rolloutSchedulerHandle = null;
    logger.info('Rollout scheduler stopped');
  }
}
