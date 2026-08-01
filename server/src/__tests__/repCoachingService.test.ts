/**
 * Integration tests for repCoachingService. (MINCRM-474)
 * Runs against a real PostgreSQL test database — scoring is deterministic/SQL-driven,
 * no Anthropic SDK mock needed (this feature makes no AI provider calls at all).
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import pool from '../db.js';
import { randomUUID } from 'node:crypto';
import { countAuditRowsFor, expectActorScopingIsolatesForeignRows } from './testUtils.js';
import { createUser } from '../services/userService.js';
import { createAccount } from '../services/accountService.js';
import { createDeal, updateDeal } from '../services/dealService.js';
import { createTeam, addTeamMember } from '../services/teamService.js';
import {
  generateRepCoachingInsights,
  getRepCoachingInsights,
  getCoachingTeamOverview,
  getRepIdsVisibleToManager,
  getRepCoachingConfig,
  setRepCoachingConfig,
} from '../services/repCoachingService.js';

const FILE_PREFIX = 'rep-coaching-svc';
const ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

/**
 * The record_name setRepCoachingConfig writes its audit rows under. Shared with
 * repCoachingController.test.ts, which is precisely why it cannot scope an
 * assertion on its own — see the audit-count tests below. (MINCRM-693)
 */
const REP_COACHING_CONFIG_RECORD_NAME = 'Rep Coaching Insights Configuration';

let repAId: string;
let repBId: string;

/** Counts this file's own config audit rows. See countAuditRowsFor. (MINCRM-693) */
function countConfigAuditRows(actorId: string): Promise<number> {
  return countAuditRowsFor(pool, {
    recordType: 'ai_settings',
    recordName: REP_COACHING_CONFIG_RECORD_NAME,
    actorId,
  });
}

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM rep_coaching_insight_history WHERE rep_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM rep_coaching_insights WHERE rep_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM deal_stage_history WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM team_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  // Team names in this file use a space after the prefix ("<prefix> Team"),
  // not a hyphen like the other LIKE patterns above.
  await pool.query(`DELETE FROM teams WHERE name LIKE $1`, [`${FILE_PREFIX}%`]);
}

async function resetConfig(): Promise<void> {
  await pool.query(
    `UPDATE rep_coaching_scoring_config SET
       min_closed_deals = 10, stage_time_outlier_ratio = 1.50,
       activity_frequency_outlier_ratio = 0.50, response_time_outlier_hours = 48,
       win_rate_outlier_delta = 0.150, updated_at = now(), updated_by = NULL
     WHERE id = true`,
  );
}

/** Creates `count` closed deals for a rep, alternating won/lost, each via createDeal + updateDeal to Closed. */
async function createClosedDeals(
  ownerId: string,
  count: number,
  accountId: string | null,
  wonFraction: number,
): Promise<void> {
  const wonCount = Math.round(count * wonFraction);
  for (let i = 0; i < count; i++) {
    const deal = await createDeal({
      name: `${FILE_PREFIX} Deal ${ownerId}-${i}`,
      stage: 'Prospecting',
      value: 25000,
      owner_id: ownerId,
      account_id: accountId ?? undefined,
    });
    const targetStage = i < wonCount ? 'Closed Won' : 'Closed Lost';
    await updateDeal(deal.id, { stage: targetStage, version: deal.version }, ACTOR, deal);
  }
}

beforeAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const repA = await createUser({
    email: `${FILE_PREFIX}-repa@example.com`,
    name: 'Rep A',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  repAId = repA.id;
  const repB = await createUser({
    email: `${FILE_PREFIX}-repb@example.com`,
    name: 'Rep B',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  repBId = repB.id;
});

beforeEach(async () => {
  await cleanup();
  await resetConfig();
});

afterAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('generateRepCoachingInsights', () => {
  it('withholds insights for a rep below the minimum closed-deal threshold', async () => {
    await createClosedDeals(repAId, 5, null, 0.5); // below default min_closed_deals (10)

    await generateRepCoachingInsights();

    const result = await getRepCoachingInsights(repAId);
    expect(result.has_sufficient_data).toBe(false);
    expect(result.insights.length).toBe(0);
  });

  it('generates insights once a rep meets the minimum closed-deal threshold', async () => {
    await createClosedDeals(repAId, 10, null, 0.5);
    await createClosedDeals(repBId, 10, null, 0.5);

    await generateRepCoachingInsights();

    const result = await getRepCoachingInsights(repAId);
    expect(result.has_sufficient_data).toBe(true);
    expect(result.closed_deal_count).toBe(10);
    expect(result.insights.length).toBeGreaterThan(0);
  });

  it('computes win_rate_by_industry per account industry and flags the lower-performing rep as an outlier', async () => {
    const highWinAccount = await createAccount({
      name: `${FILE_PREFIX} SaaS Co`,
      industry: 'SaaS',
      owner_id: repAId,
    });
    const lowWinAccount = await createAccount({
      name: `${FILE_PREFIX} SaaS Co 2`,
      industry: 'SaaS',
      owner_id: repBId,
    });

    // Rep A: 90% win rate in SaaS. Rep B: 10% win rate in SaaS — a clear outlier
    // given the default win_rate_outlier_delta (0.15).
    await createClosedDeals(repAId, 10, highWinAccount.id, 0.9);
    await createClosedDeals(repBId, 10, lowWinAccount.id, 0.1);

    await generateRepCoachingInsights();

    const repBResult = await getRepCoachingInsights(repBId);
    const industryInsight = repBResult.insights.find(
      (i) => i.metric_type === 'win_rate_by_industry' && i.segment === 'SaaS',
    );
    expect(industryInsight).toBeDefined();
    expect(industryInsight!.is_outlier).toBe(true);
    expect(industryInsight!.rep_value).toBeCloseTo(0.1, 1);
  });

  it('records average stage days derived from deal_stage_history', async () => {
    await createClosedDeals(repAId, 10, null, 0.5);
    await createClosedDeals(repBId, 10, null, 0.5);

    await generateRepCoachingInsights();

    const result = await getRepCoachingInsights(repAId);
    const stageInsight = result.insights.find(
      (i) => i.metric_type === 'avg_stage_days' && i.segment === null,
    );
    expect(stageInsight).toBeDefined();
    expect(stageInsight!.rep_value).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent — re-running upserts rather than duplicating rows', async () => {
    await createClosedDeals(repAId, 10, null, 0.5);

    await generateRepCoachingInsights();
    const firstRun = await getRepCoachingInsights(repAId);
    const firstCount = firstRun.insights.length;

    await generateRepCoachingInsights();
    const secondRun = await getRepCoachingInsights(repAId);

    expect(secondRun.insights.length).toBe(firstCount);
  });

  it('completes without throwing when no reps meet the threshold', async () => {
    await expect(generateRepCoachingInsights()).resolves.not.toThrow();
  });
});

describe('getRepIdsVisibleToManager', () => {
  it('falls back to self-only when the manager manages no teams', async () => {
    const manager = await createUser({
      email: `${FILE_PREFIX}-nomanagerteam@example.com`,
      name: 'No Team Manager',
      role: 'manager',
      passwordHash: '$2b$12$placeholder_hash',
      status: 'active',
    });

    const visible = await getRepIdsVisibleToManager(manager.id);
    expect(visible).toEqual([manager.id]);
  });

  it('returns all members of teams the manager manages, plus the manager', async () => {
    const manager = await createUser({
      email: `${FILE_PREFIX}-teammanager@example.com`,
      name: 'Team Manager',
      role: 'manager',
      passwordHash: '$2b$12$placeholder_hash',
      status: 'active',
    });
    const team = await createTeam({ name: `${FILE_PREFIX} Team`, manager_id: manager.id }, ACTOR);
    await addTeamMember(team.id, repAId, 'member', ACTOR);

    const visible = await getRepIdsVisibleToManager(manager.id);
    expect(visible).toContain(manager.id);
    expect(visible).toContain(repAId);
    expect(visible).not.toContain(repBId);
  });
});

describe('getCoachingTeamOverview', () => {
  it('scopes to the provided rep IDs when not null', async () => {
    await createClosedDeals(repAId, 10, null, 0.5);
    await generateRepCoachingInsights();

    const overview = await getCoachingTeamOverview([repAId]);
    expect(overview.reps.length).toBe(1);
    expect(overview.reps[0].rep_id).toBe(repAId);
    expect(overview.reps[0].has_sufficient_data).toBe(true);
  });

  it('returns org-wide reps when repIds is null', async () => {
    const overview = await getCoachingTeamOverview(null);
    const repIds = overview.reps.map((r) => r.rep_id);
    expect(repIds).toContain(repAId);
    expect(repIds).toContain(repBId);
  });
});

describe('getRepCoachingConfig / setRepCoachingConfig', () => {
  it('returns the seeded default configuration', async () => {
    const config = await getRepCoachingConfig();
    expect(config.min_closed_deals).toBe(10);
    expect(config.stage_time_outlier_ratio).toBeCloseTo(1.5, 2);
  });

  it('persists an admin update to the thresholds', async () => {
    const updated = await setRepCoachingConfig(
      {
        min_closed_deals: 5,
        stage_time_outlier_ratio: 2,
        activity_frequency_outlier_ratio: 0.3,
        response_time_outlier_hours: 24,
        win_rate_outlier_delta: 0.2,
      },
      { id: repAId, name: 'Rep A' },
    );
    expect(updated.min_closed_deals).toBe(5);

    const reloaded = await getRepCoachingConfig();
    expect(reloaded.min_closed_deals).toBe(5);
    expect(reloaded.stage_time_outlier_ratio).toBeCloseTo(2, 2);
  });

  it('writes an audit entry only for fields that actually changed', async () => {
    // Scoped by changed_by_id, not by a time window. audit_log is a shared table
    // and repCoachingController.test.ts writes rows under the IDENTICAL
    // record_type + record_name, so those two dimensions cannot isolate
    // anything — a window only narrows the race, it never closes it. (Both
    // files are in SERIAL_FILES, so they don't run concurrently with each
    // other; the exposure is to the parallel project, which runs alongside the
    // serial one.) Worse, that file's writes go through
    // writeAuditEntryBestEffort (void, unawaited), so a row can land after its
    // own test finished and fall inside any window chosen here.
    //
    // repAId is created in beforeAll with this file's own email prefix, so no
    // concurrently running file can write a row carrying it. Compare before vs
    // after rather than asserting an absolute '0', which would additionally
    // assert that nothing earlier in this file wrote under the same actor.
    // (MINCRM-693)
    const before = await countConfigAuditRows(repAId);

    await setRepCoachingConfig(
      {
        min_closed_deals: 10,
        stage_time_outlier_ratio: 1.5,
        activity_frequency_outlier_ratio: 0.5,
        response_time_outlier_hours: 48,
        win_rate_outlier_delta: 0.15,
      },
      { id: repAId, name: 'Rep A' },
    );

    // Values are identical to the seeded defaults — no audit entries should be written.
    expect(await countConfigAuditRows(repAId)).toBe(before);
  });

  it("counts this file's real config writes while ignoring another actor's", async () => {
    // Demonstrates the fix holds rather than merely observing it pass once
    // (MINCRM-693 AC 3). Both halves matter:
    //   1. A REAL setRepCoachingConfig write under this file's actor IS counted
    //      — so the scoping cannot pass by matching nothing at all.
    //   2. A row under a different actor, carrying the identical record_type and
    //      record_name a concurrent controller test writes, is NOT counted.
    // An unscoped count sees both, which is exactly why the original
    // record_name + time-window assertion raced.
    const before = await countConfigAuditRows(repAId);

    // A real changed field, so the service actually writes an audit row.
    await setRepCoachingConfig(
      {
        min_closed_deals: 12,
        stage_time_outlier_ratio: 1.5,
        activity_frequency_outlier_ratio: 0.5,
        response_time_outlier_hours: 48,
        win_rate_outlier_delta: 0.15,
      },
      { id: repAId, name: 'Rep A' },
    );
    expect(await countConfigAuditRows(repAId)).toBeGreaterThan(before);

    // Now a row from a different actor carrying the identical record_type and
    // record_name a concurrent controller test writes. randomUUID rather than
    // this file's own repBId: the point is a foreign writer, and changed_by_id
    // has no FK, so an arbitrary UUID models it exactly.
    await expectActorScopingIsolatesForeignRows(
      {
        recordType: 'ai_settings',
        recordName: REP_COACHING_CONFIG_RECORD_NAME,
        actorId: repAId,
        fieldName: 'min_closed_deals',
      },
      randomUUID(),
      expect,
    );
  });
});
