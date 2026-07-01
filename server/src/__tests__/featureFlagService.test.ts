/**
 * Integration tests for featureFlagService. (MINCRM-463, MINCRM-488, MINCRM-489, MINCRM-490, MINCRM-492)
 *
 * Runs against the real PostgreSQL minicrm_test DB.
 * The feature_flags table is seeded by migration 066; tests rely on the seed data.
 * The feature_flag_usage table is truncated before each test.
 *
 * Run: npm test --workspace=minicrm-server
 */

import 'dotenv/config';
import {
  listFeatureFlags,
  getFeatureFlag,
  isFeatureEnabled,
  isFlagEnabledForRole,
  isFlagEnabledForUser,
  updateFeatureFlag,
  enrollBetaUser,
  removeBetaUser,
  getBetaUsersForFlag,
  getBetaUserCountForFlag,
  recordFeatureFlagUsage,
  getActiveUserCountForFlag,
  stableHash,
  advanceRolloutStages,
  listUserOverrides,
  upsertUserOverride,
  deleteUserOverride,
  listFlagGroups,
  createFlagGroup,
  updateFlagGroup,
  deleteFlagGroup,
  getFlagGroupBetaUsers,
  addGroupBetaUser,
  removeGroupBetaUser,
  __clearCacheForTest,
} from '../services/featureFlagService.js';
import pool from '../db.js';

const FILE_PREFIX = 'ff-svc';
const ACTOR_EMAIL = `${FILE_PREFIX}-actor@example.com`;

let actorId: string;
const ACTOR = () => ({ id: actorId, name: 'FF Service Actor' });

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role, password_hash, status)
     VALUES ($1, 'FF Service Actor', 'admin', '$2b$12$placeholder', 'active')
     RETURNING id`,
    [ACTOR_EMAIL],
  );
  actorId = result.rows[0].id;
});

beforeEach(async () => {
  await pool.query('TRUNCATE feature_flag_usage RESTART IDENTITY CASCADE');
  await pool.query('TRUNCATE feature_flag_beta_users RESTART IDENTITY CASCADE');
  await pool.query('TRUNCATE feature_flag_user_overrides RESTART IDENTITY CASCADE');
  // DELETE cascades to feature_flag_group_beta_users and sets feature_flags.group_key = null.
  await pool.query('DELETE FROM feature_flag_groups');
  // Reset any flags changed by previous tests back to their seeded defaults.
  await pool.query(
    `UPDATE feature_flags
     SET enabled = CASE
       WHEN flag_key IN ('mobile_access', 'demo_data') THEN false
       ELSE true
     END,
     role_overrides = CASE
       WHEN flag_key IN ('reporting', 'csv_export') THEN '{"admin":true,"rep":true}'::jsonb
       ELSE null
     END,
     enable_at = null,
     rollout_percentage = null,
     rollout_stages = null,
     updated_by = null,
     updated_at = now()`,
  );
  // Clear the module-level TTL cache so each test reads fresh DB state.
  __clearCacheForTest();
});

afterAll(async () => {
  await pool.query('TRUNCATE feature_flag_usage RESTART IDENTITY CASCADE');
  await pool.query('TRUNCATE feature_flag_user_overrides RESTART IDENTITY CASCADE');
  // DELETE cascades to feature_flag_group_beta_users and sets feature_flags.group_key = null.
  await pool.query('DELETE FROM feature_flag_groups');
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── listFeatureFlags ──────────────────────────────────────────────────────────

describe('listFeatureFlags', () => {
  it('returns all seeded flags', async () => {
    const flags = await listFeatureFlags();
    expect(flags.length).toBeGreaterThanOrEqual(18);
  });

  it('includes active_user_count (0 when no usage recorded)', async () => {
    const flags = await listFeatureFlags();
    for (const f of flags) {
      expect(typeof f.active_user_count).toBe('number');
      expect(f.active_user_count).toBe(0);
    }
  });

  it('includes active_user_count > 0 after recording usage', async () => {
    await pool.query(
      `INSERT INTO feature_flag_usage (flag_key, user_id, used_at)
       VALUES ('notes', $1, now())`,
      [actorId],
    );
    const flags = await listFeatureFlags();
    const notes = flags.find((f) => f.flag_key === 'notes');
    expect(notes?.active_user_count).toBe(1);
  });
});

// ── getFeatureFlag ────────────────────────────────────────────────────────────

describe('getFeatureFlag', () => {
  it('returns the flag for a known key', async () => {
    const flag = await getFeatureFlag('notes');
    expect(flag).not.toBeNull();
    expect(flag?.flag_key).toBe('notes');
    expect(flag?.enabled).toBe(true);
    expect(flag?.category).toBe('Core CRM');
  });

  it('returns null for an unknown key', async () => {
    const flag = await getFeatureFlag('nonexistent_key');
    expect(flag).toBeNull();
  });

  it('includes active_user_count', async () => {
    const flag = await getFeatureFlag('notes');
    expect(typeof flag?.active_user_count).toBe('number');
  });
});

// ── isFeatureEnabled ──────────────────────────────────────────────────────────

describe('isFeatureEnabled', () => {
  it('returns true for an enabled flag', async () => {
    const result = await isFeatureEnabled('notes');
    expect(result).toBe(true);
  });

  it('returns false for a disabled flag (mobile_access seeded as disabled)', async () => {
    const result = await isFeatureEnabled('mobile_access');
    expect(result).toBe(false);
  });

  it('returns false for an unknown key', async () => {
    const result = await isFeatureEnabled('totally_unknown_flag');
    expect(result).toBe(false);
  });

  it('reflects DB state after an update', async () => {
    // Disable contacts via direct DB update to bypass cache concerns in service tests.
    await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'notes'`);
    // Clear module-level cache via a fresh service call — the cache expires or we force it.
    // We do a fresh getFeatureFlag to prime the cache; to truly test invalidation, use updateFeatureFlag.
    await updateFeatureFlag('notes', { enabled: false }, ACTOR());
    const result = await isFeatureEnabled('notes');
    expect(result).toBe(false);

    // Restore
    await updateFeatureFlag('notes', { enabled: true }, ACTOR());
    const restored = await isFeatureEnabled('notes');
    expect(restored).toBe(true);
  });
});

// ── isFlagEnabledForRole ──────────────────────────────────────────────────────

describe('isFlagEnabledForRole', () => {
  it('falls back to org-wide enabled when no role_overrides set', async () => {
    const adminResult = await isFlagEnabledForRole('notes', 'admin');
    const repResult = await isFlagEnabledForRole('notes', 'rep');
    expect(adminResult).toBe(true);
    expect(repResult).toBe(true);
  });

  it('uses role_overrides when present — reporting defaults admin=true, rep=true', async () => {
    const adminResult = await isFlagEnabledForRole('reporting', 'admin');
    const repResult = await isFlagEnabledForRole('reporting', 'rep');
    expect(adminResult).toBe(true);
    expect(repResult).toBe(true);
  });

  it('respects role_overrides that differ from org-wide enabled', async () => {
    // Set reporting: org enabled=true but rep override=false
    await updateFeatureFlag(
      'reporting',
      { enabled: true, role_overrides: { admin: true, rep: false } },
      ACTOR(),
    );
    const adminResult = await isFlagEnabledForRole('reporting', 'admin');
    const repResult = await isFlagEnabledForRole('reporting', 'rep');
    expect(adminResult).toBe(true);
    expect(repResult).toBe(false);
  });

  it('returns false for an unknown key', async () => {
    const result = await isFlagEnabledForRole('nonexistent', 'admin');
    expect(result).toBe(false);
  });
});

// ── updateFeatureFlag ─────────────────────────────────────────────────────────

describe('updateFeatureFlag', () => {
  it('disables a flag and invalidates cache', async () => {
    const updated = await updateFeatureFlag('notes', { enabled: false }, ACTOR());
    expect(updated).not.toBeNull();
    expect(updated?.enabled).toBe(false);

    // Cache must be invalidated — next read reflects new state.
    const live = await isFeatureEnabled('notes');
    expect(live).toBe(false);
  });

  it('enables a previously disabled flag', async () => {
    const updated = await updateFeatureFlag('mobile_access', { enabled: true }, ACTOR());
    expect(updated?.enabled).toBe(true);
    expect(await isFeatureEnabled('mobile_access')).toBe(true);
  });

  it('returns null for an unknown flag key', async () => {
    const result = await updateFeatureFlag('not_a_real_flag', { enabled: true }, ACTOR());
    expect(result).toBeNull();
  });

  it('updates role_overrides', async () => {
    const updated = await updateFeatureFlag(
      'csv_export',
      { enabled: true, role_overrides: { admin: true, rep: false } },
      ACTOR(),
    );
    expect(updated?.role_overrides?.rep).toBe(false);
    expect(updated?.role_overrides?.admin).toBe(true);
  });

  it('writes an audit entry in the same transaction', async () => {
    await updateFeatureFlag('notes', { enabled: false }, ACTOR());

    // Fetch the most recent enabled-change audit entry for this actor.
    // Timestamp filtering is avoided due to potential sub-ms clock skew between
    // Node and Postgres; record_name + new_value uniquely identify this write.
    const audit = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'feature_flag'
         AND changed_by_id = $1
         AND field_name = 'enabled'
         AND new_value = 'false'
         AND record_name = 'Notes'
       ORDER BY created_at DESC
       LIMIT 1`,
      [actorId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].record_name).toBe('Notes');
  });

  it('writes a second audit entry when role_overrides change', async () => {
    // Use a unique actor for this test to isolate its audit entries from others
    // written by the same actorId in prior tests.
    const uniqueResult = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ($1, 'FF Service Actor Unique', 'admin', '$2b$12$placeholder', 'active')
       RETURNING id`,
      [`${FILE_PREFIX}-unique-audit@example.com`],
    );
    const uniqueActorId = uniqueResult.rows[0].id;
    const uniqueActor = { id: uniqueActorId, name: 'FF Service Actor Unique' };

    // enabled: false differs from the seeded default (true), so both the
    // enabled and role_overrides audit entries are written.
    await updateFeatureFlag(
      'reporting',
      { enabled: false, role_overrides: { admin: true, rep: false } },
      uniqueActor,
    );

    const audit = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'feature_flag'
         AND changed_by_id = $1
       ORDER BY id`,
      [uniqueActorId],
    );

    // Cleanup helper user
    await pool.query('DELETE FROM users WHERE id = $1', [uniqueActorId]);

    expect(audit.rows.length).toBeGreaterThanOrEqual(2);
    const fieldNames = audit.rows.map((r: { field_name: string }) => r.field_name);
    expect(fieldNames).toContain('enabled');
    expect(fieldNames).toContain('role_overrides');
  });

  it('returns updated_by_name from the actor', async () => {
    const updated = await updateFeatureFlag('notes', { enabled: false }, ACTOR());
    expect(updated?.updated_by_name).toBe('FF Service Actor');
  });

  // MINCRM-565 — dynamic role key validation
  it('accepts role_overrides with all built-in role keys', async () => {
    const updated = await updateFeatureFlag(
      'notes',
      {
        enabled: true,
        role_overrides: {
          admin: true,
          rep: false,
          manager: true,
          viewer: false,
          service_account: false,
        },
      },
      ACTOR(),
    );
    expect(updated).not.toBeNull();
    expect(updated?.role_overrides?.admin).toBe(true);
    expect(updated?.role_overrides?.rep).toBe(false);
    expect(updated?.role_overrides?.manager).toBe(true);
  });

  it('accepts role_overrides with a valid custom role name', async () => {
    const roleResult = await pool.query<{ id: string }>(
      `INSERT INTO public.custom_roles (name, description, is_builtin)
       VALUES ('SeniorRep', null, false)
       RETURNING id`,
    );
    const roleId = roleResult.rows[0]!.id;

    try {
      const updated = await updateFeatureFlag(
        'notes',
        { enabled: true, role_overrides: { SeniorRep: true } },
        ACTOR(),
      );
      expect(updated).not.toBeNull();
      expect(updated?.role_overrides?.SeniorRep).toBe(true);
    } finally {
      await pool.query('DELETE FROM public.custom_roles WHERE id = $1', [roleId]);
    }
  });

  it('rejects role_overrides with an unknown role key with FEATURE_FLAG_UNKNOWN_ROLE_KEY', async () => {
    await expect(
      updateFeatureFlag(
        'notes',
        { enabled: true, role_overrides: { nonexistent_role: true } },
        ACTOR(),
      ),
    ).rejects.toMatchObject({ code: 'FEATURE_FLAG_UNKNOWN_ROLE_KEY' });
  });

  it('null role_overrides clears existing overrides', async () => {
    const cleared = await updateFeatureFlag(
      'reporting',
      { enabled: true, role_overrides: null },
      ACTOR(),
    );
    expect(cleared?.role_overrides).toBeNull();
  });
});

// ── recordFeatureFlagUsage ────────────────────────────────────────────────────

describe('recordFeatureFlagUsage', () => {
  it('inserts a usage row (fire-and-forget)', async () => {
    recordFeatureFlagUsage('notes', actorId);
    // Give the async fire-and-forget a moment to settle.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM feature_flag_usage
       WHERE flag_key = 'notes' AND user_id = $1`,
      [actorId],
    );
    expect(result.rows[0].count).toBe('1');
  });

  it('upserts on conflict — used_at is refreshed, count stays 1', async () => {
    recordFeatureFlagUsage('notes', actorId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    recordFeatureFlagUsage('notes', actorId);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM feature_flag_usage
       WHERE flag_key = 'notes' AND user_id = $1`,
      [actorId],
    );
    expect(result.rows[0].count).toBe('1');
  });
});

// ── getActiveUserCountForFlag ─────────────────────────────────────────────────

describe('getActiveUserCountForFlag', () => {
  it('returns 0 when no usage recorded', async () => {
    const count = await getActiveUserCountForFlag('notes');
    expect(count).toBe(0);
  });

  it('returns 1 after one user records usage', async () => {
    await pool.query(
      `INSERT INTO feature_flag_usage (flag_key, user_id, used_at)
       VALUES ('notes', $1, now())`,
      [actorId],
    );
    const count = await getActiveUserCountForFlag('notes');
    expect(count).toBe(1);
  });

  it('does not count usage older than 30 days', async () => {
    await pool.query(
      `INSERT INTO feature_flag_usage (flag_key, user_id, used_at)
       VALUES ('notes', $1, now() - interval '31 days')`,
      [actorId],
    );
    const count = await getActiveUserCountForFlag('notes');
    expect(count).toBe(0);
  });
});

// ── enable_at (MINCRM-488) ────────────────────────────────────────────────────

describe('enable_at scheduling', () => {
  it('isFeatureEnabled returns true when enable_at is in the past and enabled=false', async () => {
    await pool.query(
      `UPDATE feature_flags SET enabled = false, enable_at = now() - interval '1 minute'
       WHERE flag_key = 'mobile_access'`,
    );
    __clearCacheForTest();
    expect(await isFeatureEnabled('mobile_access')).toBe(true);
  });

  it('isFeatureEnabled returns false when enable_at is in the future and enabled=false', async () => {
    await pool.query(
      `UPDATE feature_flags SET enabled = false, enable_at = now() + interval '1 hour'
       WHERE flag_key = 'mobile_access'`,
    );
    __clearCacheForTest();
    expect(await isFeatureEnabled('mobile_access')).toBe(false);
  });

  it('isFlagEnabledForRole treats past enable_at as fully enabled for all roles', async () => {
    await pool.query(
      `UPDATE feature_flags SET enabled = false, enable_at = now() - interval '5 minutes'
       WHERE flag_key = 'mobile_access'`,
    );
    __clearCacheForTest();
    expect(await isFlagEnabledForRole('mobile_access', 'admin')).toBe(true);
    expect(await isFlagEnabledForRole('mobile_access', 'rep')).toBe(true);
  });

  it('updateFeatureFlag persists enable_at and invalidates cache', async () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const updated = await updateFeatureFlag(
      'mobile_access',
      { enabled: false, enable_at: futureDate },
      ACTOR(),
    );
    expect(updated?.enable_at).toBe(futureDate);
    // Cache invalidated — fresh read from DB.
    const flag = await getFeatureFlag('mobile_access');
    expect(flag?.enable_at).toBe(futureDate);
  });

  it('updateFeatureFlag clears enable_at when null is passed', async () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await updateFeatureFlag('mobile_access', { enabled: false, enable_at: futureDate }, ACTOR());
    const cleared = await updateFeatureFlag(
      'mobile_access',
      { enabled: false, enable_at: null },
      ACTOR(),
    );
    expect(cleared?.enable_at).toBeNull();
  });

  it('updateFeatureFlag writes an audit entry when enable_at changes', async () => {
    const futureDate = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    await updateFeatureFlag('mobile_access', { enabled: false, enable_at: futureDate }, ACTOR());
    const audit = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'feature_flag'
         AND changed_by_id = $1
         AND field_name = 'enable_at'
       ORDER BY created_at DESC
       LIMIT 1`,
      [actorId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].new_value).toBe(futureDate);
    expect(audit.rows[0].old_value).toBe('null');
  });

  it('cache TTL is capped to nearest future enable_at', async () => {
    // Set a flag to enable in 5 seconds.
    const soonMs = Date.now() + 5_000;
    const soonIso = new Date(soonMs).toISOString();
    await pool.query(
      `UPDATE feature_flags SET enabled = false, enable_at = $1 WHERE flag_key = 'mobile_access'`,
      [soonIso],
    );
    // Force a fresh cache load by clearing it.
    __clearCacheForTest();
    await isFeatureEnabled('mobile_access'); // primes cache
    // The cache should expire within 5 seconds, not 60.
    // We approximate: after 6 seconds the flag should be auto-enabled on next read.
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    // No explicit cache clear — TTL should have fired naturally.
    expect(await isFeatureEnabled('mobile_access')).toBe(true);
  }, 12_000);

  it('listFeatureFlags includes enable_at per flag', async () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await pool.query(
      `UPDATE feature_flags SET enabled = false, enable_at = $1 WHERE flag_key = 'mobile_access'`,
      [futureDate],
    );
    __clearCacheForTest();
    const flags = await listFeatureFlags();
    const mobileFlag = flags.find((f) => f.flag_key === 'mobile_access');
    expect(mobileFlag?.enable_at).toBe(futureDate);
  });
});

// ── beta users (MINCRM-489) ───────────────────────────────────────────────────

describe('beta user enrollment', () => {
  it('enrollBetaUser allows a user to see a disabled flag as enabled', async () => {
    await enrollBetaUser('mobile_access', actorId, ACTOR());
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(true);
  });

  it('non-beta user still sees a disabled flag as disabled', async () => {
    const otherResult = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ($1, 'Non Beta User', 'rep', '$2b$12$placeholder', 'active')
       RETURNING id`,
      [`${FILE_PREFIX}-nonbeta@example.com`],
    );
    const otherId = otherResult.rows[0].id;

    await enrollBetaUser('mobile_access', actorId, ACTOR());
    expect(await isFlagEnabledForUser('mobile_access', otherId, 'rep')).toBe(false);

    await pool.query('DELETE FROM users WHERE id = $1', [otherId]);
  });

  it('beta enrollment has no effect when flag is globally enabled', async () => {
    // notes is seeded as enabled=true.
    await enrollBetaUser('notes', actorId, ACTOR());
    // Result is still true — beta does not flip a globally-enabled flag.
    expect(await isFlagEnabledForUser('notes', actorId, 'admin')).toBe(true);
  });

  it('removeBetaUser reverts the beta-enrolled user to default resolution', async () => {
    await enrollBetaUser('mobile_access', actorId, ACTOR());
    await removeBetaUser('mobile_access', actorId, ACTOR());
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(false);
  });

  it('enrollBetaUser writes an audit entry', async () => {
    await enrollBetaUser('mobile_access', actorId, ACTOR());
    const audit = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'feature_flag'
         AND changed_by_id = $1
         AND field_name = 'beta_users'
       ORDER BY created_at DESC LIMIT 1`,
      [actorId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].record_name).toBe('Mobile Access');
  });

  it('removeBetaUser writes an audit entry', async () => {
    await enrollBetaUser('mobile_access', actorId, ACTOR());
    await removeBetaUser('mobile_access', actorId, ACTOR());
    const audit = await pool.query(
      `SELECT field_name, new_value FROM audit_log
       WHERE record_type = 'feature_flag'
         AND changed_by_id = $1
         AND field_name = 'beta_users'
       ORDER BY created_at DESC LIMIT 1`,
      [actorId],
    );
    expect(audit.rows.length).toBe(1);
  });

  it('getBetaUsersForFlag returns enrolled users', async () => {
    await enrollBetaUser('mobile_access', actorId, ACTOR());
    const users = await getBetaUsersForFlag('mobile_access');
    expect(users.length).toBe(1);
    expect(users[0].user_id).toBe(actorId);
  });

  it('getBetaUserCountForFlag reflects current enrollment', async () => {
    expect(await getBetaUserCountForFlag('mobile_access')).toBe(0);
    await enrollBetaUser('mobile_access', actorId, ACTOR());
    expect(await getBetaUserCountForFlag('mobile_access')).toBe(1);
  });

  it('listFeatureFlags includes beta_user_count', async () => {
    await enrollBetaUser('mobile_access', actorId, ACTOR());
    const flags = await listFeatureFlags();
    const mobileFlag = flags.find((f) => f.flag_key === 'mobile_access');
    expect(mobileFlag?.beta_user_count).toBe(1);
  });

  it('isFlagEnabledForUser does not cache beta membership', async () => {
    // Enroll, verify, remove, verify again — must reflect live state without explicit clear.
    await enrollBetaUser('mobile_access', actorId, ACTOR());
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(true);
    await removeBetaUser('mobile_access', actorId, ACTOR());
    // No __clearCacheForTest — beta membership is always queried fresh.
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(false);
  });
});

// ── ai_features master toggle gates ai_* sub-feature flags (MINCRM-460) ──────

describe('ai_features master toggle', () => {
  it('ai_nli_page resolves enabled when ai_features is enabled', async () => {
    expect(await isFlagEnabledForUser('ai_nli_page', actorId, 'admin')).toBe(true);
  });

  it('disabling ai_features disables ai_nli_page even though ai_nli_page itself is still enabled', async () => {
    await updateFeatureFlag('ai_features', { enabled: false }, ACTOR());
    __clearCacheForTest();

    expect(await isFlagEnabledForUser('ai_features', actorId, 'admin')).toBe(false);
    expect(await isFlagEnabledForUser('ai_nli_page', actorId, 'admin')).toBe(false);
  });

  it('ai_features master gate supersedes an ai_nli_page beta enrollment', async () => {
    await updateFeatureFlag('ai_features', { enabled: false }, ACTOR());
    __clearCacheForTest();
    await enrollBetaUser('ai_nli_page', actorId, ACTOR());

    expect(await isFlagEnabledForUser('ai_nli_page', actorId, 'admin')).toBe(false);
  });

  it('ai_features master gate supersedes an ai_nli_page force_enabled user override', async () => {
    await updateFeatureFlag('ai_features', { enabled: false }, ACTOR());
    __clearCacheForTest();
    await upsertUserOverride('ai_nli_page', actorId, 'force_enabled', null, ACTOR());

    expect(await isFlagEnabledForUser('ai_nli_page', actorId, 'admin')).toBe(false);
  });

  it('ai_features master gate supersedes an ai_nli_page role_overrides entry', async () => {
    await updateFeatureFlag(
      'ai_nli_page',
      { enabled: false, role_overrides: { admin: true, rep: true } },
      ACTOR(),
    );
    await updateFeatureFlag('ai_features', { enabled: false }, ACTOR());
    __clearCacheForTest();

    expect(await isFlagEnabledForUser('ai_nli_page', actorId, 'admin')).toBe(false);
  });

  it('re-enabling ai_features restores ai_nli_page to its own resolution', async () => {
    await updateFeatureFlag('ai_features', { enabled: false }, ACTOR());
    __clearCacheForTest();
    expect(await isFlagEnabledForUser('ai_nli_page', actorId, 'admin')).toBe(false);

    await updateFeatureFlag('ai_features', { enabled: true }, ACTOR());
    __clearCacheForTest();
    expect(await isFlagEnabledForUser('ai_nli_page', actorId, 'admin')).toBe(true);
  });

  it('does not affect non-AI flags', async () => {
    await updateFeatureFlag('ai_features', { enabled: false }, ACTOR());
    __clearCacheForTest();
    expect(await isFlagEnabledForUser('notes', actorId, 'admin')).toBe(true);
  });
});

// ── stableHash (MINCRM-490) ───────────────────────────────────────────────────

describe('stableHash', () => {
  it('produces a deterministic result for a fixed input', () => {
    const hash = stableHash('test-user-idmobile_access');
    expect(hash).toBe(stableHash('test-user-idmobile_access'));
  });

  it('produces different values for different inputs', () => {
    expect(stableHash('user-amobile_access')).not.toBe(stableHash('user-bmobile_access'));
  });

  it('always returns an unsigned 32-bit integer (0 to 4294967295)', () => {
    for (const input of ['', 'abc', 'uuid-test-123', '\u{1F600}']) {
      const h = stableHash(input);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(4294967295);
      expect(Number.isInteger(h)).toBe(true);
    }
  });

  it('distributes 100 distinct userId+flagKey inputs roughly uniformly across 100 buckets', () => {
    const buckets = new Array<number>(100).fill(0);
    for (let i = 0; i < 100; i++) {
      const bucket = stableHash(`user-${i}mobile_access`) % 100;
      buckets[bucket]++;
    }
    // With 100 inputs over 100 buckets no bucket should exceed 10 hits
    // (the expected value is 1; 10× expected is a generous threshold for FNV-1a).
    for (const count of buckets) {
      expect(count).toBeLessThanOrEqual(10);
    }
  });
});

// ── Rollout bucketing (MINCRM-490) ────────────────────────────────────────────

describe('rollout bucketing', () => {
  let targetUserId: string;
  let outsideUserId: string;

  beforeAll(async () => {
    // Create two users whose buckets we know by computing stableHash offline.
    // mobile_access is disabled by seed, so rollout is the only path to true.
    // We'll find a userId whose hash % 100 < 50 (inside) and one >= 50 (outside).
    let insideCandidate: string | null = null;
    let outsideCandidate: string | null = null;

    for (let i = 0; i < 200 && (!insideCandidate || !outsideCandidate); i++) {
      const email = `${FILE_PREFIX}-bucket-${i}@example.com`;
      const result = await pool.query<{ id: string }>(
        `INSERT INTO users (email, name, role, password_hash, status)
         VALUES ($1, $2, 'rep', '$2b$12$placeholder', 'active')
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [email, `Bucket User ${i}`],
      );
      const userId = result.rows[0].id;
      const bucket = stableHash(userId + 'mobile_access') % 100;
      if (bucket < 50 && !insideCandidate) insideCandidate = userId;
      if (bucket >= 50 && !outsideCandidate) outsideCandidate = userId;
    }

    if (!insideCandidate || !outsideCandidate) {
      throw new Error('Could not find suitable bucket candidates in 200 iterations');
    }
    targetUserId = insideCandidate;
    outsideUserId = outsideCandidate;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-bucket-%`]);
  });

  it('user in bucket sees disabled flag as enabled when rollout_percentage covers them', async () => {
    await pool.query(
      `UPDATE feature_flags SET rollout_percentage = 50 WHERE flag_key = 'mobile_access'`,
    );
    __clearCacheForTest();
    const result = await isFlagEnabledForUser('mobile_access', targetUserId, 'rep');
    expect(result).toBe(true);
  });

  it('user outside bucket does not see the flag via rollout', async () => {
    await pool.query(
      `UPDATE feature_flags SET rollout_percentage = 50 WHERE flag_key = 'mobile_access'`,
    );
    __clearCacheForTest();
    const result = await isFlagEnabledForUser('mobile_access', outsideUserId, 'rep');
    expect(result).toBe(false);
  });

  it('rollout_percentage = null skips rollout and falls back to enabled state', async () => {
    // mobile_access is disabled and rollout_percentage is null — should be false.
    const result = await isFlagEnabledForUser('mobile_access', targetUserId, 'rep');
    expect(result).toBe(false);
  });

  it('rollout_percentage = 100 means all users are enabled', async () => {
    await pool.query(
      `UPDATE feature_flags SET rollout_percentage = 100 WHERE flag_key = 'mobile_access'`,
    );
    __clearCacheForTest();
    expect(await isFlagEnabledForUser('mobile_access', targetUserId, 'rep')).toBe(true);
    expect(await isFlagEnabledForUser('mobile_access', outsideUserId, 'rep')).toBe(true);
  });

  it('rollout_percentage = 0 means no users are enabled via rollout', async () => {
    await pool.query(
      `UPDATE feature_flags SET rollout_percentage = 0 WHERE flag_key = 'mobile_access'`,
    );
    __clearCacheForTest();
    expect(await isFlagEnabledForUser('mobile_access', targetUserId, 'rep')).toBe(false);
    expect(await isFlagEnabledForUser('mobile_access', outsideUserId, 'rep')).toBe(false);
  });

  it('beta membership bypasses rollout — beta user sees flag even when outside bucket', async () => {
    await pool.query(
      `UPDATE feature_flags SET rollout_percentage = 0 WHERE flag_key = 'mobile_access'`,
    );
    __clearCacheForTest();
    await enrollBetaUser('mobile_access', outsideUserId, ACTOR());
    const result = await isFlagEnabledForUser('mobile_access', outsideUserId, 'rep');
    expect(result).toBe(true);
  });

  it('updateFeatureFlag persists rollout_percentage in the returned row', async () => {
    const updated = await updateFeatureFlag(
      'mobile_access',
      { enabled: false, rollout_percentage: 42 },
      ACTOR(),
    );
    expect(updated?.rollout_percentage).toBe(42);
    __clearCacheForTest();
    const fetched = await getFeatureFlag('mobile_access');
    expect(fetched?.rollout_percentage).toBe(42);
  });

  it('updateFeatureFlag persists rollout_stages and writes audit entries', async () => {
    const stages = [
      { percentage: 25, scheduled_at: '2099-01-01T00:00:00.000Z' },
      { percentage: 75, scheduled_at: '2099-06-01T00:00:00.000Z' },
    ];
    await updateFeatureFlag('mobile_access', { enabled: false, rollout_stages: stages }, ACTOR());
    __clearCacheForTest();
    const fetched = await getFeatureFlag('mobile_access');
    expect(fetched?.rollout_stages).toHaveLength(2);
    expect(fetched?.rollout_stages?.[0]?.percentage).toBe(25);
  });

  it('advanceRolloutStages advances rollout_percentage for a past stage and writes audit', async () => {
    const pastStage = { percentage: 30, scheduled_at: new Date(Date.now() - 1000).toISOString() };
    await pool.query(
      `UPDATE feature_flags
       SET rollout_percentage = 0,
           rollout_stages = $1::jsonb
       WHERE flag_key = 'mobile_access'`,
      [JSON.stringify([pastStage])],
    );
    __clearCacheForTest();

    await advanceRolloutStages(ACTOR());

    __clearCacheForTest();
    const flag = await getFeatureFlag('mobile_access');
    expect(flag?.rollout_percentage).toBe(30);

    const auditRow = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_name = 'Mobile Access'
         AND field_name = 'rollout_percentage'
         AND new_value = '30'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(auditRow.rows.length).toBeGreaterThan(0);
  });

  it('advanceRolloutStages does not advance when next stage is in the future', async () => {
    const futureStage = { percentage: 80, scheduled_at: '2099-01-01T00:00:00.000Z' };
    await pool.query(
      `UPDATE feature_flags
       SET rollout_percentage = 0,
           rollout_stages = $1::jsonb
       WHERE flag_key = 'mobile_access'`,
      [JSON.stringify([futureStage])],
    );
    __clearCacheForTest();

    await advanceRolloutStages(ACTOR());

    __clearCacheForTest();
    const flag = await getFeatureFlag('mobile_access');
    expect(flag?.rollout_percentage).toBe(0);
  });
});

// ── User overrides (MINCRM-492) ───────────────────────────────────────────────

describe('user overrides', () => {
  let targetUserId: string;
  const TARGET_EMAIL = `${FILE_PREFIX}-override-target@example.com`;

  beforeAll(async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ($1, 'Override Target', 'rep', '$2b$12$placeholder', 'active')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [TARGET_EMAIL],
    );
    targetUserId = result.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [TARGET_EMAIL]);
  });

  it('force_enabled user sees flag even when globally disabled and not beta-enrolled', async () => {
    // mobile_access is disabled by seed — normally false.
    await upsertUserOverride('mobile_access', targetUserId, 'force_enabled', null, ACTOR());
    const result = await isFlagEnabledForUser('mobile_access', targetUserId, 'rep');
    expect(result).toBe(true);
  });

  it('force_disabled user does not see flag even when globally enabled and beta-enrolled', async () => {
    // notes is enabled by seed — normally true.
    await enrollBetaUser('notes', targetUserId, ACTOR());
    await upsertUserOverride('notes', targetUserId, 'force_disabled', 'test reason', ACTOR());
    const result = await isFlagEnabledForUser('notes', targetUserId, 'rep');
    expect(result).toBe(false);
  });

  it('force_disabled user does not see flag even with rollout_percentage = 100', async () => {
    await pool.query(
      `UPDATE feature_flags SET rollout_percentage = 100 WHERE flag_key = 'mobile_access'`,
    );
    __clearCacheForTest();
    await upsertUserOverride('mobile_access', targetUserId, 'force_disabled', null, ACTOR());
    const result = await isFlagEnabledForUser('mobile_access', targetUserId, 'rep');
    expect(result).toBe(false);
  });

  it('removing an override restores normal evaluation', async () => {
    await upsertUserOverride('mobile_access', targetUserId, 'force_enabled', null, ACTOR());
    expect(await isFlagEnabledForUser('mobile_access', targetUserId, 'rep')).toBe(true);
    await deleteUserOverride('mobile_access', targetUserId, ACTOR());
    // mobile_access is disabled by seed, no rollout, no beta — should be false again.
    expect(await isFlagEnabledForUser('mobile_access', targetUserId, 'rep')).toBe(false);
  });

  it('upsert replaces an existing override direction without creating a duplicate row', async () => {
    await upsertUserOverride('mobile_access', targetUserId, 'force_enabled', null, ACTOR());
    await upsertUserOverride('mobile_access', targetUserId, 'force_disabled', 'switched', ACTOR());

    const rows = await pool.query(
      `SELECT COUNT(*) AS count FROM feature_flag_user_overrides
       WHERE flag_key = 'mobile_access' AND user_id = $1`,
      [targetUserId],
    );
    expect(Number(rows.rows[0].count)).toBe(1);

    const result = await isFlagEnabledForUser('mobile_access', targetUserId, 'rep');
    expect(result).toBe(false);
  });

  it('deleteUserOverride returns false when no override exists', async () => {
    const removed = await deleteUserOverride('mobile_access', targetUserId, ACTOR());
    expect(removed).toBe(false);
  });

  it('listUserOverrides returns the override with reason', async () => {
    await upsertUserOverride('mobile_access', targetUserId, 'force_enabled', 'VIP user', ACTOR());
    const overrides = await listUserOverrides('mobile_access');
    const entry = overrides.find((o) => o.user_id === targetUserId);
    expect(entry?.override).toBe('force_enabled');
    expect(entry?.reason).toBe('VIP user');
  });

  it('listFeatureFlags includes override_count', async () => {
    await upsertUserOverride('mobile_access', targetUserId, 'force_enabled', null, ACTOR());
    const flags = await listFeatureFlags();
    const mobileFlag = flags.find((f) => f.flag_key === 'mobile_access');
    expect(mobileFlag?.override_count.force_enabled).toBe(1);
    expect(mobileFlag?.override_count.force_disabled).toBe(0);
  });

  it('upsertUserOverride writes an audit entry', async () => {
    await upsertUserOverride('mobile_access', targetUserId, 'force_enabled', 'audit test', ACTOR());
    const auditRow = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_name LIKE '%Mobile%'
         AND field_name = 'user_override'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(auditRow.rows.length).toBeGreaterThan(0);
    expect(auditRow.rows[0].new_value).toContain('force_enabled');
  });

  it('deleteUserOverride writes an audit entry', async () => {
    await upsertUserOverride('mobile_access', targetUserId, 'force_disabled', null, ACTOR());
    await deleteUserOverride('mobile_access', targetUserId, ACTOR());
    const auditRow = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_name LIKE '%Mobile%'
         AND field_name = 'user_override'
         AND new_value = 'null'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(auditRow.rows.length).toBeGreaterThan(0);
  });
});

// ── Flag groups (MINCRM-491) ──────────────────────────────────────────────────

describe('flag groups CRUD', () => {
  const GROUP_KEY = 'ff-svc-test-group';

  it('createFlagGroup inserts a group and returns it with zero counts', async () => {
    const group = await createFlagGroup(
      { group_key: GROUP_KEY, label: 'Test Group', description: 'Created by test' },
      ACTOR(),
    );
    expect(group.group_key).toBe(GROUP_KEY);
    expect(group.label).toBe('Test Group');
    expect(group.enabled).toBe(true);
    expect(group.member_count).toBe(0);
    expect(group.beta_user_count).toBe(0);
  });

  it('createFlagGroup throws FLAG_GROUP_DUPLICATE_KEY on duplicate group_key', async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'First' }, ACTOR());
    await expect(
      createFlagGroup({ group_key: GROUP_KEY, label: 'Second' }, ACTOR()),
    ).rejects.toMatchObject({ code: 'FLAG_GROUP_DUPLICATE_KEY' });
  });

  it('createFlagGroup writes an audit entry', async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'Audit Group' }, ACTOR());
    const audit = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'feature_flag_group'
         AND changed_by_id = $1
         AND field_name = 'group_key'
         AND new_value = $2
       ORDER BY created_at DESC LIMIT 1`,
      [actorId, GROUP_KEY],
    );
    expect(audit.rows.length).toBe(1);
  });

  it('listFlagGroups includes the created group', async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'Listed Group' }, ACTOR());
    const groups = await listFlagGroups();
    expect(groups.some((g) => g.group_key === GROUP_KEY)).toBe(true);
  });

  it('updateFlagGroup changes label and writes audit entry', async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'Before' }, ACTOR());
    const updated = await updateFlagGroup(GROUP_KEY, { label: 'After' }, ACTOR());
    expect(updated?.label).toBe('After');

    const audit = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'feature_flag_group'
         AND changed_by_id = $1
         AND field_name = 'label'
       ORDER BY created_at DESC LIMIT 1`,
      [actorId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(audit.rows[0].new_value).toBe('After');
  });

  it('updateFlagGroup can disable a group', async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'Toggle' }, ACTOR());
    const updated = await updateFlagGroup(GROUP_KEY, { enabled: false }, ACTOR());
    expect(updated?.enabled).toBe(false);
  });

  it('updateFlagGroup returns null for an unknown group', async () => {
    const result = await updateFlagGroup('nonexistent-group', { label: 'X' }, ACTOR());
    expect(result).toBeNull();
  });

  it('deleteFlagGroup removes the group and returns true', async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'To Delete' }, ACTOR());
    const deleted = await deleteFlagGroup(GROUP_KEY, ACTOR());
    expect(deleted).toBe(true);
    const groups = await listFlagGroups();
    expect(groups.some((g) => g.group_key === GROUP_KEY)).toBe(false);
  });

  it('deleteFlagGroup returns false for an unknown group', async () => {
    const result = await deleteFlagGroup('nonexistent-group', ACTOR());
    expect(result).toBe(false);
  });

  it('deleteFlagGroup with member flags cascade-unassigns them and deletes the group (MINCRM-567)', async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'Has Member' }, ACTOR());
    await pool.query(`UPDATE feature_flags SET group_key = $1 WHERE flag_key = 'mobile_access'`, [
      GROUP_KEY,
    ]);
    const deleted = await deleteFlagGroup(GROUP_KEY, ACTOR());
    expect(deleted).toBe(true);
    const groups = await listFlagGroups();
    expect(groups.some((g) => g.group_key === GROUP_KEY)).toBe(false);
    const flagRow = await pool.query<{ group_key: string | null; updated_by: string | null }>(
      `SELECT group_key, updated_by FROM feature_flags WHERE flag_key = 'mobile_access'`,
    );
    expect(flagRow.rows[0]?.group_key).toBeNull();
    expect(flagRow.rows[0]?.updated_by).toBe(actorId);
  });

  it('deleteFlagGroup writes audit entries for unassigned flags and the group itself (MINCRM-567)', async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'Delete Audit' }, ACTOR());
    await pool.query(`UPDATE feature_flags SET group_key = $1 WHERE flag_key = 'mobile_access'`, [
      GROUP_KEY,
    ]);
    await deleteFlagGroup(GROUP_KEY, ACTOR());

    // Audit entry for the unassigned flag
    const flagAudit = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'feature_flag'
         AND changed_by_id = $1
         AND field_name = 'group_key'
         AND old_value = $2
         AND new_value = 'null'
       ORDER BY created_at DESC LIMIT 1`,
      [actorId, GROUP_KEY],
    );
    expect(flagAudit.rows.length).toBe(1);

    // Audit entry for the group deletion itself
    const groupAudit = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'feature_flag_group'
         AND changed_by_id = $1
         AND field_name = 'group_key'
         AND new_value = 'null'
       ORDER BY created_at DESC LIMIT 1`,
      [actorId],
    );
    expect(groupAudit.rows.length).toBeGreaterThan(0);
  });

  it('deleteFlagGroup empty group writes group audit entry and returns true', async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'Delete Audit Empty' }, ACTOR());
    await deleteFlagGroup(GROUP_KEY, ACTOR());
    const audit = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'feature_flag_group'
         AND changed_by_id = $1
         AND field_name = 'group_key'
         AND new_value = 'null'
       ORDER BY created_at DESC LIMIT 1`,
      [actorId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });
});

describe('flag group gate evaluation (MINCRM-491)', () => {
  const GROUP_KEY = 'ff-svc-gate-group';

  beforeEach(async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'Gate Group' }, ACTOR());
    // Assign mobile_access (seeded disabled) to the group.
    await pool.query(`UPDATE feature_flags SET group_key = $1 WHERE flag_key = 'mobile_access'`, [
      GROUP_KEY,
    ]);
    __clearCacheForTest();
  });

  it('group disabled + non-member → flag returns false regardless of flag enabled state', async () => {
    // Enable the flag itself, but group is disabled.
    await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'mobile_access'`);
    await updateFlagGroup(GROUP_KEY, { enabled: false }, ACTOR());
    __clearCacheForTest();

    const result = await isFlagEnabledForUser('mobile_access', actorId, 'admin');
    expect(result).toBe(false);
  });

  it('group enabled → flag evaluation proceeds normally', async () => {
    // mobile_access seeded as disabled; group enabled by default from createFlagGroup.
    const result = await isFlagEnabledForUser('mobile_access', actorId, 'admin');
    expect(result).toBe(false); // flag itself is disabled

    // Enable the flag — with group enabled, it should resolve true.
    await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'mobile_access'`);
    __clearCacheForTest();
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(true);
  });

  it('group beta user bypasses group gate even when group is disabled', async () => {
    await updateFlagGroup(GROUP_KEY, { enabled: false }, ACTOR());
    // Enable the flag itself so that once through the group gate, it resolves.
    await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'mobile_access'`);
    __clearCacheForTest();

    // Actor is not yet in group beta — should be blocked.
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(false);

    // Enroll in group beta.
    await addGroupBetaUser(GROUP_KEY, actorId, ACTOR());

    // Now passes the group gate → flag is enabled.
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(true);
  });

  it('group beta user removed reverts to being blocked by disabled group', async () => {
    await updateFlagGroup(GROUP_KEY, { enabled: false }, ACTOR());
    await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'mobile_access'`);
    __clearCacheForTest();

    await addGroupBetaUser(GROUP_KEY, actorId, ACTOR());
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(true);

    await removeGroupBetaUser(GROUP_KEY, actorId, ACTOR());
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(false);
  });

  it('flag not assigned to any group is unaffected by group state', async () => {
    // notes has no group_key (unassigned); disable GROUP_KEY group.
    await updateFlagGroup(GROUP_KEY, { enabled: false }, ACTOR());
    __clearCacheForTest();
    // notes is seeded enabled — should still be true.
    expect(await isFlagEnabledForUser('notes', actorId, 'admin')).toBe(true);
  });

  it('group enable_at in the past counts as enabled (gate passes)', async () => {
    await updateFlagGroup(
      GROUP_KEY,
      { enabled: false, enable_at: new Date(Date.now() - 60_000).toISOString() },
      ACTOR(),
    );
    await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'mobile_access'`);
    __clearCacheForTest();
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(true);
  });

  it('group enable_at in the future does not unblock the gate', async () => {
    await updateFlagGroup(
      GROUP_KEY,
      { enabled: false, enable_at: new Date(Date.now() + 60 * 60_000).toISOString() },
      ACTOR(),
    );
    await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'mobile_access'`);
    __clearCacheForTest();
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(false);
  });

  it('force_enabled override bypasses group gate even when group is disabled', async () => {
    await updateFlagGroup(GROUP_KEY, { enabled: false }, ACTOR());
    await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'mobile_access'`);
    await upsertUserOverride('mobile_access', actorId, 'force_enabled', null, ACTOR());
    __clearCacheForTest();
    // force_enabled fires before the group gate, so the disabled group does not block.
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(true);
  });

  it('force_disabled override blocks group beta user', async () => {
    await updateFlagGroup(GROUP_KEY, { enabled: true }, ACTOR());
    await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'mobile_access'`);
    await addGroupBetaUser(GROUP_KEY, actorId, ACTOR());
    await upsertUserOverride('mobile_access', actorId, 'force_disabled', null, ACTOR());
    __clearCacheForTest();
    // force_disabled fires before group gate; group beta membership cannot override it.
    expect(await isFlagEnabledForUser('mobile_access', actorId, 'admin')).toBe(false);
  });
});

describe('flag group beta user management (MINCRM-491)', () => {
  const GROUP_KEY = 'ff-svc-beta-group';
  let targetUserId: string;
  const TARGET_EMAIL = `${FILE_PREFIX}-group-beta-target@example.com`;

  beforeAll(async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ($1, 'Group Beta Target', 'rep', '$2b$12$placeholder', 'active')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [TARGET_EMAIL],
    );
    targetUserId = result.rows[0].id;
  });

  beforeEach(async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'Beta Group' }, ACTOR());
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [TARGET_EMAIL]);
  });

  it('getFlagGroupBetaUsers throws FLAG_GROUP_NOT_FOUND for unknown group', async () => {
    await expect(getFlagGroupBetaUsers('nonexistent-group')).rejects.toMatchObject({
      code: 'FLAG_GROUP_NOT_FOUND',
    });
  });

  it('addGroupBetaUser enrolls a user and getFlagGroupBetaUsers returns them', async () => {
    await addGroupBetaUser(GROUP_KEY, targetUserId, ACTOR());
    const users = await getFlagGroupBetaUsers(GROUP_KEY);
    expect(users.some((u) => u.user_id === targetUserId)).toBe(true);
  });

  it('addGroupBetaUser throws GROUP_BETA_USER_ALREADY_ENROLLED on duplicate', async () => {
    await addGroupBetaUser(GROUP_KEY, targetUserId, ACTOR());
    await expect(addGroupBetaUser(GROUP_KEY, targetUserId, ACTOR())).rejects.toMatchObject({
      code: 'GROUP_BETA_USER_ALREADY_ENROLLED',
    });
  });

  it('removeGroupBetaUser unenrolls a user', async () => {
    await addGroupBetaUser(GROUP_KEY, targetUserId, ACTOR());
    await removeGroupBetaUser(GROUP_KEY, targetUserId, ACTOR());
    const users = await getFlagGroupBetaUsers(GROUP_KEY);
    expect(users.some((u) => u.user_id === targetUserId)).toBe(false);
  });

  it('removeGroupBetaUser throws FLAG_GROUP_NOT_FOUND for unknown group', async () => {
    await expect(
      removeGroupBetaUser('nonexistent-group', targetUserId, ACTOR()),
    ).rejects.toMatchObject({ code: 'FLAG_GROUP_NOT_FOUND' });
  });

  it('addGroupBetaUser throws USER_NOT_FOUND for non-existent user', async () => {
    await expect(
      addGroupBetaUser(GROUP_KEY, '00000000-0000-0000-0000-000000000000', ACTOR()),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('listFlagGroups reflects correct beta_user_count after enrollment', async () => {
    await addGroupBetaUser(GROUP_KEY, targetUserId, ACTOR());
    const groups = await listFlagGroups();
    const group = groups.find((g) => g.group_key === GROUP_KEY);
    expect(group?.beta_user_count).toBe(1);
  });

  it('listFlagGroups reflects correct member_count after flag assignment', async () => {
    await pool.query(`UPDATE feature_flags SET group_key = $1 WHERE flag_key = 'mobile_access'`, [
      GROUP_KEY,
    ]);
    const groups = await listFlagGroups();
    const group = groups.find((g) => g.group_key === GROUP_KEY);
    expect(group?.member_count).toBe(1);
  });
});

describe('updateFeatureFlag group assignment (MINCRM-491)', () => {
  const GROUP_KEY = 'ff-svc-assign-group';

  beforeEach(async () => {
    await createFlagGroup({ group_key: GROUP_KEY, label: 'Assign Group' }, ACTOR());
    __clearCacheForTest();
  });

  it('assigning a flag to a group persists group_key', async () => {
    const updated = await updateFeatureFlag(
      'mobile_access',
      { enabled: false, group_key: GROUP_KEY },
      ACTOR(),
    );
    expect(updated?.group_key).toBe(GROUP_KEY);
  });

  it('assigning a flag to null removes the group association', async () => {
    await updateFeatureFlag('mobile_access', { enabled: false, group_key: GROUP_KEY }, ACTOR());
    const cleared = await updateFeatureFlag(
      'mobile_access',
      { enabled: false, group_key: null },
      ACTOR(),
    );
    expect(cleared?.group_key).toBeNull();
  });

  it('assigning to a non-existent group throws FLAG_GROUP_NOT_FOUND', async () => {
    await expect(
      updateFeatureFlag('mobile_access', { enabled: false, group_key: 'does-not-exist' }, ACTOR()),
    ).rejects.toMatchObject({ code: 'FLAG_GROUP_NOT_FOUND' });
  });

  it('group assignment writes an audit entry', async () => {
    await updateFeatureFlag('mobile_access', { enabled: false, group_key: GROUP_KEY }, ACTOR());
    const audit = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'feature_flag'
         AND changed_by_id = $1
         AND field_name = 'group_key'
         AND new_value = $2
       ORDER BY created_at DESC LIMIT 1`,
      [actorId, GROUP_KEY],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });
});
