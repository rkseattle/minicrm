/**
 * Account relationship health scoring — nightly job that computes a
 * deterministic composite score per account from communication frequency,
 * recency, contact seniority, sentiment trend, and contact breadth.
 *
 * Unlike churnExpansionService/sentimentService, scoring here is pure
 * arithmetic over SQL aggregates — no LLM call — since every AC input
 * (frequency, recency, seniority, sentiment trend, distinct contacts) is a
 * deterministically computable fact, not a judgment call. Job orchestration
 * (per-account loop, error isolation, tx + audit) still follows the same
 * shape as churnExpansionService.ts for consistency with the rest of the
 * nightly-job fleet.
 *
 * computeAccountHealthScores() is the cron entry point (server/src/server.ts).
 * The read path (getAccountHealthScore / getAccountHealthHistory) always
 * serves the latest cached row — never computes live, per the AC "displayed
 * from cache during the day".
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { SYSTEM_ACTOR, writeAuditEntry } from './auditService.js';
import { getAccountSentimentTrend } from './sentimentService.js';
import { classifySeniority, SENIORITY_TIER_WEIGHT } from './seniorityClassifier.js';
import type {
  AccountHealthState,
  AccountHealthFactor,
  AccountHealthScoreResponse,
  AccountHealthHistoryResponse,
  AccountHealthScoringConfig,
} from '@minicrm/shared/schemas/accountHealthScoreSchema.js';

/** Number of months of history returned for the trend sparkline. */
const HISTORY_MONTHS = 6;

interface ScoringConfigRow {
  frequency_weight: string;
  recency_weight: string;
  seniority_weight: string;
  sentiment_weight: string;
  breadth_weight: string;
  strong_threshold: string;
  healthy_threshold: string;
  cooling_threshold: string;
  at_risk_threshold: string;
  min_logged_activities: number;
  recency_window_days: number;
  single_threaded_window_days: number;
  updated_at: Date;
}

interface AccountCandidate {
  id: string;
  name: string;
  totalLoggedActivities: number;
}

interface AccountAggregates {
  /** Activities in the last recency_window_days, across all contacts/deals at the account. */
  recentActivityCount: number;
  daysSinceLastActivity: number | null;
  /** Distinct contacts with at least one activity in the last single_threaded_window_days. */
  distinctContactsEngaged: number;
  /** Titles of distinct contacts engaged in the last recency_window_days, for seniority scoring. */
  engagedContactTitles: Array<string | null>;
}

/**
 * Runs fn inside a BEGIN/COMMIT/ROLLBACK transaction on a single client, so a
 * score upsert + history insert + audit entry can never be observed half-applied.
 */
async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getScoringConfig(): Promise<ScoringConfigRow> {
  const result = await pool.query<ScoringConfigRow>(
    `SELECT frequency_weight, recency_weight, seniority_weight, sentiment_weight, breadth_weight,
            strong_threshold, healthy_threshold, cooling_threshold, at_risk_threshold,
            min_logged_activities, recency_window_days, single_threaded_window_days, updated_at
     FROM account_health_scoring_config
     WHERE id = true`,
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('account_health_scoring_config singleton row is missing');
  }
  return row;
}

/** Accounts with at least one logged activity — candidates for scoring. */
async function gatherCandidateAccounts(): Promise<AccountCandidate[]> {
  const result = await pool.query<{ id: string; name: string; total_logged_activities: string }>(
    `SELECT a.id, a.name,
            (SELECT COUNT(*) FROM activities act
             WHERE act.account_id = a.id
                OR act.contact_id IN (SELECT id FROM contacts WHERE account_id = a.id)
                OR act.deal_id IN (SELECT id FROM deals WHERE account_id = a.id)
            ) AS total_logged_activities
     FROM accounts a
     WHERE EXISTS (
       SELECT 1 FROM activities act
       WHERE act.account_id = a.id
          OR act.contact_id IN (SELECT id FROM contacts WHERE account_id = a.id)
          OR act.deal_id IN (SELECT id FROM deals WHERE account_id = a.id)
     )`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    totalLoggedActivities: parseInt(row.total_logged_activities, 10),
  }));
}

async function gatherAccountAggregates(
  accountId: string,
  config: ScoringConfigRow,
): Promise<AccountAggregates> {
  const result = await pool.query<{
    recent_activity_count: string;
    last_activity_at: Date | null;
    distinct_contacts_engaged: string;
    engaged_contact_titles: Array<string | null> | null;
  }>(
    `WITH account_activities AS (
       SELECT act.id, act.contact_id, COALESCE(act.due_date::timestamptz, act.created_at) AS interaction_at
       FROM activities act
       WHERE act.account_id = $1
          OR act.contact_id IN (SELECT id FROM contacts WHERE account_id = $1)
          OR act.deal_id IN (SELECT id FROM deals WHERE account_id = $1)
     )
     SELECT
       (SELECT COUNT(*) FROM account_activities WHERE interaction_at >= now() - ($2 || ' days')::interval)
         AS recent_activity_count,
       (SELECT MAX(interaction_at) FROM account_activities) AS last_activity_at,
       (SELECT COUNT(DISTINCT contact_id) FROM account_activities
          WHERE contact_id IS NOT NULL AND interaction_at >= now() - ($3 || ' days')::interval)
         AS distinct_contacts_engaged,
       (SELECT array_agg(DISTINCT c.title) FROM account_activities aa
          JOIN contacts c ON c.id = aa.contact_id
          WHERE aa.interaction_at >= now() - ($2 || ' days')::interval)
         AS engaged_contact_titles
    `,
    [accountId, config.recency_window_days, config.single_threaded_window_days],
  );

  const row = result.rows[0];
  const now = Date.now();
  return {
    recentActivityCount: parseInt(row?.recent_activity_count ?? '0', 10),
    daysSinceLastActivity: row?.last_activity_at
      ? Math.floor((now - row.last_activity_at.getTime()) / (1000 * 60 * 60 * 24))
      : null,
    distinctContactsEngaged: parseInt(row?.distinct_contacts_engaged ?? '0', 10),
    engagedContactTitles: row?.engaged_contact_titles ?? [],
  };
}

/** Frequency component: more recent activity in the window → higher score, saturating at 8+. */
function scoreFrequency(recentActivityCount: number): number {
  const SATURATION_COUNT = 8;
  return Math.min(recentActivityCount / SATURATION_COUNT, 1) * 100;
}

/** Recency component: no activity ever → 0; activity today → 100; decays linearly over the window. */
function scoreRecency(daysSinceLastActivity: number | null, windowDays: number): number {
  if (daysSinceLastActivity === null) return 0;
  if (daysSinceLastActivity <= 0) return 100;
  return Math.max(0, 100 - (daysSinceLastActivity / windowDays) * 100);
}

/** Seniority component: average seniority tier weight across distinct engaged contacts. */
function scoreSeniority(engagedContactTitles: Array<string | null>): number {
  if (engagedContactTitles.length === 0) return 0;
  const weights = engagedContactTitles.map(
    (title) => SENIORITY_TIER_WEIGHT[classifySeniority(title)],
  );
  const average = weights.reduce((sum, w) => sum + w, 0) / weights.length;
  return average * 100;
}

/** Sentiment component: warming → 100, stable → 60, cooling → 20, no data → neutral midpoint. */
function scoreSentiment(trend: 'warming' | 'stable' | 'cooling' | null): number {
  if (trend === 'warming') return 100;
  if (trend === 'stable') return 60;
  if (trend === 'cooling') return 20;
  return 50;
}

/** Breadth component: single contact → low score (feeds single-threaded risk); more contacts → higher. */
function scoreBreadth(distinctContactsEngaged: number): number {
  const SATURATION_COUNT = 4;
  return Math.min(distinctContactsEngaged / SATURATION_COUNT, 1) * 100;
}

function scoreToState(score: number, config: ScoringConfigRow): AccountHealthState {
  const strong = parseFloat(config.strong_threshold);
  const healthy = parseFloat(config.healthy_threshold);
  const cooling = parseFloat(config.cooling_threshold);
  const atRisk = parseFloat(config.at_risk_threshold);
  if (score >= strong) return 'strong';
  if (score >= healthy) return 'healthy';
  if (score >= cooling) return 'cooling';
  if (score >= atRisk) return 'at_risk';
  return 'dormant';
}

/**
 * Builds the top 2-3 contributing factors in plain language, most impactful first,
 * for the "Why this score?" tooltip.
 */
function buildContributingFactors(
  aggregates: AccountAggregates,
  componentScores: { frequency: number; recency: number; seniority: number; sentiment: number },
  hasSufficientSentimentData: boolean,
): AccountHealthFactor[] {
  const candidates: Array<{ factor: AccountHealthFactor; impact: number }> = [];

  if (aggregates.daysSinceLastActivity === null) {
    candidates.push({ factor: { description: 'No logged activity on record' }, impact: 100 });
  } else if (aggregates.daysSinceLastActivity > 30) {
    candidates.push({
      factor: { description: `No contact in ${aggregates.daysSinceLastActivity} days` },
      impact: 100 - componentScores.recency,
    });
  } else if (componentScores.recency >= 80) {
    candidates.push({
      factor: { description: 'Recent activity logged' },
      impact: componentScores.recency,
    });
  }

  if (aggregates.recentActivityCount <= 1) {
    candidates.push({
      factor: { description: 'Very low communication frequency' },
      impact: 100 - componentScores.frequency,
    });
  } else if (componentScores.frequency >= 80) {
    candidates.push({
      factor: { description: 'Strong communication frequency' },
      impact: componentScores.frequency,
    });
  }

  if (componentScores.seniority <= 30 && aggregates.engagedContactTitles.length > 0) {
    candidates.push({
      factor: { description: 'Engagement limited to junior contacts' },
      impact: 100 - componentScores.seniority,
    });
  } else if (componentScores.seniority >= 70) {
    candidates.push({
      factor: { description: 'Senior/executive contacts engaged' },
      impact: componentScores.seniority,
    });
  }

  if (hasSufficientSentimentData) {
    if (componentScores.sentiment <= 30) {
      candidates.push({
        factor: { description: 'Sentiment trend is cooling' },
        impact: 100 - componentScores.sentiment,
      });
    } else if (componentScores.sentiment >= 80) {
      candidates.push({
        factor: { description: 'Sentiment trend is warming' },
        impact: componentScores.sentiment,
      });
    }
  }

  if (aggregates.distinctContactsEngaged <= 1) {
    candidates.push({
      factor: { description: 'Single point of contact — no other engaged stakeholders' },
      impact: 90,
    });
  }

  return candidates
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3)
    .map((c) => c.factor);
}

interface ComputedScore {
  score: number;
  state: AccountHealthState;
  singleThreadedRisk: boolean;
  contributingFactors: AccountHealthFactor[];
}

async function computeScoreForAccount(
  account: AccountCandidate,
  config: ScoringConfigRow,
): Promise<ComputedScore | null> {
  if (account.totalLoggedActivities < config.min_logged_activities) {
    return null;
  }

  const aggregates = await gatherAccountAggregates(account.id, config);
  const sentimentTrend = await getAccountSentimentTrend(account.id);

  const componentScores = {
    frequency: scoreFrequency(aggregates.recentActivityCount),
    recency: scoreRecency(aggregates.daysSinceLastActivity, config.recency_window_days),
    seniority: scoreSeniority(aggregates.engagedContactTitles),
    sentiment: scoreSentiment(sentimentTrend.has_sufficient_data ? sentimentTrend.trend : null),
  };
  const breadthScore = scoreBreadth(aggregates.distinctContactsEngaged);

  const weightedScore =
    componentScores.frequency * parseFloat(config.frequency_weight) +
    componentScores.recency * parseFloat(config.recency_weight) +
    componentScores.seniority * parseFloat(config.seniority_weight) +
    componentScores.sentiment * parseFloat(config.sentiment_weight) +
    breadthScore * parseFloat(config.breadth_weight);

  const score = Math.round(weightedScore * 100) / 100;
  const state = scoreToState(score, config);
  const singleThreadedRisk = aggregates.distinctContactsEngaged <= 1;

  const contributingFactors = buildContributingFactors(
    aggregates,
    componentScores,
    sentimentTrend.has_sufficient_data,
  );

  return { score, state, singleThreadedRisk, contributingFactors };
}

async function persistScore(
  account: AccountCandidate,
  previousState: AccountHealthState | null,
  computed: ComputedScore,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO account_health_scores
         (account_id, score, state, single_threaded_risk, contributing_factors, computed_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (account_id) DO UPDATE SET
         score = EXCLUDED.score,
         state = EXCLUDED.state,
         single_threaded_risk = EXCLUDED.single_threaded_risk,
         contributing_factors = EXCLUDED.contributing_factors,
         computed_at = EXCLUDED.computed_at`,
      [
        account.id,
        computed.score,
        computed.state,
        computed.singleThreadedRisk,
        JSON.stringify(computed.contributingFactors),
      ],
    );

    await client.query(
      `INSERT INTO account_health_score_history (account_id, score, state, computed_at)
       VALUES ($1, $2, $3, now())`,
      [account.id, computed.score, computed.state],
    );

    if (previousState !== computed.state) {
      await writeAuditEntry(client, {
        recordType: 'account',
        recordId: account.id,
        recordName: account.name,
        eventType: 'updated',
        fieldName: 'relationship_health_state',
        oldValue: previousState,
        newValue: computed.state,
        changedById: SYSTEM_ACTOR.id,
        changedByName: SYSTEM_ACTOR.name,
      });
    }
  });
}

/**
 * Nightly cron entry point. Scores every account with at least one logged
 * activity, skipping accounts below the minimum logged-activity threshold
 * (their prior cached score, if any, is left as-is — insufficient data going
 * forward doesn't retroactively erase a previously valid score). No-ops
 * per-account on error so one bad account doesn't abort the run.
 */
export async function computeAccountHealthScores(): Promise<void> {
  const config = await getScoringConfig();
  const accounts = await gatherCandidateAccounts();
  logger.info({ accountCount: accounts.length }, 'relationshipHealth: nightly run starting');

  for (const account of accounts) {
    try {
      const computed = await computeScoreForAccount(account, config);
      if (!computed) continue;

      const existing = await pool.query<{ state: AccountHealthState }>(
        `SELECT state FROM account_health_scores WHERE account_id = $1`,
        [account.id],
      );
      const previousState = existing.rows[0]?.state ?? null;

      await persistScore(account, previousState, computed);
    } catch (err) {
      logger.error({ err, accountId: account.id }, 'relationshipHealth: failed to score account');
    }
  }

  logger.info('relationshipHealth: nightly run complete');
}

function toScoreResponse(row: {
  account_id: string;
  score: string;
  state: AccountHealthState;
  single_threaded_risk: boolean;
  contributing_factors: AccountHealthFactor[];
  computed_at: Date;
}): AccountHealthScoreResponse {
  return {
    account_id: row.account_id,
    score: parseFloat(row.score),
    state: row.state,
    single_threaded_risk: row.single_threaded_risk,
    contributing_factors: row.contributing_factors,
    computed_at: row.computed_at.toISOString(),
  };
}

/** Returns the cached health score for an account, or null when no score has been computed yet. */
export async function getAccountHealthScore(
  accountId: string,
): Promise<AccountHealthScoreResponse | null> {
  const result = await pool.query<{
    account_id: string;
    score: string;
    state: AccountHealthState;
    single_threaded_risk: boolean;
    contributing_factors: AccountHealthFactor[];
    computed_at: Date;
  }>(
    `SELECT account_id, score, state, single_threaded_risk, contributing_factors, computed_at
     FROM account_health_scores
     WHERE account_id = $1`,
    [accountId],
  );
  const row = result.rows[0];
  return row ? toScoreResponse(row) : null;
}

/** Returns up to 6 months of score history for the trend sparkline. */
export async function getAccountHealthHistory(
  accountId: string,
): Promise<AccountHealthHistoryResponse> {
  const result = await pool.query<{ score: string; state: AccountHealthState; computed_at: Date }>(
    `SELECT score, state, computed_at
     FROM account_health_score_history
     WHERE account_id = $1 AND computed_at >= now() - ($2 || ' months')::interval
     ORDER BY computed_at ASC`,
    [accountId, HISTORY_MONTHS],
  );
  return {
    account_id: accountId,
    points: result.rows.map((row) => ({
      score: parseFloat(row.score),
      state: row.state,
      computed_at: row.computed_at.toISOString(),
    })),
  };
}

/** Returns the admin-editable scoring weights/thresholds. */
export async function getAccountHealthScoringConfig(): Promise<AccountHealthScoringConfig> {
  const row = await getScoringConfig();
  return {
    frequency_weight: parseFloat(row.frequency_weight),
    recency_weight: parseFloat(row.recency_weight),
    seniority_weight: parseFloat(row.seniority_weight),
    sentiment_weight: parseFloat(row.sentiment_weight),
    breadth_weight: parseFloat(row.breadth_weight),
    strong_threshold: parseFloat(row.strong_threshold),
    healthy_threshold: parseFloat(row.healthy_threshold),
    cooling_threshold: parseFloat(row.cooling_threshold),
    at_risk_threshold: parseFloat(row.at_risk_threshold),
    min_logged_activities: row.min_logged_activities,
    recency_window_days: row.recency_window_days,
    single_threaded_window_days: row.single_threaded_window_days,
    updated_at: row.updated_at.toISOString(),
  };
}

/** Updates the admin-editable scoring weights/thresholds. Admin only. */
export async function setAccountHealthScoringConfig(
  input: {
    frequency_weight: number;
    recency_weight: number;
    seniority_weight: number;
    sentiment_weight: number;
    breadth_weight: number;
    strong_threshold: number;
    healthy_threshold: number;
    cooling_threshold: number;
    at_risk_threshold: number;
    min_logged_activities: number;
    recency_window_days: number;
    single_threaded_window_days: number;
  },
  actorId: string,
): Promise<AccountHealthScoringConfig> {
  await pool.query(
    `UPDATE account_health_scoring_config SET
       frequency_weight = $1, recency_weight = $2, seniority_weight = $3,
       sentiment_weight = $4, breadth_weight = $5, strong_threshold = $6,
       healthy_threshold = $7, cooling_threshold = $8, at_risk_threshold = $9,
       min_logged_activities = $10, recency_window_days = $11,
       single_threaded_window_days = $12, updated_at = now(), updated_by = $13
     WHERE id = true`,
    [
      input.frequency_weight,
      input.recency_weight,
      input.seniority_weight,
      input.sentiment_weight,
      input.breadth_weight,
      input.strong_threshold,
      input.healthy_threshold,
      input.cooling_threshold,
      input.at_risk_threshold,
      input.min_logged_activities,
      input.recency_window_days,
      input.single_threaded_window_days,
      actorId,
    ],
  );
  return getAccountHealthScoringConfig();
}
