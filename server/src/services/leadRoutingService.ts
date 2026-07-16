/**
 * Lead routing suggestion service — deterministic weighted-factor scoring
 * that suggests which rep a new lead should be assigned to. (MINCRM-475)
 *
 * Two entry points matching the AC's "suggestion appears before the assignee
 * field is saved" flow:
 *   - computeLeadRoutingSuggestion(): pure read/compute, called from a
 *     pre-create endpoint while the manager is still filling out the lead
 *     form (no lead row exists yet — the draft profile is passed directly).
 *     Must return within the AC's 3-second budget.
 *   - persistRoutingDecision(): called from leadsService.createLead(), in
 *     the SAME transaction as the lead insert, once the final owner_id is
 *     known. Compares the manager's final choice against the suggestion the
 *     client echoed back on the create request to log accepted/overridden.
 *
 * Deliberately NOT an LLM call: a forced-tool Anthropic call adds
 * unpredictable latency against the 3-second SLA and produces
 * non-deterministic factors that are hard to audit — this is fundamentally a
 * weighted-scoring problem (like leadScoreService/duplicateMatchService),
 * not a judgment call requiring model inference. Every contributing factor
 * is a plain SQL aggregate, so the same draft-profile+candidate-pool state
 * always produces the same suggestion, and the reasons shown to the manager
 * are exactly the numbers that drove the score.
 *
 * Candidate pool is org-wide (all active reps and managers), not scoped to
 * the assigning manager's own team — there is no existing team-based
 * authorization boundary on lead ownership anywhere else in this codebase
 * (any admin may already assign a lead to any active user org-wide), so
 * scoping candidates to a team here would invent a new implicit restriction
 * the rest of the app doesn't enforce.
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import type {
  LeadRoutingConfidence,
  LeadRoutingFactor,
  LeadRoutingSuggestionResponse,
  LeadRoutingConfigResponse,
  SetLeadRoutingConfigInput,
} from '@minicrm/shared/schemas/leadRoutingSchema.js';

/**
 * Weights for each scoring factor — sum to 1.0, validated by a CHECK
 * constraint (migration 154). Exported for direct unit testing of
 * scoreCandidates/confidenceFor without a DB round-trip. (MINCRM-475)
 */
export interface RoutingWeights {
  territory_weight: number;
  industry_weight: number;
  workload_weight: number;
  win_rate_weight: number;
  availability_weight: number;
  low_confidence_threshold: number;
  medium_confidence_threshold: number;
  /** Minimum closed deals a candidate must have in-profile before win-rate factors are trusted. */
  min_closed_deals_for_win_rate: number;
}

async function getRoutingWeights(): Promise<RoutingWeights> {
  const result = await pool.query<RoutingWeights>(
    `SELECT territory_weight, industry_weight, workload_weight, win_rate_weight, availability_weight,
            low_confidence_threshold, medium_confidence_threshold, min_closed_deals_for_win_rate
     FROM lead_routing_scoring_config
     LIMIT 1`,
  );
  // Safe: singleton row seeded by migration 154, id = true is a NOT NULL PK.
  return result.rows[0]!;
}

/** Exported for direct unit testing of scoreCandidates without a DB round-trip. (MINCRM-475) */
export interface CandidateRep {
  id: string;
  name: string;
  territory: string | null;
  openLeadCount: number;
  activeDealCount: number;
  /** Win rate on closed deals whose source lead shares the draft lead's industry/source/size profile, or null if too few data points. */
  industryWinRate: number | null;
  industryDealCount: number;
}

/** Draft lead profile — the fields a routing suggestion is scored against, before the lead exists. */
export interface DraftLeadProfile {
  territory: string | null;
  industry: string | null;
  employeeRange: string | null;
  leadSource: string | null;
}

/**
 * Gathers every active rep/manager as a routing candidate, with their
 * territory, current open-lead count (workload), active-deal count
 * (availability proxy), and win rate on similar-profile closed deals
 * (industry + lead source + company size, matching the draft lead).
 */
async function gatherCandidates(
  profile: DraftLeadProfile,
  minClosedDealsForWinRate: number,
): Promise<CandidateRep[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    territory: string | null;
    open_lead_count: string;
    active_deal_count: string;
    industry_won_count: string;
    industry_deal_count: string;
  }>(
    `SELECT
       u.id, u.name, u.territory,
       (SELECT COUNT(*) FROM leads l
          WHERE l.owner_id = u.id AND l.status NOT IN ('Disqualified') AND l.converted_at IS NULL
       ) AS open_lead_count,
       (SELECT COUNT(*) FROM deals d
          WHERE d.owner_id = u.id AND d.stage NOT IN ('Closed Won', 'Closed Lost')
       ) AS active_deal_count,
       (SELECT COUNT(*) FROM deals d
          JOIN leads sl ON sl.id = d.source_lead_id
          WHERE d.owner_id = u.id AND d.stage = 'Closed Won'
            AND ($1::text IS NULL OR sl.industry = $1)
            AND ($2::text IS NULL OR sl.lead_source = $2)
            AND ($3::text IS NULL OR sl.employee_range = $3)
       ) AS industry_won_count,
       (SELECT COUNT(*) FROM deals d
          JOIN leads sl ON sl.id = d.source_lead_id
          WHERE d.owner_id = u.id AND d.stage IN ('Closed Won', 'Closed Lost')
            AND ($1::text IS NULL OR sl.industry = $1)
            AND ($2::text IS NULL OR sl.lead_source = $2)
            AND ($3::text IS NULL OR sl.employee_range = $3)
       ) AS industry_deal_count
     FROM users u
     WHERE u.role IN ('rep', 'manager') AND u.status = 'active'`,
    [profile.industry, profile.leadSource, profile.employeeRange],
  );

  return result.rows.map((row) => {
    const dealCount = parseInt(row.industry_deal_count, 10);
    // Win rate is only trusted once the candidate has at least the admin-configured
    // minimum sample size — otherwise a single win/loss would swing the score wildly.
    const hasEnoughSamples = dealCount >= minClosedDealsForWinRate;
    return {
      id: row.id,
      name: row.name,
      territory: row.territory,
      openLeadCount: parseInt(row.open_lead_count, 10),
      activeDealCount: parseInt(row.active_deal_count, 10),
      industryDealCount: hasEnoughSamples ? dealCount : 0,
      industryWinRate: hasEnoughSamples ? parseInt(row.industry_won_count, 10) / dealCount : null,
    };
  });
}

/** Exported for direct unit testing of scoreCandidates without a DB round-trip. (MINCRM-475) */
export interface ScoredCandidate {
  candidate: CandidateRep;
  score: number;
  factors: LeadRoutingFactor[];
}

/**
 * Scores every candidate against the draft lead's profile. Each factor
 * contributes 0-1 before weighting; factors that can't be evaluated (missing
 * data on either side) are skipped for that candidate rather than
 * penalizing them, and the remaining factors' weights implicitly absorb the
 * gap via the totalWeight normalization below — a candidate is never
 * unfairly scored down purely for having less profile data than a peer.
 *
 * Exported (alongside CandidateRep/ScoredCandidate/confidenceFor) for direct
 * unit testing against a fixed, hand-built candidate list — computeLeadRoutingSuggestion
 * queries ALL active reps/managers org-wide, so integration-testing "the winner is X"
 * would be contaminated by other fixtures in a shared test database. (MINCRM-475)
 */
export function scoreCandidates(
  profile: DraftLeadProfile,
  candidates: CandidateRep[],
  weights: RoutingWeights,
): ScoredCandidate[] {
  // Team averages for workload/availability normalization — a candidate's raw open-lead
  // count means nothing without knowing what's typical across the team.
  const avgOpenLeads =
    candidates.reduce((sum, c) => sum + c.openLeadCount, 0) / Math.max(1, candidates.length);
  const avgActiveDeal =
    candidates.reduce((sum, c) => sum + c.activeDealCount, 0) / Math.max(1, candidates.length);

  return candidates.map((candidate) => {
    const parts: Array<{ weight: number; value: number; factor: LeadRoutingFactor | null }> = [];

    // Territory alignment — binary match/no-match when both sides have a value.
    if (profile.territory && candidate.territory) {
      const match = profile.territory === candidate.territory;
      parts.push({
        weight: weights.territory_weight,
        value: match ? 1 : 0,
        factor: match
          ? { type: 'territory_match', description: `Territory match (${candidate.territory})` }
          : null,
      });
    }

    // Industry match — via the win-rate sample itself: having ANY closed-deal history
    // in this industry/source/size combination counts as a partial match signal,
    // independent of the win rate value (a rep with relevant experience, win or lose,
    // still knows the space better than one with zero comparable deals).
    if (profile.industry && candidate.industryDealCount > 0) {
      parts.push({
        weight: weights.industry_weight,
        value: 1,
        factor: {
          type: 'industry_match',
          description: `Best industry match (${profile.industry})`,
        },
      });
    }

    // Workload — inverse of open lead count relative to the team average. A rep at
    // or below average gets full credit; above average tapers linearly to 0 at 2x avg.
    if (avgOpenLeads > 0) {
      const ratio = candidate.openLeadCount / avgOpenLeads;
      const workloadScore = Math.max(0, Math.min(1, 1 - (ratio - 1)));
      parts.push({
        weight: weights.workload_weight,
        value: workloadScore,
        factor:
          candidate.openLeadCount <= avgOpenLeads
            ? {
                type: 'workload',
                description: `Currently has capacity (${candidate.openLeadCount} open leads vs. team average of ${avgOpenLeads.toFixed(1)})`,
              }
            : null,
      });
    }

    // Win rate on similar-profile closed deals — only trusted with enough samples.
    if (candidate.industryWinRate !== null) {
      parts.push({
        weight: weights.win_rate_weight,
        value: candidate.industryWinRate,
        factor: {
          type: 'win_rate',
          description: `${Math.round(candidate.industryWinRate * 100)}% win rate with similar lead profiles`,
        },
      });
    }

    // Availability — inverse of active deal count relative to the team average, same
    // shape as workload but measuring existing pipeline load rather than open leads.
    if (avgActiveDeal > 0) {
      const ratio = candidate.activeDealCount / avgActiveDeal;
      const availabilityScore = Math.max(0, Math.min(1, 1 - (ratio - 1)));
      parts.push({ weight: weights.availability_weight, value: availabilityScore, factor: null });
    }

    const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
    const score =
      totalWeight > 0 ? parts.reduce((sum, p) => sum + (p.weight / totalWeight) * p.value, 0) : 0;

    const factors = parts
      .map((p) => p.factor)
      .filter((f): f is LeadRoutingFactor => f !== null)
      .slice(0, 3);

    return { candidate, score, factors };
  });
}

/** Exported for direct unit testing without a DB round-trip. (MINCRM-475) */
export function confidenceFor(
  scored: ScoredCandidate,
  candidateCount: number,
  weights: RoutingWeights,
): LeadRoutingConfidence {
  // Too few candidates or too few contributing factors means the suggestion
  // isn't meaningfully differentiated — treat as low confidence regardless of score.
  if (candidateCount < 2 || scored.factors.length === 0) return 'low';
  if (scored.score >= weights.medium_confidence_threshold) return 'high';
  if (scored.score >= weights.low_confidence_threshold) return 'medium';
  return 'low';
}

/**
 * Computes a routing suggestion for a draft lead, before it's created. Pure
 * read/compute — writes nothing. Returns null when confidence would be low
 * (per the AC: "suggestion is suppressed and field defaults to unassigned")
 * or when there are no eligible candidates.
 */
export async function computeLeadRoutingSuggestion(
  profile: DraftLeadProfile,
): Promise<LeadRoutingSuggestionResponse | null> {
  const weights = await getRoutingWeights();
  const candidates = await gatherCandidates(profile, weights.min_closed_deals_for_win_rate);
  if (candidates.length === 0) return null;

  const scored = scoreCandidates(profile, candidates, weights);
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  const confidence = confidenceFor(best, candidates.length, weights);
  if (confidence === 'low') return null;

  return {
    suggested_rep_id: best.candidate.id,
    suggested_rep_name: best.candidate.name,
    confidence,
    contributing_factors: best.factors,
  };
}

/**
 * Persists a lead_routing_decisions row for a newly created lead, in the
 * SAME transaction/client as the lead insert. Call only when a suggestion
 * was actually shown to the manager (i.e. the create request echoed back a
 * suggested_rep_id from an earlier computeLeadRoutingSuggestion() call) —
 * leads created without ever requesting a suggestion have nothing to log.
 *
 * decision is derived by comparing the echoed suggestion against the lead's
 * final owner_id: 'accepted' when they match, 'overridden' otherwise.
 */
export async function persistRoutingDecision(
  client: PoolClient,
  params: {
    leadId: string;
    suggestedRepId: string;
    confidence: LeadRoutingConfidence;
    contributingFactors: LeadRoutingFactor[];
    finalOwnerId: string;
  },
  actor: AuditActor,
): Promise<void> {
  const decision = params.suggestedRepId === params.finalOwnerId ? 'accepted' : 'overridden';

  const result = await client.query<{ id: string }>(
    `INSERT INTO lead_routing_decisions
       (lead_id, suggested_rep_id, confidence, contributing_factors, decision, actual_assignee_id, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     RETURNING id`,
    [
      params.leadId,
      params.suggestedRepId,
      params.confidence,
      JSON.stringify(params.contributingFactors),
      decision,
      params.finalOwnerId,
    ],
  );

  await writeAuditEntry(client, {
    recordType: 'lead_routing_decision',
    recordId: result.rows[0].id,
    recordName: `Lead routing decision for lead ${params.leadId}`,
    eventType: decision === 'accepted' ? 'routing_accepted' : 'routing_overridden',
    changedById: actor.id,
    changedByName: actor.name,
  });
}

/** Feature flag key for this feature — used by the per-team override endpoints below. */
const ROUTING_FLAG_KEY = 'ai_lead_routing_suggestion';

export interface TeamRoutingOverride {
  team_id: string;
  team_name: string;
  enabled: boolean;
  updated_at: string;
  updated_by: string | null;
}

/** Returns every team's current ai_lead_routing_suggestion override, if one has been set. */
export async function listTeamRoutingOverrides(): Promise<TeamRoutingOverride[]> {
  const result = await pool.query<{
    team_id: string;
    team_name: string;
    enabled: boolean;
    updated_at: Date;
    updated_by: string | null;
  }>(
    `SELECT t.id AS team_id, t.name AS team_name, tfo.enabled, tfo.updated_at, tfo.updated_by
     FROM teams t
     JOIN team_feature_overrides tfo ON tfo.team_id = t.id AND tfo.flag_key = $1
     ORDER BY t.name ASC`,
    [ROUTING_FLAG_KEY],
  );
  return result.rows.map((row) => ({
    team_id: row.team_id,
    team_name: row.team_name,
    enabled: row.enabled,
    updated_at: row.updated_at.toISOString(),
    updated_by: row.updated_by,
  }));
}

/**
 * Sets (or clears, when enabled=null) a team's override for the
 * ai_lead_routing_suggestion flag. Writes an audit entry.
 *
 * @throws TEAM_NOT_FOUND if the team does not exist.
 */
export async function setTeamRoutingOverride(
  teamId: string,
  enabled: boolean | null,
  actor: AuditActor,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    const teamRow = await client.query<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [
      teamId,
    ]);
    if (!teamRow.rows[0]) {
      throw Object.assign(new Error(`Team '${teamId}' not found`), { code: 'TEAM_NOT_FOUND' });
    }
    const teamName = teamRow.rows[0].name;

    await client.query('BEGIN');

    const beforeResult = await client.query<{ enabled: boolean }>(
      `SELECT enabled FROM team_feature_overrides WHERE team_id = $1 AND flag_key = $2`,
      [teamId, ROUTING_FLAG_KEY],
    );
    const before = beforeResult.rows[0]?.enabled ?? null;

    if (enabled === null) {
      await client.query(
        `DELETE FROM team_feature_overrides WHERE team_id = $1 AND flag_key = $2`,
        [teamId, ROUTING_FLAG_KEY],
      );
    } else {
      await client.query(
        `INSERT INTO team_feature_overrides (team_id, flag_key, enabled, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (team_id, flag_key) DO UPDATE
           SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [teamId, ROUTING_FLAG_KEY, enabled, actor.id],
      );
    }

    await writeAuditEntry(client, {
      recordType: 'team',
      recordId: teamId,
      recordName: teamName,
      eventType: 'updated',
      fieldName: 'ai_lead_routing_suggestion_override',
      oldValue: before === null ? null : String(before),
      newValue: enabled === null ? null : String(enabled),
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

function toConfigResponse(row: {
  territory_weight: string;
  industry_weight: string;
  workload_weight: string;
  win_rate_weight: string;
  availability_weight: string;
  low_confidence_threshold: string;
  medium_confidence_threshold: string;
  min_closed_deals_for_win_rate: number;
  updated_at: Date;
  updated_by: string | null;
}): LeadRoutingConfigResponse {
  return {
    territory_weight: parseFloat(row.territory_weight),
    industry_weight: parseFloat(row.industry_weight),
    workload_weight: parseFloat(row.workload_weight),
    win_rate_weight: parseFloat(row.win_rate_weight),
    availability_weight: parseFloat(row.availability_weight),
    low_confidence_threshold: parseFloat(row.low_confidence_threshold),
    medium_confidence_threshold: parseFloat(row.medium_confidence_threshold),
    min_closed_deals_for_win_rate: row.min_closed_deals_for_win_rate,
    updated_at: row.updated_at.toISOString(),
    updated_by: row.updated_by,
  };
}

/** GET /api/v1/admin/ai/lead-routing-config — returns the current admin-configured weights/thresholds. */
export async function getLeadRoutingConfig(): Promise<LeadRoutingConfigResponse> {
  const result = await pool.query(
    `SELECT territory_weight, industry_weight, workload_weight, win_rate_weight, availability_weight,
            low_confidence_threshold, medium_confidence_threshold, min_closed_deals_for_win_rate,
            updated_at, updated_by
     FROM lead_routing_scoring_config
     LIMIT 1`,
  );
  // Safe: singleton row seeded by migration 154, id = true is a NOT NULL PK.
  return toConfigResponse(result.rows[0]!);
}

/** PATCH /api/v1/admin/ai/lead-routing-config — updates the admin-configured weights/thresholds. */
export async function setLeadRoutingConfig(
  params: SetLeadRoutingConfigInput,
  actor: AuditActor,
): Promise<LeadRoutingConfigResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const beforeResult = await client.query<{
      territory_weight: string;
      industry_weight: string;
      workload_weight: string;
      win_rate_weight: string;
      availability_weight: string;
      low_confidence_threshold: string;
      medium_confidence_threshold: string;
      min_closed_deals_for_win_rate: number;
    }>(
      `SELECT territory_weight, industry_weight, workload_weight, win_rate_weight, availability_weight,
              low_confidence_threshold, medium_confidence_threshold, min_closed_deals_for_win_rate
       FROM lead_routing_scoring_config
       LIMIT 1
       FOR UPDATE`,
    );
    // Safe: singleton row seeded by migration 154, id = true is a NOT NULL PK.
    const before = beforeResult.rows[0]!;

    const afterResult = await client.query(
      `UPDATE lead_routing_scoring_config SET
         territory_weight = $1,
         industry_weight = $2,
         workload_weight = $3,
         win_rate_weight = $4,
         availability_weight = $5,
         low_confidence_threshold = $6,
         medium_confidence_threshold = $7,
         min_closed_deals_for_win_rate = $8,
         updated_at = now(),
         updated_by = $9
       WHERE id = true
       RETURNING territory_weight, industry_weight, workload_weight, win_rate_weight, availability_weight,
                 low_confidence_threshold, medium_confidence_threshold, min_closed_deals_for_win_rate,
                 updated_at, updated_by`,
      [
        params.territory_weight,
        params.industry_weight,
        params.workload_weight,
        params.win_rate_weight,
        params.availability_weight,
        params.low_confidence_threshold,
        params.medium_confidence_threshold,
        params.min_closed_deals_for_win_rate,
        actor.id,
      ],
    );
    // Safe: UPDATE ... WHERE id = true always matches the singleton row.
    const after = afterResult.rows[0]!;

    const auditBase = {
      recordType: 'ai_settings' as const,
      recordName: 'Lead Routing Suggestion Configuration',
      changedById: actor.id,
      changedByName: actor.name,
    };

    const fieldsToCompare: Array<keyof SetLeadRoutingConfigInput> = [
      'territory_weight',
      'industry_weight',
      'workload_weight',
      'win_rate_weight',
      'availability_weight',
      'low_confidence_threshold',
      'medium_confidence_threshold',
      'min_closed_deals_for_win_rate',
    ];
    for (const field of fieldsToCompare) {
      // Postgres numeric columns round-trip as strings with fixed decimal padding
      // (e.g. "0.250"), which never string-equals the JS number's own stringification
      // (e.g. "0.25") even when the value is unchanged — compare as numbers instead,
      // and only stringify for the audit entry itself once a real change is confirmed.
      const oldNumeric = Number(before[field]);
      const newNumeric = Number(params[field]);
      if (oldNumeric !== newNumeric) {
        await writeAuditEntry(client, {
          ...auditBase,
          eventType: 'updated',
          fieldName: field,
          oldValue: String(oldNumeric),
          newValue: String(newNumeric),
        });
      }
    }

    await client.query('COMMIT');
    return toConfigResponse(after);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
