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
import {
  getUserBudgetSnapshots,
  currentYearMonth,
  type UserBudgetSnapshot,
} from './aiTokenBudgetService.js';
import type {
  UsageSummaryResponse,
  UsageDailySeriesResponse,
  PerUserUsageRow,
  PerFeatureUsageRow,
  DailyUsagePoint,
} from '@minicrm/shared/schemas/aiUsageSchema.js';
import type { UsageDateRangeParams } from '@minicrm/shared/schemas/aiUsageSchema.js';
import { ONE_DAY_MS, toUtcDateString as toDateString, utcMonthStart } from '../utils/utcDate.js';

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

/**
 * Resolves the requested date range from query params. Supports either a
 * `preset` (current_month | last_month | last_3_months) or an explicit
 * `start`/`end` pair (ISO date strings). `start` and `end` are both treated
 * as inclusive calendar days — `end` is advanced by one day internally to
 * produce the exclusive boundary every query filters against, so a caller
 * asking for `end=2026-07-01` sees that day's data (matching what a date
 * picker labeled "End date" implies), not "up to but excluding" it.
 *
 * Both `start` and `end` must be supplied together — a lone one returns null
 * rather than silently falling back to the preset path.
 *
 * Lives here rather than in aiUsageController.ts because it is calendar logic,
 * not request shaping: it belongs beside toDateString/rangeIncludesCurrentMonth,
 * which have to agree with it about what "a month" means. The controller still
 * owns HTTP input validation — it Zod-parses the query and passes the typed
 * result here. (MINCRM-700)
 *
 * `now` is injectable so tests can pin a fixed instant without faking global
 * timers — vitest's setSystemTime requires vi.useFakeTimers(), which cannot
 * wrap the pool.query calls these code paths make (they would hang on the
 * pool's connection/idle timeouts).
 *
 * Returns null when the combination is unusable (a lone start or end, an
 * unparsable date, an inverted range), so the caller can respond 400.
 */
export function resolveDateRange(
  query: UsageDateRangeParams,
  now: Date = new Date(),
): DateRange | null {
  const { start: startParam, end: endParam } = query;

  if (startParam || endParam) {
    if (!startParam || !endParam) {
      return null;
    }
    const start = new Date(startParam);
    const inclusiveEnd = new Date(endParam);
    if (isNaN(start.getTime()) || isNaN(inclusiveEnd.getTime())) {
      return null;
    }
    const end = new Date(inclusiveEnd.getTime() + ONE_DAY_MS);
    if (start >= end) {
      return null;
    }
    return { start, end };
  }

  const startOfCurrentMonth = utcMonthStart(now, 0);
  const startOfNextMonth = utcMonthStart(now, 1);

  // Exhaustive over UsageDateRangePreset — deliberately no `default`, so adding
  // a preset to the schema is a compile error here rather than a silent
  // fallback to current_month. Callers must Zod-parse first; an unvalidated
  // value reaching this switch returns null (a 400) rather than plausible data.
  switch (query.preset ?? 'current_month') {
    case 'current_month':
      return { start: startOfCurrentMonth, end: startOfNextMonth };
    case 'last_month':
      return { start: utcMonthStart(now, -1), end: startOfCurrentMonth };
    case 'last_3_months':
      return { start: utcMonthStart(now, -3), end: startOfNextMonth };
  }

  // Unreachable for a Zod-parsed query, and the switch above is exhaustive over
  // UsageDateRangePreset. Explicit rather than an implicit undefined: the
  // declared return type is `DateRange | null`, and tsconfig does not enable
  // noImplicitReturns, so falling off the end would silently violate it.
  return null;
}

/**
 * True when `range` covers the current UTC calendar month at all (even
 * partially). getUserBudgetSnapshots always reports the current month's
 * consumption against the monthly limit — that's only a meaningful
 * "% of budget used" figure when the selected range is the current month;
 * for a purely historical range (e.g. "last month") it would silently pair
 * this month's percentage with a different month's token counts.
 */
function rangeIncludesCurrentMonth(range: DateRange): boolean {
  const [year, month] = currentYearMonth().split('-').map(Number);
  // month is 1-indexed from currentYearMonth(); Date.UTC's month param is 0-indexed.
  const currentMonthStart = new Date(Date.UTC(year, month - 1, 1));
  const currentMonthEnd = new Date(Date.UTC(year, month, 1));
  return range.start < currentMonthEnd && range.end > currentMonthStart;
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

/** Returns the summed input/output tokens across all users and features in a date range. */
function queryTotals(range: DateRange): Promise<{ rows: UsageRow[] }> {
  return pool.query<UsageRow>(
    `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens
     FROM ai_token_usage_daily
     WHERE usage_date >= $1 AND usage_date < $2`,
    [toDateString(range.start), toDateString(range.end)],
  );
}

/**
 * Returns the aggregated usage summary for the given date range: org totals,
 * trend vs. the prior equivalent-length period, per-user and per-feature
 * breakdowns with estimated cost applied.
 */
export async function getUsageSummary(range: DateRange): Promise<UsageSummaryResponse> {
  const rates = await getCostRates();

  const prior = priorPeriod(range);
  const rangeStartStr = toDateString(range.start);
  const rangeEndStr = toDateString(range.end);

  const [totalResult, perUserResult, perUserFeatureResult, perFeatureResult, priorTotalResult] =
    await Promise.all([
      queryTotals(range),
      pool.query<PerUserRawRow>(
        `SELECT d.user_id, u.name AS user_name, u.email AS user_email,
                COALESCE(SUM(d.input_tokens), 0) AS input_tokens,
                COALESCE(SUM(d.output_tokens), 0) AS output_tokens
         FROM ai_token_usage_daily d
         JOIN users u ON u.id = d.user_id
         WHERE d.usage_date >= $1 AND d.usage_date < $2
         GROUP BY d.user_id, u.name, u.email
         ORDER BY u.name`,
        [rangeStartStr, rangeEndStr],
      ),
      // Per-user-per-feature totals, used to derive each user's single top feature
      // without an N+1 query per user.
      pool.query<PerUserFeatureRawRow>(
        `SELECT user_id, feature, SUM(input_tokens + output_tokens) AS total_tokens
         FROM ai_token_usage_daily
         WHERE usage_date >= $1 AND usage_date < $2
         GROUP BY user_id, feature`,
        [rangeStartStr, rangeEndStr],
      ),
      pool.query<PerFeatureRawRow>(
        `SELECT feature,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM ai_token_usage_daily
         WHERE usage_date >= $1 AND usage_date < $2
         GROUP BY feature
         ORDER BY feature`,
        [rangeStartStr, rangeEndStr],
      ),
      queryTotals(prior),
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

  // budget_percentage only means something when the selected range includes
  // the current month (see rangeIncludesCurrentMonth's doc comment) — skip
  // the query entirely for a purely historical range rather than compute
  // snapshots that would just be discarded below.
  const budgetSnapshots = rangeIncludesCurrentMonth(range)
    ? await getUserBudgetSnapshots(perUserResult.rows.map((row) => row.user_id))
    : new Map<string, UserBudgetSnapshot>();

  const perUser: PerUserUsageRow[] = perUserResult.rows.map((row) => {
    const inputTokens = parseInt(row.input_tokens, 10);
    const outputTokens = parseInt(row.output_tokens, 10);
    const snapshot = budgetSnapshots.get(row.user_id);
    const budgetPercentage =
      snapshot && snapshot.limit > 0
        ? Math.round((snapshot.usedThisMonth / snapshot.limit) * 100)
        : null;
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
  });

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

/** A single exportable row: one user, one day, one feature. */
export interface UsageExportRow {
  usage_date: string;
  user_name: string;
  user_email: string;
  feature: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_cents: number;
}

/**
 * Returns the full per-user-per-day-per-feature breakdown for the given range,
 * for CSV export. This is the most granular view — per-user, per-feature, or
 * daily totals can all be derived by pivoting this data in a spreadsheet.
 */
export async function getUsageExportRows(range: DateRange): Promise<UsageExportRow[]> {
  const rates = await getCostRates();

  const result = await pool.query<{
    usage_date: string;
    user_name: string;
    user_email: string;
    feature: string;
    input_tokens: string;
    output_tokens: string;
  }>(
    `SELECT d.usage_date::text AS usage_date, u.name AS user_name, u.email AS user_email,
            d.feature, d.input_tokens, d.output_tokens
     FROM ai_token_usage_daily d
     JOIN users u ON u.id = d.user_id
     WHERE d.usage_date >= $1 AND d.usage_date < $2
     ORDER BY d.usage_date, u.name, d.feature`,
    [toDateString(range.start), toDateString(range.end)],
  );

  return result.rows.map((row) => {
    const inputTokens = parseInt(row.input_tokens, 10);
    const outputTokens = parseInt(row.output_tokens, 10);
    return {
      usage_date: row.usage_date,
      user_name: row.user_name,
      user_email: row.user_email,
      feature: row.feature,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_cents: estimateCostCents(inputTokens, outputTokens, rates),
    };
  });
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
    [toDateString(range.start), toDateString(range.end)],
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
