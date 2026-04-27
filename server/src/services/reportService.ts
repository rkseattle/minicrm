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

/** PostgreSQL row shape for the per-rep win/loss breakdown query (MINCRM-264) */
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
  /** COUNT(DISTINCT currency) across all closed deals with a value (MINCRM-189) */
  currency_count: string;
  /** Single currency code when all closed deals share the same currency (MINCRM-189) */
  single_currency: string | null;
  /** Converted total of Closed Won deals in home currency (MINCRM-253) */
  converted_won_value: string | null;
  /** Converted total of Closed Lost deals in home currency (MINCRM-253) */
  converted_lost_value: string | null;
  /** Code of the home currency (MINCRM-253) */
  home_currency: string | null;
  /** Symbol of the home currency (MINCRM-253) */
  home_symbol: string | null;
  /** Number of deals with a value whose currency lacks a rate (MINCRM-253) */
  unrated_count: string;
  /** ISO timestamp of the most recently updated currency rate (MINCRM-253) */
  rates_last_updated: string | null;
  /** Number of non-home currency rows in the currencies table (MINCRM-253) */
  has_rates_count: string;
}

/** A single entry in the loss reason breakdown */
export interface LossReasonBreakdown {
  reason: string;
  count: number;
}

/** A single rep row in the win/loss per-rep breakdown (MINCRM-264) */
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
  /** True when closed deals span more than one currency; totals are not meaningful (MINCRM-189) */
  mixedCurrencies: boolean;
  /**
   * The currency code when all closed deals share one currency; null when mixed or no deals.
   * Pair with mixedCurrencies to format monetary totals correctly. (MINCRM-189)
   */
  currency: string | null;
  /** Converted Closed Won total in home currency (MINCRM-253) */
  convertedWonValue: string | null;
  /** Converted Closed Lost total in home currency (MINCRM-253) */
  convertedLostValue: string | null;
  /** Code of the home currency (MINCRM-253) */
  homeCurrency: string | null;
  /** Symbol of the home currency (MINCRM-253) */
  homeSymbol: string | null;
  /** Number of deals with a value whose currency lacks a rate (MINCRM-253) */
  unratedCount: number;
  /** ISO timestamp of the most recently updated currency rate (MINCRM-253) */
  ratesLastUpdated: string | null;
  /** True when at least one non-home currency rate exists (MINCRM-253) */
  hasRates: boolean;
  /**
   * Per-rep breakdown rows — only populated when ownerId is null (team-wide view).
   * Empty array when a specific owner filter is applied. (MINCRM-264)
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
  // LEFT JOIN currencies for exchange rate conversion. (MINCRM-253)
  // Scalar subqueries for home currency code/symbol are used instead of a LATERAL
  // join so that home_currency and home_symbol are always populated even when the deals
  // table is empty (aggregate over zero rows would otherwise make LATERAL join columns null).
  const aggBaseSelect = `
       COUNT(*) FILTER (WHERE d.stage = 'Closed Won')                                   AS won_count,
       COALESCE(SUM(d.value) FILTER (WHERE d.stage = 'Closed Won'), 0)::text            AS won_value,
       COUNT(*) FILTER (WHERE d.stage = 'Closed Lost')                                  AS lost_count,
       COALESCE(SUM(d.value) FILTER (WHERE d.stage = 'Closed Lost'), 0)::text           AS lost_value,
       COUNT(DISTINCT CASE WHEN d.value IS NOT NULL THEN d.currency END)::text          AS currency_count,
       MIN(d.currency)                                                                    AS single_currency,
       SUM(
         CASE WHEN d.value IS NOT NULL AND d.stage = 'Closed Won'
                   AND (d.currency = (SELECT code FROM currencies WHERE is_home = true LIMIT 1)
                        OR c.code IS NOT NULL)
              THEN d.value::numeric * COALESCE(c.rate_to_home, 1.0)
              ELSE NULL END
       )::text AS converted_won_value,
       SUM(
         CASE WHEN d.value IS NOT NULL AND d.stage = 'Closed Lost'
                   AND (d.currency = (SELECT code FROM currencies WHERE is_home = true LIMIT 1)
                        OR c.code IS NOT NULL)
              THEN d.value::numeric * COALESCE(c.rate_to_home, 1.0)
              ELSE NULL END
       )::text AS converted_lost_value,
       (SELECT code   FROM currencies WHERE is_home = true LIMIT 1) AS home_currency,
       (SELECT symbol FROM currencies WHERE is_home = true LIMIT 1) AS home_symbol,
       COUNT(*) FILTER (WHERE c.code IS NULL AND d.value IS NOT NULL
                          AND d.currency != (SELECT code FROM currencies WHERE is_home = true LIMIT 1)) AS unrated_count,
       MAX(c.updated_at)::text AS rates_last_updated,
       (SELECT COUNT(*) FROM currencies WHERE is_home = false)::text AS has_rates_count`;

  const aggFrom = `
       FROM deals d
       LEFT JOIN currencies c ON c.code = d.currency AND c.is_home = false`;

  const aggQuery = ownerFilter
    ? `SELECT ${aggBaseSelect} ${aggFrom}
       WHERE d.stage IN ('Closed Won', 'Closed Lost')
         AND d.close_date >= $1
         AND d.close_date <= $2
         AND d.owner_id = $3`
    : `SELECT ${aggBaseSelect} ${aggFrom}
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

  // Currency conversion fields (MINCRM-253)
  const hasRatesCount = parseInt(aggRow.has_rates_count ?? '0', 10);
  const hasRates = hasRatesCount > 0;
  const unratedCount = parseInt(String(aggRow.unrated_count ?? '0'), 10);

  // ── Per-rep breakdown (team-wide only) ────────────────────────────────────
  // Only populated when no owner filter is applied; empty array for scoped queries.
  // Sorted by owner name ascending. (MINCRM-264)
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

/** The ordered set of activity types used as report columns (MINCRM-181) */
const ACTIVITY_TYPES = ['Note', 'Call', 'Email', 'Meeting', 'Task'] as const;

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
