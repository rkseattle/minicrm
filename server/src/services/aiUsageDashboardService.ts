/**
 * AI usage dashboard service — aggregates ai_token_usage_daily for the admin
 * usage/cost dashboard. (MINCRM-459)
 *
 * Reads from ai_token_usage_daily (not ai_token_usage) because it is the only
 * table with day-level and per-feature granularity; ai_token_usage remains the
 * source of truth for monthly budget enforcement and is untouched here.
 *
 * Cost estimates are computed from self-reported token counts × the admin-
 * configured rate in ai_configuration — there is no integration with a
 * provider billing/usage API. See docs/admin-guide.md "AI Usage & Cost
 * Dashboard" for the documented limitation and follow-up plan.
 */

import pool from '../db.js';
import { getEffectiveUserBudget, getUserUsageForMonth } from './aiTokenBudgetService.js';
import type {
  UsageSummaryResponse,
  UsageDailySeriesResponse,
  PerUserUsageRow,
  PerFeatureUsageRow,
  DailyUsagePoint,
} from '@minicrm/shared/schemas/aiUsageSchema.js';

export interface DateRange {
  start: Date;
  end: Date;
}

interface CostRates {
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
}

interface UsageRow {
  input_tokens: string;
  output_tokens: string;
}

interface PerUserRawRow {
  user_id: string;
  user_name: string;
  user_email: string;
  input_tokens: string;
  output_tokens: string;
}

interface PerUserFeatureRawRow {
  user_id: string;
  feature: string;
  total_tokens: string;
}

interface PerFeatureRawRow {
  feature: string;
  input_tokens: string;
  output_tokens: string;
}

interface DailyRawRow {
  usage_date: string;
  input_tokens: string;
  output_tokens: string;
}

function estimateCostCents(inputTokens: number, outputTokens: number, rates: CostRates): number {
  const inputCost = (inputTokens / 1_000_000) * rates.inputCentsPerMillion;
  const outputCost = (outputTokens / 1_000_000) * rates.outputCentsPerMillion;
  return Math.round(inputCost + outputCost);
}

async function getCostRates(): Promise<CostRates> {
  const result = await pool.query<{
    ai_input_cost_per_million_cents: number;
    ai_output_cost_per_million_cents: number;
  }>(
    `SELECT ai_input_cost_per_million_cents, ai_output_cost_per_million_cents
     FROM ai_configuration LIMIT 1`,
  );
  return {
    inputCentsPerMillion: result.rows[0]?.ai_input_cost_per_million_cents ?? 300,
    outputCentsPerMillion: result.rows[0]?.ai_output_cost_per_million_cents ?? 1500,
  };
}

/** Returns the equivalent-length period immediately preceding `range`. */
function priorPeriod(range: DateRange): DateRange {
  const rangeMs = range.end.getTime() - range.start.getTime();
  return {
    start: new Date(range.start.getTime() - rangeMs),
    end: new Date(range.start.getTime()),
  };
}

/**
 * Returns the aggregated usage summary for the given date range: org totals,
 * trend vs. the prior equivalent-length period, per-user and per-feature
 * breakdowns with estimated cost applied.
 */
export async function getUsageSummary(range: DateRange): Promise<UsageSummaryResponse> {
  const rates = await getCostRates();

  const [totalResult, perUserResult, perUserFeatureResult, perFeatureResult, priorTotalResult] =
    await Promise.all([
      pool.query<UsageRow>(
        `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM ai_token_usage_daily
         WHERE usage_date >= $1 AND usage_date < $2`,
        [range.start, range.end],
      ),
      pool.query<PerUserRawRow>(
        `SELECT d.user_id, u.name AS user_name, u.email AS user_email,
                COALESCE(SUM(d.input_tokens), 0) AS input_tokens,
                COALESCE(SUM(d.output_tokens), 0) AS output_tokens
         FROM ai_token_usage_daily d
         JOIN users u ON u.id = d.user_id
         WHERE d.usage_date >= $1 AND d.usage_date < $2
         GROUP BY d.user_id, u.name, u.email
         ORDER BY u.name`,
        [range.start, range.end],
      ),
      // Per-user-per-feature totals, used to derive each user's single top feature
      // without an N+1 query per user.
      pool.query<PerUserFeatureRawRow>(
        `SELECT user_id, feature, SUM(input_tokens + output_tokens) AS total_tokens
         FROM ai_token_usage_daily
         WHERE usage_date >= $1 AND usage_date < $2
         GROUP BY user_id, feature`,
        [range.start, range.end],
      ),
      pool.query<PerFeatureRawRow>(
        `SELECT feature,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM ai_token_usage_daily
         WHERE usage_date >= $1 AND usage_date < $2
         GROUP BY feature
         ORDER BY feature`,
        [range.start, range.end],
      ),
      (() => {
        const prior = priorPeriod(range);
        return pool.query<UsageRow>(
          `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens
           FROM ai_token_usage_daily
           WHERE usage_date >= $1 AND usage_date < $2`,
          [prior.start, prior.end],
        );
      })(),
    ]);

  const totalInput = parseInt(totalResult.rows[0]?.input_tokens ?? '0', 10);
  const totalOutput = parseInt(totalResult.rows[0]?.output_tokens ?? '0', 10);
  const priorInput = parseInt(priorTotalResult.rows[0]?.input_tokens ?? '0', 10);
  const priorOutput = parseInt(priorTotalResult.rows[0]?.output_tokens ?? '0', 10);

  // Derive each user's top feature (highest total_tokens) from the per-user-feature rows.
  const topFeatureByUser = new Map<string, string>();
  const bestTotalByUser = new Map<string, number>();
  for (const row of perUserFeatureResult.rows) {
    const total = parseInt(row.total_tokens, 10);
    const currentBest = bestTotalByUser.get(row.user_id) ?? -1;
    if (total > currentBest) {
      bestTotalByUser.set(row.user_id, total);
      topFeatureByUser.set(row.user_id, row.feature);
    }
  }

  const perUser: PerUserUsageRow[] = await Promise.all(
    perUserResult.rows.map(async (row) => {
      const inputTokens = parseInt(row.input_tokens, 10);
      const outputTokens = parseInt(row.output_tokens, 10);
      const limit = await getEffectiveUserBudget(row.user_id);
      let budgetPercentage: number | null = null;
      if (limit > 0) {
        const currentMonth = `${range.end.getFullYear()}-${String(range.end.getMonth() + 1).padStart(2, '0')}`;
        const monthUsed = await getUserUsageForMonth(row.user_id, currentMonth);
        budgetPercentage = Math.round((monthUsed / limit) * 100);
      }
      return {
        user_id: row.user_id,
        user_name: row.user_name,
        user_email: row.user_email,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_cents: estimateCostCents(inputTokens, outputTokens, rates),
        budget_percentage: budgetPercentage,
        top_feature: topFeatureByUser.get(row.user_id) ?? null,
      };
    }),
  );

  const perFeature: PerFeatureUsageRow[] = perFeatureResult.rows.map((row) => {
    const inputTokens = parseInt(row.input_tokens, 10);
    const outputTokens = parseInt(row.output_tokens, 10);
    return {
      feature: row.feature,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_cents: estimateCostCents(inputTokens, outputTokens, rates),
    };
  });

  return {
    range_start: range.start.toISOString(),
    range_end: range.end.toISOString(),
    input_tokens: totalInput,
    output_tokens: totalOutput,
    estimated_cost_cents: estimateCostCents(totalInput, totalOutput, rates),
    prior_period_estimated_cost_cents: estimateCostCents(priorInput, priorOutput, rates),
    per_user: perUser,
    per_feature: perFeature,
    ai_input_cost_per_million_cents: rates.inputCentsPerMillion,
    ai_output_cost_per_million_cents: rates.outputCentsPerMillion,
  };
}

/**
 * Returns daily token totals across all users/features for the given range,
 * for the dashboard's daily consumption chart.
 */
export async function getDailyUsageSeries(range: DateRange): Promise<UsageDailySeriesResponse> {
  const result = await pool.query<DailyRawRow>(
    `SELECT usage_date::text AS usage_date,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens
     FROM ai_token_usage_daily
     WHERE usage_date >= $1 AND usage_date < $2
     GROUP BY usage_date
     ORDER BY usage_date`,
    [range.start, range.end],
  );

  const points: DailyUsagePoint[] = result.rows.map((row) => ({
    date: row.usage_date,
    input_tokens: parseInt(row.input_tokens, 10),
    output_tokens: parseInt(row.output_tokens, 10),
  }));

  return {
    range_start: range.start.toISOString(),
    range_end: range.end.toISOString(),
    points,
  };
}
