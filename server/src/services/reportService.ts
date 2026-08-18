/**
 * Report service — business logic for reporting endpoints.
 * All database access for reports goes through this module.
 */

import pool from '../db.js';

/** Parameters for the win/loss report query */
export interface WinLossReportParams {
  /** Start of the date range (inclusive), YYYY-MM-DD, matched against close_date */
  startDate: string;
  /** End of the date range (inclusive), YYYY-MM-DD, matched against close_date */
  endDate: string;
  /**
   * When provided, scopes the report to deals owned by this user.
   * Pass null for team-wide data (admin only).
   */
  ownerId: string | null;
}

/** A single loss-reason row returned by the query */
interface LossReasonRow {
  reason: string;
  count: string;
}

/** PostgreSQL row shape for the per-rep win/loss breakdown query */
interface WinLossRepAggRow {
  owner_id: string;
  owner_name: string;
  won_count: string;
  won_value: string;
  lost_count: string;
  lost_value: string;
}

/** PostgreSQL row shape for the win/loss aggregation query */
interface WinLossAggRow {
  won_count: string;
  won_value: string;
  lost_count: string;
  lost_value: string;
  /** COUNT(DISTINCT currency) across all closed deals with a value */
  currency_count: string;
  /** Single currency code when all closed deals share the same currency */
  single_currency: string | null;
  /** Converted total of Closed Won deals in home currency */
  converted_won_value: string | null;
  /** Converted total of Closed Lost deals in home currency */
  converted_lost_value: string | null;
  /** Code of the home currency */
  home_currency: string | null;
  /** Symbol of the home currency */
  home_symbol: string | null;
  /** Number of deals with a value whose currency lacks a rate */
  unrated_count: string;
  /** ISO timestamp of the most recently updated currency rate */
  rates_last_updated: string | null;
  /** Number of non-home currency rows in the currencies table */
  has_rates_count: string;
}

/** A single entry in the loss reason breakdown */
export interface LossReasonBreakdown {
  reason: string;
  count: number;
}

/** A single rep row in the win/loss per-rep breakdown */
export interface WinLossRepRow {
  ownerId: string;
  ownerName: string;
  wonCount: number;
  wonValue: string;
  lostCount: number;
  lostValue: string;
  winRate: number | null;
}

/** Shape of the win/loss report returned to the controller */
export interface WinLossReport {
  /** Number of Closed Won deals in the date range */
  wonCount: number;
  /** Sum of value for Closed Won deals, as a decimal string */
  wonValue: string;
  /** Number of Closed Lost deals in the date range */
  lostCount: number;
  /** Sum of value for Closed Lost deals, as a decimal string */
  lostValue: string;
  /**
   * Win rate as a decimal between 0 and 1 (Won / Total Closed).
   * Null when there are no closed deals in the range.
   */
  winRate: number | null;
  /** Top loss reasons by count, descending. Empty when no loss reasons were captured. */
  lossReasonBreakdown: LossReasonBreakdown[];
  /** True when closed deals span more than one currency; totals are not meaningful */
  mixedCurrencies: boolean;
  /**
   * The currency code when all closed deals share one currency; null when mixed or no deals.
   * Pair with mixedCurrencies to format monetary totals correctly.
   */
  currency: string | null;
  /** Converted Closed Won total in home currency */
  convertedWonValue: string | null;
  /** Converted Closed Lost total in home currency */
  convertedLostValue: string | null;
  /** Code of the home currency */
  homeCurrency: string | null;
  /** Symbol of the home currency */
  homeSymbol: string | null;
  /** Number of deals with a value whose currency lacks a rate */
  unratedCount: number;
  /** ISO timestamp of the most recently updated currency rate */
  ratesLastUpdated: string | null;
  /** True when at least one non-home currency rate exists */
  hasRates: boolean;
  /**
   * Per-rep breakdown rows — only populated when ownerId is null (team-wide view).
   * Empty array when a specific owner filter is applied.
   */
  repRows: WinLossRepRow[];
}

/**
 * Returns a win/loss report for the given date range and optional owner scope.
 *
 * @param params - Query parameters (date range and optional owner)
 * @returns WinLossReport summary
 */
export async function getWinLossReport(params: WinLossReportParams): Promise<WinLossReport> {
  const { startDate, endDate, ownerId } = params;
  const ownerFilter = ownerId !== null;

  // ── Win/loss aggregates ────────────────────────────────────────────────────
  // Single query using conditional aggregation to count + sum Won and Lost separately.
  // Filters by close_date (not created_at) per acceptance criteria.
  //
  // Rate resolution strategy:
  //   1. Look up the most recent currency_rate_history row whose effective_from is at or
  //      before the deal's close_date — this gives the rate that was in effect at close.
  //   2. Fall back to the current currencies row when no history exists (e.g. the rate was
  //      never changed, or the history predates this feature).
  //   3. Fall back to 1.0 for the home currency (which has no history row).
  //
  // The rate_at_close CTE uses DISTINCT ON (d.id) ordered by effective_from DESC so that
  // PostgreSQL returns only the most recent snapshot that satisfies the time predicate.
  //
  // Scalar subqueries for home currency code/symbol are retained so that home_currency and
  // home_symbol remain populated even when the deals table is empty (aggregate over zero rows
  // would otherwise make LATERAL join columns null).
  //
  // home_currency CTE deduplicates the four scalar subqueries that look up the home currency
  // code and symbol, so the optimizer can satisfy them from a single index scan.
  //
  // currency_updated_at in rate_at_close uses COALESCE(c.updated_at, rh.effective_from) so that
  // deals whose currency was later deleted from the currencies table still contribute a
  // meaningful timestamp to rates_last_updated via their history rows.
  const aggCte = `
    WITH home_currency AS (
      SELECT code, symbol FROM currencies WHERE is_home = true LIMIT 1
    ),
    rate_at_close AS (
      SELECT DISTINCT ON (d.id)
        d.id                                                           AS deal_id,
        COALESCE(rh.rate_to_home, c.rate_to_home)                     AS effective_rate,
        CASE WHEN rh.code IS NOT NULL OR c.code IS NOT NULL THEN true
             ELSE false END                                            AS has_rate,
        COALESCE(c.updated_at, rh.effective_from)                     AS currency_updated_at
      FROM deals d
      LEFT JOIN currency_rate_history rh
        ON rh.code = d.currency
       AND rh.effective_from <= d.close_date::timestamptz
      LEFT JOIN currencies c
        ON c.code = d.currency
       AND c.is_home = false
      WHERE d.stage IN ('Closed Won', 'Closed Lost')
      ORDER BY d.id, rh.effective_from DESC NULLS LAST
    )`;

  const aggBaseSelect = `
       COUNT(*) FILTER (WHERE d.stage = 'Closed Won')                                   AS won_count,
       COALESCE(SUM(d.value) FILTER (WHERE d.stage = 'Closed Won'), 0)::text            AS won_value,
       COUNT(*) FILTER (WHERE d.stage = 'Closed Lost')                                  AS lost_count,
       COALESCE(SUM(d.value) FILTER (WHERE d.stage = 'Closed Lost'), 0)::text           AS lost_value,
       COUNT(DISTINCT CASE WHEN d.value IS NOT NULL THEN d.currency END)::text          AS currency_count,
       MIN(d.currency)                                                                    AS single_currency,
       SUM(
         CASE WHEN d.value IS NOT NULL AND d.stage = 'Closed Won'
                   AND (d.currency = (SELECT code FROM home_currency)
                        OR rac.has_rate)
              THEN d.value::numeric * COALESCE(rac.effective_rate, 1.0)
              ELSE NULL END
       )::text AS converted_won_value,
       SUM(
         CASE WHEN d.value IS NOT NULL AND d.stage = 'Closed Lost'
                   AND (d.currency = (SELECT code FROM home_currency)
                        OR rac.has_rate)
              THEN d.value::numeric * COALESCE(rac.effective_rate, 1.0)
              ELSE NULL END
       )::text AS converted_lost_value,
       (SELECT code   FROM home_currency) AS home_currency,
       (SELECT symbol FROM home_currency) AS home_symbol,
       COUNT(*) FILTER (WHERE NOT rac.has_rate AND d.value IS NOT NULL
                          AND d.currency != (SELECT code FROM home_currency)) AS unrated_count,
       MAX(rac.currency_updated_at)::text AS rates_last_updated,
       (SELECT COUNT(*) FROM currencies WHERE is_home = false)::text AS has_rates_count`;

  const aggFrom = `
       FROM deals d
       LEFT JOIN rate_at_close rac ON rac.deal_id = d.id`;

  const aggQuery = ownerFilter
    ? `${aggCte} SELECT ${aggBaseSelect} ${aggFrom}
       WHERE d.stage IN ('Closed Won', 'Closed Lost')
         AND d.close_date >= $1
         AND d.close_date <= $2
         AND d.owner_id = $3`
    : `${aggCte} SELECT ${aggBaseSelect} ${aggFrom}
       WHERE d.stage IN ('Closed Won', 'Closed Lost')
         AND d.close_date >= $1
         AND d.close_date <= $2`;

  const aggParams = ownerFilter ? [startDate, endDate, ownerId] : [startDate, endDate];
  const aggResult = await pool.query<WinLossAggRow>(aggQuery, aggParams);
  const aggRow = aggResult.rows[0];

  const wonCount = parseInt(aggRow.won_count, 10);
  const wonValue = aggRow.won_value;
  const lostCount = parseInt(aggRow.lost_count, 10);
  const lostValue = aggRow.lost_value;
  const mixedCurrencies = parseInt(aggRow.currency_count, 10) > 1;
  const currency = mixedCurrencies ? null : (aggRow.single_currency ?? null);

  const totalClosed = wonCount + lostCount;
  const winRate = totalClosed > 0 ? wonCount / totalClosed : null;

  // ── Loss reason breakdown ──────────────────────────────────────────────────
  // Only includes rows where loss_reason is non-null and non-empty.
  // Results are ordered by count descending so the top reason appears first.
  const lossReasonQuery = ownerFilter
    ? `SELECT
         loss_reason AS reason,
         COUNT(*)::text AS count
       FROM deals
       WHERE stage = 'Closed Lost'
         AND loss_reason IS NOT NULL
         AND loss_reason <> ''
         AND close_date >= $1
         AND close_date <= $2
         AND owner_id = $3
       GROUP BY loss_reason
       ORDER BY COUNT(*) DESC, loss_reason ASC`
    : `SELECT
         loss_reason AS reason,
         COUNT(*)::text AS count
       FROM deals
       WHERE stage = 'Closed Lost'
         AND loss_reason IS NOT NULL
         AND loss_reason <> ''
         AND close_date >= $1
         AND close_date <= $2
       GROUP BY loss_reason
       ORDER BY COUNT(*) DESC, loss_reason ASC`;

  const lossReasonResult = await pool.query<LossReasonRow>(lossReasonQuery, aggParams);

  const lossReasonBreakdown: LossReasonBreakdown[] = lossReasonResult.rows.map((row) => ({
    reason: row.reason,
    count: parseInt(row.count, 10),
  }));

  // Currency conversion fields
  const hasRatesCount = parseInt(aggRow.has_rates_count ?? '0', 10);
  const hasRates = hasRatesCount > 0;
  const unratedCount = parseInt(String(aggRow.unrated_count ?? '0'), 10);

  // ── Per-rep breakdown (team-wide only) ────────────────────────────────────
  // Only populated when no owner filter is applied; empty array for scoped queries.
  // Sorted by owner name ascending.
  let repRows: WinLossRepRow[] = [];
  if (!ownerFilter) {
    const repAggResult = await pool.query<WinLossRepAggRow>(
      `SELECT
         d.owner_id,
         u.name AS owner_name,
         COUNT(*) FILTER (WHERE d.stage = 'Closed Won')::text                   AS won_count,
         COALESCE(SUM(d.value) FILTER (WHERE d.stage = 'Closed Won'), 0)::text  AS won_value,
         COUNT(*) FILTER (WHERE d.stage = 'Closed Lost')::text                  AS lost_count,
         COALESCE(SUM(d.value) FILTER (WHERE d.stage = 'Closed Lost'), 0)::text AS lost_value
       FROM deals d
       JOIN users u ON u.id = d.owner_id
       WHERE d.stage IN ('Closed Won', 'Closed Lost')
         AND d.close_date >= $1
         AND d.close_date <= $2
       GROUP BY d.owner_id, u.name
       ORDER BY u.name ASC`,
      [startDate, endDate],
    );
    repRows = repAggResult.rows.map((row) => {
      const wc = parseInt(row.won_count, 10);
      const lc = parseInt(row.lost_count, 10);
      const total = wc + lc;
      return {
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        wonCount: wc,
        wonValue: row.won_value,
        lostCount: lc,
        lostValue: row.lost_value,
        winRate: total > 0 ? wc / total : null,
      };
    });
  }

  return {
    wonCount,
    wonValue,
    lostCount,
    lostValue,
    winRate,
    lossReasonBreakdown,
    mixedCurrencies,
    currency,
    convertedWonValue: hasRates ? (aggRow.converted_won_value ?? null) : null,
    convertedLostValue: hasRates ? (aggRow.converted_lost_value ?? null) : null,
    homeCurrency: aggRow.home_currency ?? null,
    homeSymbol: aggRow.home_symbol ?? null,
    unratedCount,
    ratesLastUpdated: aggRow.rates_last_updated ?? null,
    hasRates,
    repRows,
  };
}

// ── Activity Volume Report ────────────────────────────────────────────────────

/** Parameters for the activity volume report query */
export interface ActivityVolumeReportParams {
  /** Start of the date range (inclusive), YYYY-MM-DD, matched against activities.created_at */
  startDate: string;
  /** End of the date range (inclusive), YYYY-MM-DD, matched against activities.created_at */
  endDate: string;
  /**
   * When provided, scopes the report to activities owned by this user.
   * Pass null for team-wide data (admin only).
   */
  ownerId: string | null;
}

/** A single row in the activity volume result set — one row per (owner_id, type) combination */
interface ActivityVolumeRow {
  owner_id: string;
  owner_name: string;
  type: string;
  count: string;
}

/** Count per activity type for a single rep row */
export interface ActivityTypeCounts {
  Note: number;
  Call: number;
  Email: number;
  Meeting: number;
  Task: number;
}

/** A single rep row in the activity volume report */
export interface ActivityVolumeRepRow {
  ownerId: string;
  ownerName: string;
  counts: ActivityTypeCounts;
  /** Total activities logged across all types */
  total: number;
}

/** Shape of the activity volume report returned to the controller */
export interface ActivityVolumeReport {
  /** Per-rep rows, sorted by owner name ascending */
  rows: ActivityVolumeRepRow[];
  /** Column totals across all reps */
  totals: ActivityTypeCounts & { total: number };
}

/** The ordered set of activity types used as report columns */
export const ACTIVITY_TYPES = ['Note', 'Call', 'Email', 'Meeting', 'Task'] as const;

/**
 * Returns an activity volume report for the given date range and optional owner scope.
 * Counts are broken down by type (Note, Call, Email, Meeting, Task) and grouped by rep.
 * Filtered by activities.created_at (not updated_at) per acceptance criteria.
 *
 * @param params - Query parameters (date range and optional owner scope)
 * @returns ActivityVolumeReport summary
 */
export async function getActivityVolumeReport(
  params: ActivityVolumeReportParams,
): Promise<ActivityVolumeReport> {
  const { startDate, endDate, ownerId } = params;
  const ownerFilter = ownerId !== null;

  // ── Raw counts per (owner, type) ──────────────────────────────────────────
  // JOIN to users for the owner display name. Filter by created_at::date for
  // a date-boundary comparison that ignores the time component.
  const volumeQuery = ownerFilter
    ? `SELECT
         a.owner_id,
         u.name AS owner_name,
         a.type,
         COUNT(*)::text AS count
       FROM activities a
       JOIN users u ON u.id = a.owner_id
       WHERE a.created_at::date >= $1
         AND a.created_at::date <= $2
         AND a.owner_id = $3
       GROUP BY a.owner_id, u.name, a.type
       ORDER BY u.name ASC, a.type ASC`
    : `SELECT
         a.owner_id,
         u.name AS owner_name,
         a.type,
         COUNT(*)::text AS count
       FROM activities a
       JOIN users u ON u.id = a.owner_id
       WHERE a.created_at::date >= $1
         AND a.created_at::date <= $2
       GROUP BY a.owner_id, u.name, a.type
       ORDER BY u.name ASC, a.type ASC`;

  const volumeParams = ownerFilter ? [startDate, endDate, ownerId] : [startDate, endDate];
  const volumeResult = await pool.query<ActivityVolumeRow>(volumeQuery, volumeParams);

  // ── Pivot rows into per-rep objects ───────────────────────────────────────
  // Build a map keyed by owner_id; fill in each type count as we iterate.
  const repMap = new Map<string, ActivityVolumeRepRow>();
  for (const row of volumeResult.rows) {
    if (!repMap.has(row.owner_id)) {
      repMap.set(row.owner_id, {
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        counts: { Note: 0, Call: 0, Email: 0, Meeting: 0, Task: 0 },
        total: 0,
      });
    }
    const repRow = repMap.get(row.owner_id)!;
    const typeKey = row.type as keyof ActivityTypeCounts;
    const countNum = parseInt(row.count, 10);
    repRow.counts[typeKey] = countNum;
    repRow.total += countNum;
  }

  const rows = Array.from(repMap.values()).sort((a, b) => a.ownerName.localeCompare(b.ownerName));

  // ── Column totals ──────────────────────────────────────────────────────────
  const totals: ActivityTypeCounts & { total: number } = {
    Note: 0,
    Call: 0,
    Email: 0,
    Meeting: 0,
    Task: 0,
    total: 0,
  };
  for (const repRow of rows) {
    for (const type of ACTIVITY_TYPES) {
      totals[type] += repRow.counts[type];
    }
    totals.total += repRow.total;
  }

  return { rows, totals };
}

// ── Leads Summary Report ────────────────────────────────────────

export interface LeadsSummaryReportParams {
  /**
   * When provided, scopes the report to leads owned by this user.
   * Pass null for team-wide data (admin only).
   */
  ownerId: string | null;
}

/** A single row in the leads-by-status result set */
interface LeadsByStatusRow {
  status: string;
  count: string;
}

/** One row per lead status in the summary report */
export interface LeadsSummaryStatusRow {
  status: string;
  count: number;
}

/** Shape of the leads summary report returned to the controller */
export interface LeadsSummaryReport {
  /** Per-status counts, in LEAD_STATUSES order */
  rows: LeadsSummaryStatusRow[];
  /** Total leads across all statuses */
  total: number;
}

/** The ordered set of lead statuses used as report rows, matching LEAD_STATUSES */
const LEAD_STATUS_ORDER = ['New', 'Contacted', 'Qualified', 'Disqualified'] as const;

/**
 * Returns a count-by-status summary of leads, optionally scoped to a single
 * owner. Excludes converted leads implicitly — converted leads still carry
 * their pre-conversion status, so this reflects the open-pipeline breakdown
 * a rep or admin would see on the Leads list.
 *
 * @param params - Query parameters (optional owner scope)
 * @returns LeadsSummaryReport summary
 */
export async function getLeadsSummaryReport(
  params: LeadsSummaryReportParams,
): Promise<LeadsSummaryReport> {
  const { ownerId } = params;
  const ownerFilter = ownerId !== null;

  const query = ownerFilter
    ? `SELECT status, COUNT(*)::text AS count
       FROM leads
       WHERE owner_id = $1
       GROUP BY status`
    : `SELECT status, COUNT(*)::text AS count
       FROM leads
       GROUP BY status`;
  const queryParams = ownerFilter ? [ownerId] : [];
  const result = await pool.query<LeadsByStatusRow>(query, queryParams);

  const countByStatus = new Map<string, number>();
  for (const row of result.rows) {
    countByStatus.set(row.status, parseInt(row.count, 10));
  }

  const rows = LEAD_STATUS_ORDER.map((status) => ({
    status,
    count: countByStatus.get(status) ?? 0,
  }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return { rows, total };
}

// ── Stage Trend Report ──────────────────────────────────────────

/** Allowed values for the stageTrend `days` parameter */
export const STAGE_TREND_DAYS_OPTIONS = [30, 60, 90] as const;
export type StageTrendDays = (typeof STAGE_TREND_DAYS_OPTIONS)[number];

/** A single data point: one stage for one time bucket */
export interface StageTrendDataPoint {
  /** Pipeline stage name */
  stage: string;
  /** ISO date string for the start of the bucket (week or month) */
  period: string;
  /** Number of deals that entered this stage in this period */
  entered: number;
  /** Number of those entered deals that subsequently advanced to any other stage */
  converted: number;
}

/** Shape of the stage trend report returned to the controller */
export interface StageTrendReport {
  /** Ordered stage names (by pipeline sort_order) present in the result */
  stages: string[];
  /** All data points, ordered by stage sort_order then period ascending */
  dataPoints: StageTrendDataPoint[];
  /** ISO date string for the start of the requested window */
  windowStart: string;
  /** ISO date string for the end of the requested window (today) */
  windowEnd: string;
}

/** PostgreSQL row shape from the stage trend query */
interface StageTrendRow {
  stage: string;
  period: string;
  entered: string;
  converted: string;
}

/**
 * Returns a stage trend report for the given look-back window.
 *
 * Uses the audit_log table to find when deals entered each pipeline stage
 * (field_name = 'stage', new_value = stage name) and whether the deal
 * subsequently moved to a different stage within the window.
 *
 * Buckets are monthly for 60- and 90-day windows, weekly for 30-day windows.
 * Stages are ordered by pipeline_stages.sort_order.
 *
 * @param days - Look-back window in days (30, 60, or 90)
 * @returns StageTrendReport
 */
export async function getStageTrendReport(days: StageTrendDays): Promise<StageTrendReport> {
  // Use weekly buckets for 30-day windows, monthly for 60/90.
  const bucketFn =
    days === 30 ? `date_trunc('week', al.created_at)` : `date_trunc('month', al.created_at)`;

  // windowStart is computed server-side so the query and returned metadata always agree.
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - days);
  const windowStartStr = windowStart.toISOString().slice(0, 10);
  const windowEndStr = new Date().toISOString().slice(0, 10);

  // ── Main query ─────────────────────────────────────────────────────────────
  // For each audit_log entry recording a deal stage entry (field_name='stage'),
  // count how many deals entered that stage in each bucket, and how many of
  // those deals appear in a *later* audit_log entry where field_name='stage'
  // (meaning they advanced to a different stage).
  //
  // The correlated subquery for `converted` counts distinct deals that entered
  // the given stage in the given bucket AND have at least one subsequent stage
  // change logged after the entry event.
  const result = await pool.query<StageTrendRow>(
    `
    WITH entries AS (
      SELECT
        al.new_value                        AS stage,
        ${bucketFn}::date::text             AS period,
        al.record_id                        AS deal_id,
        al.created_at                       AS entered_at
      FROM audit_log al
      WHERE al.record_type = 'deal'
        AND al.field_name = 'stage'
        AND al.created_at >= NOW() - ($1 || ' days')::interval
    ),
    conversions AS (
      SELECT DISTINCT e.deal_id, e.period, e.stage
      FROM entries e
      WHERE EXISTS (
        SELECT 1
        FROM audit_log al2
        WHERE al2.record_id = e.deal_id
          AND al2.record_type = 'deal'
          AND al2.field_name = 'stage'
          AND al2.created_at > e.entered_at
      )
    )
    SELECT
      e.stage,
      e.period,
      COUNT(DISTINCT e.deal_id)::text                                             AS entered,
      COUNT(DISTINCT c.deal_id)::text                                             AS converted
    FROM entries e
    LEFT JOIN conversions c USING (deal_id, period, stage)
    JOIN pipeline_stages ps ON ps.name = e.stage
    GROUP BY e.stage, e.period, ps.sort_order
    ORDER BY ps.sort_order ASC, e.period ASC
    `,
    [days],
  );

  // ── Ordered stage list ─────────────────────────────────────────────────────
  const stages = [...new Set(result.rows.map((r) => r.stage))];

  const dataPoints: StageTrendDataPoint[] = result.rows.map((row) => ({
    stage: row.stage,
    period: row.period,
    entered: parseInt(row.entered, 10),
    converted: parseInt(row.converted, 10),
  }));

  return { stages, dataPoints, windowStart: windowStartStr, windowEnd: windowEndStr };
}
