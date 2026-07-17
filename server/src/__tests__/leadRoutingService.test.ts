/**
 * Integration tests for leadRoutingService. (MINCRM-475)
 * Runs against a real PostgreSQL test database — scoring is deterministic/SQL-driven,
 * no Anthropic SDK mock needed (this feature makes no AI provider call at all).
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createLead } from '../services/leadsService.js';
import { createTeam, addTeamMember } from '../services/teamService.js';
import {
  computeLeadRoutingSuggestion,
  scoreCandidates,
  confidenceFor,
  getLeadRoutingConfig,
  setLeadRoutingConfig,
  listTeamRoutingOverrides,
  setTeamRoutingOverride,
} from '../services/leadRoutingService.js';
import type { CandidateRep } from '../services/leadRoutingService.js';
import { isFlagEnabledForUser } from '../services/featureFlagService.js';
import { uid } from './testUtils.js';

const FILE_PREFIX = 'lead-routing-svc';
const ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

let repAId: string;
let repBId: string;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM lead_routing_decisions WHERE lead_id IN (SELECT id FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))`,
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
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM team_feature_overrides WHERE team_id IN (SELECT id FROM teams WHERE name LIKE $1)`,
    [`${FILE_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM team_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(`DELETE FROM teams WHERE name LIKE $1`, [`${FILE_PREFIX}%`]);
}

async function resetConfig(): Promise<void> {
  await pool.query(
    `UPDATE lead_routing_scoring_config SET
       territory_weight = 0.250, industry_weight = 0.250, workload_weight = 0.200,
       win_rate_weight = 0.200, availability_weight = 0.100,
       low_confidence_threshold = 0.400, medium_confidence_threshold = 0.650,
       min_closed_deals_for_win_rate = 3, updated_at = now(), updated_by = NULL
     WHERE id = true`,
  );
}

beforeAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const repA = await createUser({
    email: `${FILE_PREFIX}-repa@example.com`,
    name: 'Routing Rep A',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  repAId = repA.id;
  const repB = await createUser({
    email: `${FILE_PREFIX}-repb@example.com`,
    name: 'Routing Rep B',
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

// Pure unit tests against a fixed, hand-built candidate list — no DB query, so
// no contamination from other test files' fixture reps in the shared test
// database (computeLeadRoutingSuggestion queries ALL active reps/managers
// org-wide, which makes asserting "the winner is exactly repA" unreliable at
// the integration level). See leadRoutingService.ts's export doc comments.
describe('scoreCandidates / confidenceFor (pure scoring logic)', () => {
  const DEFAULT_WEIGHTS = {
    territory_weight: 0.25,
    industry_weight: 0.25,
    workload_weight: 0.2,
    win_rate_weight: 0.2,
    availability_weight: 0.1,
    low_confidence_threshold: 0.4,
    medium_confidence_threshold: 0.65,
    min_closed_deals_for_win_rate: 3,
  };

  function candidate(overrides: Partial<CandidateRep> & { id: string }): CandidateRep {
    return {
      name: overrides.id,
      territory: null,
      openLeadCount: 0,
      activeDealCount: 0,
      industryWinRate: null,
      industryDealCount: 0,
      ...overrides,
    };
  }

  it('scores a territory match higher than a non-match', () => {
    const profile = { territory: 'West', industry: null, employeeRange: null, leadSource: null };
    const candidates = [
      candidate({ id: 'rep-match', territory: 'West' }),
      candidate({ id: 'rep-no-match', territory: 'East' }),
    ];
    const scored = scoreCandidates(profile, candidates, DEFAULT_WEIGHTS);
    const match = scored.find((s) => s.candidate.id === 'rep-match')!;
    const noMatch = scored.find((s) => s.candidate.id === 'rep-no-match')!;
    expect(match.score).toBeGreaterThan(noMatch.score);
    expect(match.factors.some((f) => f.type === 'territory_match')).toBe(true);
  });

  it('scores a higher win rate candidate higher, with win_rate as a contributing factor', () => {
    const profile = { territory: null, industry: 'SaaS', employeeRange: null, leadSource: null };
    const candidates = [
      candidate({ id: 'rep-high-win', industryWinRate: 0.9, industryDealCount: 5 }),
      candidate({ id: 'rep-low-win', industryWinRate: 0.1, industryDealCount: 5 }),
    ];
    const scored = scoreCandidates(profile, candidates, DEFAULT_WEIGHTS);
    const highWin = scored.find((s) => s.candidate.id === 'rep-high-win')!;
    const lowWin = scored.find((s) => s.candidate.id === 'rep-low-win')!;
    expect(highWin.score).toBeGreaterThan(lowWin.score);
    expect(highWin.factors.some((f) => f.type === 'win_rate')).toBe(true);
  });

  it('scores a rep with more open leads (higher workload) lower than a rep with capacity', () => {
    const profile = { territory: null, industry: null, employeeRange: null, leadSource: null };
    const candidates = [
      candidate({ id: 'rep-busy', openLeadCount: 20 }),
      candidate({ id: 'rep-capacity', openLeadCount: 2 }),
    ];
    const scored = scoreCandidates(profile, candidates, DEFAULT_WEIGHTS);
    const busy = scored.find((s) => s.candidate.id === 'rep-busy')!;
    const capacity = scored.find((s) => s.candidate.id === 'rep-capacity')!;
    expect(capacity.score).toBeGreaterThan(busy.score);
    expect(capacity.factors.some((f) => f.type === 'workload')).toBe(true);
  });

  it('does not include a territory_match factor when the profile has no territory', () => {
    const profile = { territory: null, industry: null, employeeRange: null, leadSource: null };
    const scored = scoreCandidates(
      profile,
      [candidate({ id: 'rep-1', territory: 'West' })],
      DEFAULT_WEIGHTS,
    );
    expect(scored[0].factors.some((f) => f.type === 'territory_match')).toBe(false);
  });

  it('confidenceFor returns low with fewer than 2 candidates regardless of score', () => {
    const scored = {
      candidate: candidate({ id: 'rep-1' }),
      score: 0.9,
      factors: [{ type: 'territory_match' as const, description: 'x' }],
    };
    expect(confidenceFor(scored, 1, DEFAULT_WEIGHTS)).toBe('low');
  });

  it('confidenceFor returns low when there are no contributing factors, regardless of score', () => {
    const scored = { candidate: candidate({ id: 'rep-1' }), score: 0.9, factors: [] };
    expect(confidenceFor(scored, 2, DEFAULT_WEIGHTS)).toBe('low');
  });

  it('confidenceFor returns high/medium/low per the configured thresholds', () => {
    const factors = [{ type: 'territory_match' as const, description: 'x' }];
    expect(
      confidenceFor({ candidate: candidate({ id: 'r' }), score: 0.7, factors }, 2, DEFAULT_WEIGHTS),
    ).toBe('high');
    expect(
      confidenceFor({ candidate: candidate({ id: 'r' }), score: 0.5, factors }, 2, DEFAULT_WEIGHTS),
    ).toBe('medium');
    expect(
      confidenceFor({ candidate: candidate({ id: 'r' }), score: 0.1, factors }, 2, DEFAULT_WEIGHTS),
    ).toBe('low');
  });
});

describe('computeLeadRoutingSuggestion (DB integration — weak assertions only)', () => {
  it('completes without throwing and returns either null or a well-formed suggestion', async () => {
    const result = await computeLeadRoutingSuggestion({
      territory: null,
      industry: null,
      employeeRange: null,
      leadSource: null,
    });
    if (result !== null) {
      expect(typeof result.suggested_rep_id).toBe('string');
      expect(['high', 'medium', 'low']).toContain(result.confidence);
    }
  });
});

describe('createLead with routing_suggestion echo — persists a routing decision', () => {
  // The client's routing_suggestion is only a "a suggestion was shown" signal —
  // createLead must recompute the suggestion server-side from the draft profile
  // and persist THAT result, never the client-supplied content verbatim. Otherwise
  // a client could fabricate suggested_rep_id/confidence/contributing_factors and
  // corrupt the routing feature's own acceptance-rate audit trail. These tests
  // assert against the independently-recomputed suggestion, not the fake echo.

  it('ignores a fabricated suggested_rep_id and persists the recomputed suggestion instead', async () => {
    const fakeRepId = '00000000-0000-0000-0000-000000000099';
    const recomputed = await computeLeadRoutingSuggestion({
      territory: null,
      industry: null,
      employeeRange: null,
      leadSource: null,
    });

    const lead = await createLead(
      {
        first_name: 'Echo',
        last_name: 'Fabricated',
        email: `${FILE_PREFIX}-${uid()}-fabricated@example.com`,
        owner_id: repAId,
        // Fabricated: a real client would never learn this repId from a genuine
        // suggestion, and the confidence/factors are invented outright.
        routing_suggestion: {
          suggested_rep_id: fakeRepId,
          confidence: 'high',
          contributing_factors: [
            { type: 'territory_match', description: 'Fabricated factor that was never computed' },
          ],
        },
      },
      ACTOR,
    );

    const decisionResult = await pool.query<{
      suggested_rep_id: string | null;
      confidence: string | null;
      decision: string | null;
      actual_assignee_id: string;
    }>(
      `SELECT suggested_rep_id, confidence, decision, actual_assignee_id
       FROM lead_routing_decisions WHERE lead_id = $1`,
      [lead.id],
    );

    if (recomputed === null) {
      // No confident suggestion for this profile — nothing should be persisted,
      // certainly not the fabricated payload.
      expect(decisionResult.rows.length).toBe(0);
    } else {
      expect(decisionResult.rows[0].suggested_rep_id).toBe(recomputed.suggested_rep_id);
      expect(decisionResult.rows[0].suggested_rep_id).not.toBe(fakeRepId);
      expect(decisionResult.rows[0].confidence).toBe(recomputed.confidence);
      const expectedDecision = recomputed.suggested_rep_id === repAId ? 'accepted' : 'overridden';
      expect(decisionResult.rows[0].decision).toBe(expectedDecision);
      expect(decisionResult.rows[0].actual_assignee_id).toBe(repAId);
    }
  });

  it('writes no lead_routing_decisions row when the create request has no routing_suggestion', async () => {
    const lead = await createLead(
      {
        first_name: 'No',
        last_name: 'Suggestion',
        email: `${FILE_PREFIX}-${uid()}-nosuggestion@example.com`,
        owner_id: repAId,
      },
      ACTOR,
    );

    const decisionResult = await pool.query(
      `SELECT id FROM lead_routing_decisions WHERE lead_id = $1`,
      [lead.id],
    );
    expect(decisionResult.rows.length).toBe(0);
  });
});

describe('getLeadRoutingConfig / setLeadRoutingConfig', () => {
  it('returns the seeded default configuration', async () => {
    const config = await getLeadRoutingConfig();
    expect(config.min_closed_deals_for_win_rate).toBe(3);
    expect(
      config.territory_weight +
        config.industry_weight +
        config.workload_weight +
        config.win_rate_weight +
        config.availability_weight,
    ).toBeCloseTo(1, 3);
  });

  it('persists an admin update to the weights/thresholds', async () => {
    const updated = await setLeadRoutingConfig(
      {
        territory_weight: 0.3,
        industry_weight: 0.3,
        workload_weight: 0.15,
        win_rate_weight: 0.15,
        availability_weight: 0.1,
        low_confidence_threshold: 0.35,
        medium_confidence_threshold: 0.6,
        min_closed_deals_for_win_rate: 5,
      },
      { id: repAId, name: 'Routing Rep A' },
    );
    expect(updated.min_closed_deals_for_win_rate).toBe(5);

    const reloaded = await getLeadRoutingConfig();
    expect(reloaded.min_closed_deals_for_win_rate).toBe(5);
  });
});

describe('team routing overrides', () => {
  it('has no overrides by default', async () => {
    const overrides = await listTeamRoutingOverrides();
    expect(overrides.filter((o) => o.team_name.startsWith(FILE_PREFIX)).length).toBe(0);
  });

  it('setTeamRoutingOverride(false) blocks the flag for every member of the team', async () => {
    const team = await createTeam({ name: `${FILE_PREFIX} Blocked Team` }, ACTOR);
    await addTeamMember(team.id, repAId, 'member', ACTOR);

    await setTeamRoutingOverride(team.id, false, { id: repAId, name: 'Routing Rep A' });

    const enabled = await isFlagEnabledForUser('ai_lead_routing_suggestion', repAId, 'rep');
    expect(enabled).toBe(false);

    // Rep B is not on the blocked team — unaffected.
    const repBEnabled = await isFlagEnabledForUser('ai_lead_routing_suggestion', repBId, 'rep');
    expect(repBEnabled).toBe(true);
  });

  it('clearing the override (enabled=null) restores the global flag state', async () => {
    const team = await createTeam({ name: `${FILE_PREFIX} Cleared Team` }, ACTOR);
    await addTeamMember(team.id, repAId, 'member', ACTOR);

    await setTeamRoutingOverride(team.id, false, { id: repAId, name: 'Routing Rep A' });
    expect(await isFlagEnabledForUser('ai_lead_routing_suggestion', repAId, 'rep')).toBe(false);

    await setTeamRoutingOverride(team.id, null, { id: repAId, name: 'Routing Rep A' });
    expect(await isFlagEnabledForUser('ai_lead_routing_suggestion', repAId, 'rep')).toBe(true);
  });

  it('throws TEAM_NOT_FOUND for a non-existent team', async () => {
    await expect(
      setTeamRoutingOverride('00000000-0000-0000-0000-000000000000', false, {
        id: repAId,
        name: 'Routing Rep A',
      }),
    ).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' });
  });
});
