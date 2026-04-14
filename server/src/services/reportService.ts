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

/** PostgreSQL row shape for the win/loss aggregation query */
interface WinLossAggRow {
  won_count: string;
  won_value: string;
  lost_count: string;
  lost_value: string;
}

/** A single entry in the loss reason breakdown */
export interface LossReasonBreakdown {
  reason: string;
  count: number;
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
  const aggQuery = ownerFilter
    ? `SELECT
         COUNT(*) FILTER (WHERE stage = 'Closed Won')                       AS won_count,
         COALESCE(SUM(value) FILTER (WHERE stage = 'Closed Won'), 0)::text  AS won_value,
         COUNT(*) FILTER (WHERE stage = 'Closed Lost')                      AS lost_count,
         COALESCE(SUM(value) FILTER (WHERE stage = 'Closed Lost'), 0)::text AS lost_value
       FROM deals
       WHERE stage IN ('Closed Won', 'Closed Lost')
         AND close_date >= $1
         AND close_date <= $2
         AND owner_id = $3`
    : `SELECT
         COUNT(*) FILTER (WHERE stage = 'Closed Won')                       AS won_count,
         COALESCE(SUM(value) FILTER (WHERE stage = 'Closed Won'), 0)::text  AS won_value,
         COUNT(*) FILTER (WHERE stage = 'Closed Lost')                      AS lost_count,
         COALESCE(SUM(value) FILTER (WHERE stage = 'Closed Lost'), 0)::text AS lost_value
       FROM deals
       WHERE stage IN ('Closed Won', 'Closed Lost')
         AND close_date >= $1
         AND close_date <= $2`;

  const aggParams = ownerFilter ? [startDate, endDate, ownerId] : [startDate, endDate];
  const aggResult = await pool.query<WinLossAggRow>(aggQuery, aggParams);
  const aggRow = aggResult.rows[0];

  const wonCount = parseInt(aggRow.won_count, 10);
  const wonValue = aggRow.won_value;
  const lostCount = parseInt(aggRow.lost_count, 10);
  const lostValue = aggRow.lost_value;

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

  return {
    wonCount,
    wonValue,
    lostCount,
    lostValue,
    winRate,
    lossReasonBreakdown,
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
