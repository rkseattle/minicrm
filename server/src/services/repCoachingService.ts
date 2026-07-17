/**
 * Rep coaching insights service — nightly job that computes per-rep coaching
 * insights from activity patterns and deal outcomes, compared against team
 * averages. (MINCRM-474)
 *
 * generateRepCoachingInsights() is the cron entry point (server/src/server.ts).
 * Deterministic and SQL-driven, not an LLM call: every metric here is a
 * statistical comparison against a team average, not a judgment call requiring
 * model inference — matching relationshipHealthService's precedent (nightly,
 * no LLM call) rather than churnExpansionService's (nightly, forced-tool LLM
 * call). Observations and recommended actions are generated from fixed
 * templates per metric type, so results are fully reproducible and cheap to
 * compute at scale.
 *
 * Per the ticket's explicit privacy requirement, this feature has no NLI tool
 * definition anywhere in server/src/ai/tools/ — omission is the established
 * pattern for privacy-sensitive AI insights (see relationshipHealthService,
 * which is likewise never exposed to NLI). No data leaves this process; there
 * is no external AI provider call in this service at all.
 *
 * Two metric shapes:
 *   - Whole-rep metrics (avg_stage_days, activity_frequency,
 *     response_time_after_activity, objection_frequency): one row per rep,
 *     segment = ''.
 *   - Breakdown metrics (stage_conversion_rate, deal_size_distribution,
 *     win_rate_by_industry, win_rate_by_lead_source): one row per rep per
 *     segment (stage name / size bucket / industry / lead source). Each
 *     segment's outlier flag is evaluated against that segment's own team
 *     average, not the rep's overall average — a rep can be an outlier in one
 *     industry without being one org-wide.
 *
 * Follows the relationshipHealthService/retentionService nightly-job shape:
 * single exported async function, per-rep error isolation, structured logger
 * calls, upsert current-state table + append-only history table.
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { SYSTEM_ACTOR, writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import { getTeamIdsForManager, getTeamMemberIds } from './teamService.js';
import type {
  RepCoachingInsight,
  RepCoachingInsightsResponse,
  RepCoachingMetricType,
  CoachingTeamOverviewResponse,
} from '@minicrm/shared/schemas/repCoachingSchema.js';
import type {
  SetRepCoachingConfigInput,
  RepCoachingConfigResponse,
} from '@minicrm/shared/schemas/settingsSchema.js';

/** Sentinel segment value for whole-rep metrics — see migration 153's column comment. */
const NO_SEGMENT = '';

/** Deal size buckets for deal_size_distribution, in ascending order. */
const DEAL_SIZE_BUCKETS: Array<{ label: string; min: number; max: number | null }> = [
  { label: 'under_10k', min: 0, max: 10_000 },
  { label: '10k_50k', min: 10_000, max: 50_000 },
  { label: '50k_250k', min: 50_000, max: 250_000 },
  { label: 'over_250k', min: 250_000, max: null },
];

function bucketForValue(value: number): string {
  for (const bucket of DEAL_SIZE_BUCKETS) {
    if (value >= bucket.min && (bucket.max === null || value < bucket.max)) return bucket.label;
  }
  // Unreachable: DEAL_SIZE_BUCKETS' last entry has max: null, covering [250k, +inf).
  // Non-negative deal values (enforced at the schema level) always match a bucket above.
  return DEAL_SIZE_BUCKETS[DEAL_SIZE_BUCKETS.length - 1].label;
}

interface ScoringConfig {
  min_closed_deals: number;
  stage_time_outlier_ratio: number;
  activity_frequency_outlier_ratio: number;
  response_time_outlier_hours: number;
  win_rate_outlier_delta: number;
}

async function getScoringConfig(): Promise<ScoringConfig> {
  const result = await pool.query<ScoringConfig>(
    `SELECT min_closed_deals, stage_time_outlier_ratio, activity_frequency_outlier_ratio,
            response_time_outlier_hours, win_rate_outlier_delta
     FROM rep_coaching_scoring_config
     LIMIT 1`,
  );
  // Safe: singleton row seeded by migration 153, id = true is a NOT NULL PK.
  return result.rows[0]!;
}

interface RepRow {
  id: string;
  name: string;
}

async function listReps(): Promise<RepRow[]> {
  const result = await pool.query<RepRow>(
    `SELECT id, name FROM users WHERE role IN ('rep', 'manager') AND status = 'active'`,
  );
  return result.rows;
}

/** Per-rep closed-deal count, used for the min-closed-deals gate. */
async function getClosedDealCounts(): Promise<Map<string, number>> {
  const result = await pool.query<{ owner_id: string; count: string }>(
    `SELECT owner_id, COUNT(*)::text AS count
     FROM deals
     WHERE stage IN ('Closed Won', 'Closed Lost')
     GROUP BY owner_id`,
  );
  return new Map(result.rows.map((r) => [r.owner_id, parseInt(r.count, 10)]));
}

// ── Whole-rep metric gatherers (one value per rep) ──────────────────────────

/** Average days a rep's deals spend in each stage, derived from deal_stage_history. */
async function getAvgStageDaysByRep(): Promise<Map<string, number>> {
  const result = await pool.query<{ owner_id: string; avg_days: string | null }>(
    `WITH stage_durations AS (
       SELECT h.deal_id, d.owner_id, h.stage, h.entered_at,
              LEAD(h.entered_at) OVER (PARTITION BY h.deal_id ORDER BY h.entered_at) AS next_entered_at
       FROM deal_stage_history h
       JOIN deals d ON d.id = h.deal_id
     )
     SELECT owner_id,
            AVG(EXTRACT(EPOCH FROM (COALESCE(next_entered_at, now()) - entered_at)) / 86400.0)::text AS avg_days
     FROM stage_durations
     GROUP BY owner_id`,
  );
  return new Map(
    result.rows
      .filter((r) => r.avg_days !== null)
      .map((r) => [r.owner_id, parseFloat(r.avg_days as string)]),
  );
}

/** Activities logged per rep per day since their first activity. */
async function getActivityFrequencyByRep(): Promise<Map<string, number>> {
  const result = await pool.query<{ owner_id: string; per_day: string | null }>(
    `SELECT owner_id,
            (COUNT(*)::numeric / GREATEST(1, EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 86400.0))::text AS per_day
     FROM activities
     GROUP BY owner_id`,
  );
  return new Map(
    result.rows
      .filter((r) => r.per_day !== null)
      .map((r) => [r.owner_id, parseFloat(r.per_day as string)]),
  );
}

/**
 * Median hours between consecutive activities logged against the same deal,
 * per rep. No explicit reply/thread-tracking field exists in this schema —
 * this is a defensible proxy for "how quickly the rep follows up", not a
 * literal inbound-to-outbound response measurement.
 */
async function getResponseTimeHoursByRep(): Promise<Map<string, number>> {
  const result = await pool.query<{ owner_id: string; median_hours: string | null }>(
    `WITH gaps AS (
       SELECT owner_id, deal_id,
              EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (PARTITION BY deal_id ORDER BY created_at))) / 3600.0 AS gap_hours
       FROM activities
       WHERE deal_id IS NOT NULL
     )
     SELECT owner_id,
            (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_hours))::text AS median_hours
     FROM gaps
     WHERE gap_hours IS NOT NULL
     GROUP BY owner_id`,
  );
  return new Map(
    result.rows
      .filter((r) => r.median_hours !== null)
      .map((r) => [r.owner_id, parseFloat(r.median_hours as string)]),
  );
}

/** Objections logged per rep as a fraction of their activities (matches winLossAnalysisService's ILIKE convention). */
async function getObjectionFrequencyByRep(): Promise<Map<string, number>> {
  const result = await pool.query<{ owner_id: string; frequency: string | null }>(
    `SELECT owner_id,
            (COUNT(*) FILTER (WHERE notes ILIKE '%objection%'))::numeric / GREATEST(1, COUNT(*)::numeric) AS frequency
     FROM activities
     GROUP BY owner_id`,
  );
  return new Map(
    result.rows
      .filter((r) => r.frequency !== null)
      .map((r) => [r.owner_id, parseFloat(r.frequency as string)]),
  );
}

// ── Breakdown metric gatherers (one value per rep per segment) ─────────────

interface SegmentValue {
  ownerId: string;
  segment: string;
  value: number;
}

/**
 * Per-rep, per-stage advance rate: of the deals a rep has ever moved into a
 * given stage, what fraction advanced to a later stage (rather than staying,
 * or the deal being lost) — the closest honest reading of "stage conversion
 * rate" this schema supports, derived from deal_stage_history's ordered
 * per-deal stage sequence.
 */
async function getStageConversionRateByRep(): Promise<SegmentValue[]> {
  const result = await pool.query<{ owner_id: string; stage: string; rate: string }>(
    `WITH ordered AS (
       SELECT h.deal_id, d.owner_id, h.stage, h.entered_at,
              LEAD(h.entered_at) OVER (PARTITION BY h.deal_id ORDER BY h.entered_at) IS NOT NULL AS advanced
       FROM deal_stage_history h
       JOIN deals d ON d.id = h.deal_id
     )
     SELECT owner_id, stage,
            (COUNT(*) FILTER (WHERE advanced))::numeric / COUNT(*)::numeric AS rate
     FROM ordered
     GROUP BY owner_id, stage`,
  );
  return result.rows.map((r) => ({
    ownerId: r.owner_id,
    segment: r.stage,
    value: parseFloat(r.rate),
  }));
}

/** Fraction of a rep's closed deals falling in each deal-size bucket. */
async function getDealSizeDistributionByRep(): Promise<SegmentValue[]> {
  const result = await pool.query<{ owner_id: string; value: string | null }>(
    `SELECT owner_id, value
     FROM deals
     WHERE stage IN ('Closed Won', 'Closed Lost') AND value IS NOT NULL`,
  );

  const totalsByRep = new Map<string, number>();
  const bucketCounts = new Map<string, Map<string, number>>();

  for (const row of result.rows) {
    if (row.value === null) continue;
    const amount = parseFloat(row.value);
    const bucket = bucketForValue(amount);

    totalsByRep.set(row.owner_id, (totalsByRep.get(row.owner_id) ?? 0) + 1);
    if (!bucketCounts.has(row.owner_id)) bucketCounts.set(row.owner_id, new Map());
    const repBuckets = bucketCounts.get(row.owner_id)!;
    repBuckets.set(bucket, (repBuckets.get(bucket) ?? 0) + 1);
  }

  const segmentValues: SegmentValue[] = [];
  for (const [ownerId, repBuckets] of bucketCounts) {
    const total = totalsByRep.get(ownerId) ?? 0;
    if (total === 0) continue;
    for (const bucket of DEAL_SIZE_BUCKETS) {
      const count = repBuckets.get(bucket.label) ?? 0;
      segmentValues.push({ ownerId, segment: bucket.label, value: count / total });
    }
  }
  return segmentValues;
}

/** Win rate per rep per account industry. */
async function getWinRateByIndustryByRep(): Promise<SegmentValue[]> {
  const result = await pool.query<{ owner_id: string; industry: string; rate: string }>(
    `SELECT d.owner_id, a.industry,
            (COUNT(*) FILTER (WHERE d.stage = 'Closed Won'))::numeric / COUNT(*)::numeric AS rate
     FROM deals d
     JOIN accounts a ON a.id = d.account_id
     WHERE d.stage IN ('Closed Won', 'Closed Lost') AND a.industry IS NOT NULL
     GROUP BY d.owner_id, a.industry`,
  );
  return result.rows.map((r) => ({
    ownerId: r.owner_id,
    segment: r.industry,
    value: parseFloat(r.rate),
  }));
}

/** Win rate per rep per lead source (matches winLossAnalysisService's leads join). */
async function getWinRateByLeadSourceByRep(): Promise<SegmentValue[]> {
  const result = await pool.query<{ owner_id: string; lead_source: string; rate: string }>(
    `SELECT d.owner_id, l.lead_source,
            (COUNT(*) FILTER (WHERE d.stage = 'Closed Won'))::numeric / COUNT(*)::numeric AS rate
     FROM deals d
     JOIN leads l ON l.id = d.source_lead_id
     WHERE d.stage IN ('Closed Won', 'Closed Lost') AND l.lead_source IS NOT NULL
     GROUP BY d.owner_id, l.lead_source`,
  );
  return result.rows.map((r) => ({
    ownerId: r.owner_id,
    segment: r.lead_source,
    value: parseFloat(r.rate),
  }));
}

// ── Metric definitions ───────────────────────────────────────────────────────

interface ScoredInsight {
  metricType: RepCoachingMetricType;
  segment: string;
  repValue: number;
  teamAverage: number;
  isOutlier: boolean;
  observation: string;
  recommendedAction: string;
}

interface WholeRepMetricDefinition {
  metricType: RepCoachingMetricType;
  values: Map<string, number>;
  isOutlier(repValue: number, teamAverage: number, config: ScoringConfig): boolean;
  observation(repName: string, repValue: number, teamAverage: number): string;
  recommendedAction(): string;
}

interface BreakdownMetricDefinition {
  metricType: RepCoachingMetricType;
  values: SegmentValue[];
  isOutlier(repValue: number, teamAverage: number, config: ScoringConfig): boolean;
  observation(repName: string, segment: string, repValue: number, teamAverage: number): string;
  recommendedAction(segment: string): string;
}

function buildWholeRepMetrics(
  avgStageDays: Map<string, number>,
  activityFrequency: Map<string, number>,
  responseTimeHours: Map<string, number>,
  objectionFrequency: Map<string, number>,
): WholeRepMetricDefinition[] {
  return [
    {
      metricType: 'avg_stage_days',
      values: avgStageDays,
      isOutlier: (repValue, teamAverage, config) =>
        teamAverage > 0 && repValue >= teamAverage * config.stage_time_outlier_ratio,
      observation: (repName, repValue, teamAverage) =>
        `${repName}'s deals spend an average of ${repValue.toFixed(1)} days per stage vs. the team average of ${teamAverage.toFixed(1)}.`,
      recommendedAction: () =>
        'Consider reviewing where deals are stalling and adding a follow-up task at a fixed day count into each stage.',
    },
    {
      metricType: 'activity_frequency',
      values: activityFrequency,
      isOutlier: (repValue, teamAverage, config) =>
        teamAverage > 0 && repValue <= teamAverage * config.activity_frequency_outlier_ratio,
      observation: (repName, repValue, teamAverage) =>
        `${repName} logs ${repValue.toFixed(2)} activities/day vs. the team average of ${teamAverage.toFixed(2)}.`,
      recommendedAction: () => 'Consider a check-in on pipeline coverage and activity cadence.',
    },
    {
      metricType: 'response_time_after_activity',
      values: responseTimeHours,
      isOutlier: (repValue, teamAverage, config) => repValue >= config.response_time_outlier_hours,
      observation: (repName, repValue, teamAverage) =>
        `${repName} typically follows up ${repValue.toFixed(0)} hours after the previous activity on a deal vs. the team average of ${teamAverage.toFixed(0)} hours.`,
      recommendedAction: () =>
        'Consider setting a follow-up reminder within 24-48 hours of each logged activity.',
    },
    {
      metricType: 'objection_frequency',
      values: objectionFrequency,
      isOutlier: (repValue, teamAverage, config) =>
        teamAverage > 0 && repValue >= teamAverage * config.stage_time_outlier_ratio,
      observation: (repName, repValue, teamAverage) =>
        `${repName} logs objections on ${(repValue * 100).toFixed(0)}% of activities vs. the team average of ${(teamAverage * 100).toFixed(0)}%.`,
      recommendedAction: () =>
        'Consider a coaching session on objection handling, using recent logged objections as source material.',
    },
  ];
}

function buildBreakdownMetrics(
  stageConversionRate: SegmentValue[],
  dealSizeDistribution: SegmentValue[],
  winRateByIndustry: SegmentValue[],
  winRateByLeadSource: SegmentValue[],
): BreakdownMetricDefinition[] {
  return [
    {
      metricType: 'stage_conversion_rate',
      values: stageConversionRate,
      isOutlier: (repValue, teamAverage, config) =>
        teamAverage - repValue >= config.win_rate_outlier_delta,
      observation: (repName, segment, repValue, teamAverage) =>
        `${repName} advances ${(repValue * 100).toFixed(0)}% of deals out of ${segment} vs. the team average of ${(teamAverage * 100).toFixed(0)}%.`,
      recommendedAction: (segment) =>
        `Consider reviewing deals stalling in ${segment} for a common blocker.`,
    },
    {
      metricType: 'deal_size_distribution',
      values: dealSizeDistribution,
      // Distribution buckets are descriptive, not good/bad — never flagged as outliers.
      isOutlier: () => false,
      observation: (repName, segment, repValue) =>
        `${(repValue * 100).toFixed(0)}% of ${repName}'s closed deals fall in the ${segment.replace(/_/g, ' ')} range.`,
      recommendedAction: () =>
        'Use this distribution to calibrate deal-size expectations in coaching conversations.',
    },
    {
      metricType: 'win_rate_by_industry',
      values: winRateByIndustry,
      isOutlier: (repValue, teamAverage, config) =>
        teamAverage - repValue >= config.win_rate_outlier_delta,
      observation: (repName, segment, repValue, teamAverage) =>
        `${repName}'s win rate in ${segment} is ${(repValue * 100).toFixed(0)}% vs. the team average of ${(teamAverage * 100).toFixed(0)}%.`,
      recommendedAction: (segment) =>
        `Consider pairing with a rep who performs well in ${segment} for a deal review.`,
    },
    {
      metricType: 'win_rate_by_lead_source',
      values: winRateByLeadSource,
      isOutlier: (repValue, teamAverage, config) =>
        teamAverage - repValue >= config.win_rate_outlier_delta,
      observation: (repName, segment, repValue, teamAverage) =>
        `${repName}'s win rate on ${segment} leads is ${(repValue * 100).toFixed(0)}% vs. the team average of ${(teamAverage * 100).toFixed(0)}%.`,
      recommendedAction: (segment) =>
        `Consider reviewing qualification criteria for ${segment} leads.`,
    },
  ];
}

/**
 * Nightly cron entry point. Recomputes coaching insights for every rep with
 * at least min_closed_deals closed deals, comparing each metric (and, for
 * breakdown metrics, each segment) to the team average and flagging outliers.
 * Replaces rep_coaching_insights per rep/metric/segment (upsert) and appends a
 * row to rep_coaching_insight_history. No-ops per-rep on error so one bad rep
 * doesn't abort the whole run.
 */
export async function generateRepCoachingInsights(): Promise<void> {
  const config = await getScoringConfig();
  const reps = await listReps();
  const closedDealCounts = await getClosedDealCounts();

  const eligibleReps = reps.filter(
    (rep) => (closedDealCounts.get(rep.id) ?? 0) >= config.min_closed_deals,
  );

  logger.info(
    { totalReps: reps.length, eligibleReps: eligibleReps.length },
    'repCoaching: nightly run starting',
  );

  if (eligibleReps.length === 0) {
    logger.info('repCoaching: no reps met the minimum closed-deal threshold');
    return;
  }
  const eligibleRepIds = new Set(eligibleReps.map((r) => r.id));

  const [avgStageDays, activityFrequency, responseTimeHours, objectionFrequency] =
    await Promise.all([
      getAvgStageDaysByRep(),
      getActivityFrequencyByRep(),
      getResponseTimeHoursByRep(),
      getObjectionFrequencyByRep(),
    ]);
  const [stageConversionRate, dealSizeDistribution, winRateByIndustry, winRateByLeadSource] =
    await Promise.all([
      getStageConversionRateByRep(),
      getDealSizeDistributionByRep(),
      getWinRateByIndustryByRep(),
      getWinRateByLeadSourceByRep(),
    ]);

  const wholeRepMetrics = buildWholeRepMetrics(
    avgStageDays,
    activityFrequency,
    responseTimeHours,
    objectionFrequency,
  );
  const breakdownMetrics = buildBreakdownMetrics(
    stageConversionRate,
    dealSizeDistribution,
    winRateByIndustry,
    winRateByLeadSource,
  );

  // Team averages computed across eligible reps only — comparing a coachable
  // rep against reps with insufficient data would be noisy. Whole-rep metrics
  // average one value per rep; breakdown metrics average per segment.
  const wholeRepTeamAverages = new Map<RepCoachingMetricType, number>();
  for (const metric of wholeRepMetrics) {
    const values = [...metric.values.entries()]
      .filter(([repId]) => eligibleRepIds.has(repId))
      .map(([, value]) => value);
    wholeRepTeamAverages.set(
      metric.metricType,
      values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
    );
  }

  const breakdownTeamAverages = new Map<string, number>();
  for (const metric of breakdownMetrics) {
    const bySegment = new Map<string, number[]>();
    for (const entry of metric.values) {
      if (!eligibleRepIds.has(entry.ownerId)) continue;
      if (!bySegment.has(entry.segment)) bySegment.set(entry.segment, []);
      // Safe: the line above guarantees `entry.segment` is present before this lookup.
      bySegment.get(entry.segment)!.push(entry.value);
    }
    for (const [segment, values] of bySegment) {
      const key = `${metric.metricType}:${segment}`;
      breakdownTeamAverages.set(key, values.reduce((a, b) => a + b, 0) / values.length);
    }
  }

  for (const rep of eligibleReps) {
    try {
      const scored = scoreRep(
        rep,
        wholeRepMetrics,
        breakdownMetrics,
        wholeRepTeamAverages,
        breakdownTeamAverages,
        config,
      );
      await persistRepInsights(rep, closedDealCounts.get(rep.id) ?? 0, scored);
    } catch (err) {
      logger.error({ err, repId: rep.id }, 'repCoaching: failed to process rep');
    }
  }

  logger.info('repCoaching: nightly run complete');
}

function scoreRep(
  rep: RepRow,
  wholeRepMetrics: WholeRepMetricDefinition[],
  breakdownMetrics: BreakdownMetricDefinition[],
  wholeRepTeamAverages: Map<RepCoachingMetricType, number>,
  breakdownTeamAverages: Map<string, number>,
  config: ScoringConfig,
): ScoredInsight[] {
  const scored: ScoredInsight[] = [];

  for (const metric of wholeRepMetrics) {
    const repValue = metric.values.get(rep.id);
    if (repValue === undefined) continue;
    const teamAverage = wholeRepTeamAverages.get(metric.metricType) ?? 0;
    scored.push({
      metricType: metric.metricType,
      segment: NO_SEGMENT,
      repValue,
      teamAverage,
      isOutlier: metric.isOutlier(repValue, teamAverage, config),
      observation: metric.observation(rep.name, repValue, teamAverage),
      recommendedAction: metric.recommendedAction(),
    });
  }

  for (const metric of breakdownMetrics) {
    for (const entry of metric.values) {
      if (entry.ownerId !== rep.id) continue;
      const teamAverage = breakdownTeamAverages.get(`${metric.metricType}:${entry.segment}`) ?? 0;
      scored.push({
        metricType: metric.metricType,
        segment: entry.segment,
        repValue: entry.value,
        teamAverage,
        isOutlier: metric.isOutlier(entry.value, teamAverage, config),
        observation: metric.observation(rep.name, entry.segment, entry.value, teamAverage),
        recommendedAction: metric.recommendedAction(entry.segment),
      });
    }
  }

  return scored;
}

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

async function persistRepInsights(
  rep: RepRow,
  closedDealCount: number,
  scored: ScoredInsight[],
): Promise<void> {
  await withTransaction(async (client) => {
    for (const insight of scored) {
      await client.query(
        `INSERT INTO rep_coaching_insights
           (rep_id, metric_type, segment, observation, recommended_action, rep_value, team_average_value, is_outlier, closed_deal_count, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (rep_id, metric_type, segment) DO UPDATE SET
           observation = EXCLUDED.observation,
           recommended_action = EXCLUDED.recommended_action,
           rep_value = EXCLUDED.rep_value,
           team_average_value = EXCLUDED.team_average_value,
           is_outlier = EXCLUDED.is_outlier,
           closed_deal_count = EXCLUDED.closed_deal_count,
           computed_at = now()`,
        [
          rep.id,
          insight.metricType,
          insight.segment,
          insight.observation,
          insight.recommendedAction,
          insight.repValue,
          insight.teamAverage,
          insight.isOutlier,
          closedDealCount,
        ],
      );

      await client.query(
        `INSERT INTO rep_coaching_insight_history
           (rep_id, metric_type, segment, rep_value, team_average_value, is_outlier)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          rep.id,
          insight.metricType,
          insight.segment,
          insight.repValue,
          insight.teamAverage,
          insight.isOutlier,
        ],
      );
    }

    await writeAuditEntry(client, {
      recordType: 'ai_settings',
      recordId: rep.id,
      recordName: `Coaching insights: ${rep.name}`,
      eventType: 'updated',
      fieldName: 'nightly_coaching_analysis',
      oldValue: null,
      newValue: `${scored.length} insight row(s) recomputed`,
      changedById: SYSTEM_ACTOR.id,
      changedByName: SYSTEM_ACTOR.name,
    });
  });
}

function toInsight(row: {
  id: string;
  metric_type: string;
  segment: string;
  observation: string;
  recommended_action: string;
  rep_value: string;
  team_average_value: string;
  is_outlier: boolean;
  closed_deal_count: number;
  computed_at: Date;
}): RepCoachingInsight {
  return {
    id: row.id,
    metric_type: row.metric_type as RepCoachingMetricType,
    segment: row.segment === NO_SEGMENT ? null : row.segment,
    observation: row.observation,
    recommended_action: row.recommended_action,
    rep_value: parseFloat(row.rep_value),
    team_average_value: parseFloat(row.team_average_value),
    is_outlier: row.is_outlier,
    closed_deal_count: row.closed_deal_count,
    computed_at: row.computed_at.toISOString(),
  };
}

/**
 * Returns the cached coaching insights for a single rep. Never computes live.
 * Outlier insights are sorted first per the ticket's "individual outliers
 * surface more prominently" AC.
 */
export async function getRepCoachingInsights(repId: string): Promise<RepCoachingInsightsResponse> {
  const config = await getScoringConfig();

  const repResult = await pool.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
    repId,
  ]);
  const repName = repResult.rows[0]?.name ?? '';

  const closedCountResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM deals WHERE owner_id = $1 AND stage IN ('Closed Won', 'Closed Lost')`,
    [repId],
  );
  const closedDealCount = parseInt(closedCountResult.rows[0]?.count ?? '0', 10);

  const rowsResult = await pool.query(
    `SELECT id, metric_type, segment, observation, recommended_action, rep_value, team_average_value,
            is_outlier, closed_deal_count, computed_at
     FROM rep_coaching_insights
     WHERE rep_id = $1
     ORDER BY is_outlier DESC, computed_at DESC`,
    [repId],
  );

  return {
    rep_id: repId,
    rep_name: repName,
    insights: rowsResult.rows.map(toInsight),
    has_sufficient_data: closedDealCount >= config.min_closed_deals,
    min_closed_deals_required: config.min_closed_deals,
    closed_deal_count: closedDealCount,
  };
}

/**
 * Returns the set of rep IDs a manager may view coaching insights for: all
 * members of teams the manager manages (recursive subtree), plus the manager
 * themselves. Falls back to [managerId] when the manager manages no teams,
 * matching visibilityService.buildTeamScopedFilter's convention. Admins should
 * bypass this and pass null to getCoachingTeamOverview for org-wide access.
 */
export async function getRepIdsVisibleToManager(managerId: string): Promise<string[]> {
  const teamIds = await getTeamIdsForManager(managerId);
  if (teamIds.length === 0) return [managerId];

  const memberIdsPerTeam = await Promise.all(
    teamIds.map((teamId) => getTeamMemberIds(teamId, true)),
  );
  const memberIds = new Set<string>([managerId]);
  for (const ids of memberIdsPerTeam) {
    for (const id of ids) memberIds.add(id);
  }
  return Array.from(memberIds);
}

/**
 * Returns a summary row per visible rep for the manager/admin team overview
 * (rep selector on /insights/coaching). Pass repIds = null for org-wide access
 * (admin); pass a specific list (from getRepIdsVisibleToManager) to scope to a
 * manager's team.
 */
export async function getCoachingTeamOverview(
  repIds: string[] | null,
): Promise<CoachingTeamOverviewResponse> {
  const config = await getScoringConfig();

  const params: unknown[] = [];
  let repFilter = '';
  if (repIds !== null) {
    params.push(repIds);
    repFilter = ` AND u.id = ANY($${params.length})`;
  }

  const result = await pool.query<{
    id: string;
    name: string;
    closed_deal_count: string;
    outlier_metric_count: string;
  }>(
    `SELECT u.id, u.name,
            COALESCE((SELECT COUNT(*) FROM deals d WHERE d.owner_id = u.id AND d.stage IN ('Closed Won', 'Closed Lost')), 0)::text AS closed_deal_count,
            COALESCE((SELECT COUNT(*) FROM rep_coaching_insights i WHERE i.rep_id = u.id AND i.is_outlier = true), 0)::text AS outlier_metric_count
     FROM users u
     WHERE u.role IN ('rep', 'manager') AND u.status = 'active'${repFilter}
     ORDER BY u.name ASC`,
    params,
  );

  return {
    reps: result.rows.map((row) => ({
      rep_id: row.id,
      rep_name: row.name,
      has_sufficient_data: parseInt(row.closed_deal_count, 10) >= config.min_closed_deals,
      closed_deal_count: parseInt(row.closed_deal_count, 10),
      outlier_metric_count: parseInt(row.outlier_metric_count, 10),
    })),
    min_closed_deals_required: config.min_closed_deals,
  };
}

function toConfigResponse(row: {
  min_closed_deals: number;
  stage_time_outlier_ratio: string;
  activity_frequency_outlier_ratio: string;
  response_time_outlier_hours: number;
  win_rate_outlier_delta: string;
  updated_at: Date;
  updated_by: string | null;
}): RepCoachingConfigResponse {
  return {
    min_closed_deals: row.min_closed_deals,
    stage_time_outlier_ratio: parseFloat(row.stage_time_outlier_ratio),
    activity_frequency_outlier_ratio: parseFloat(row.activity_frequency_outlier_ratio),
    response_time_outlier_hours: row.response_time_outlier_hours,
    win_rate_outlier_delta: parseFloat(row.win_rate_outlier_delta),
    updated_at: row.updated_at.toISOString(),
    updated_by: row.updated_by,
  };
}

/** GET /api/v1/admin/ai/coaching-config — returns the current admin-configured thresholds. */
export async function getRepCoachingConfig(): Promise<RepCoachingConfigResponse> {
  const result = await pool.query(
    `SELECT min_closed_deals, stage_time_outlier_ratio, activity_frequency_outlier_ratio,
            response_time_outlier_hours, win_rate_outlier_delta, updated_at, updated_by
     FROM rep_coaching_scoring_config
     LIMIT 1`,
  );
  // Safe: singleton row seeded by migration 153, id = true is a NOT NULL PK.
  return toConfigResponse(result.rows[0]!);
}

/**
 * PATCH /api/v1/admin/ai/coaching-config — updates the admin-configured
 * thresholds. Does not itself trigger a recomputation; the new thresholds
 * take effect on the next nightly run (or the next manual "run now" trigger).
 */
export async function setRepCoachingConfig(
  params: SetRepCoachingConfigInput,
  actor: AuditActor,
): Promise<RepCoachingConfigResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const beforeResult = await client.query<{
      min_closed_deals: number;
      stage_time_outlier_ratio: string;
      activity_frequency_outlier_ratio: string;
      response_time_outlier_hours: number;
      win_rate_outlier_delta: string;
    }>(
      `SELECT min_closed_deals, stage_time_outlier_ratio, activity_frequency_outlier_ratio,
              response_time_outlier_hours, win_rate_outlier_delta
       FROM rep_coaching_scoring_config
       LIMIT 1
       FOR UPDATE`,
    );
    // Safe: singleton row seeded by migration 153, id = true is a NOT NULL PK.
    const before = beforeResult.rows[0]!;

    const afterResult = await client.query<{
      min_closed_deals: number;
      stage_time_outlier_ratio: string;
      activity_frequency_outlier_ratio: string;
      response_time_outlier_hours: number;
      win_rate_outlier_delta: string;
      updated_at: Date;
      updated_by: string | null;
    }>(
      `UPDATE rep_coaching_scoring_config SET
         min_closed_deals = $1,
         stage_time_outlier_ratio = $2,
         activity_frequency_outlier_ratio = $3,
         response_time_outlier_hours = $4,
         win_rate_outlier_delta = $5,
         updated_at = now(),
         updated_by = $6
       WHERE id = true
       RETURNING min_closed_deals, stage_time_outlier_ratio, activity_frequency_outlier_ratio,
                 response_time_outlier_hours, win_rate_outlier_delta, updated_at, updated_by`,
      [
        params.min_closed_deals,
        params.stage_time_outlier_ratio,
        params.activity_frequency_outlier_ratio,
        params.response_time_outlier_hours,
        params.win_rate_outlier_delta,
        actor.id,
      ],
    );
    // Safe: UPDATE ... WHERE id = true always matches the singleton row.
    const after = afterResult.rows[0]!;

    const auditBase = {
      recordType: 'ai_settings' as const,
      recordName: 'Rep Coaching Insights Configuration',
      changedById: actor.id,
      changedByName: actor.name,
    };

    const fieldsToCompare: Array<keyof SetRepCoachingConfigInput> = [
      'min_closed_deals',
      'stage_time_outlier_ratio',
      'activity_frequency_outlier_ratio',
      'response_time_outlier_hours',
      'win_rate_outlier_delta',
    ];
    for (const field of fieldsToCompare) {
      // Postgres numeric columns round-trip as strings with fixed decimal padding
      // (e.g. "1.50"), which never string-equals the JS number's own stringification
      // (e.g. "1.5") even when the value is unchanged — compare as numbers instead,
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
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
