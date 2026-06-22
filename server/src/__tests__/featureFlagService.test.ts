/**
 * Integration tests for featureFlagService. (MINCRM-463, MINCRM-488, MINCRM-489)
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
     updated_by = null,
     updated_at = now()`,
  );
  // Clear the module-level TTL cache so each test reads fresh DB state.
  __clearCacheForTest();
});

afterAll(async () => {
  await pool.query('TRUNCATE feature_flag_usage RESTART IDENTITY CASCADE');
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
