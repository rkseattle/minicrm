/**
 * Dashboard service — business logic for the home dashboard summary.
 * All database access for dashboard metrics goes through this module.
 */

import pool from '../db.js';

/** A per-stage aggregate row returned from the database */
export interface StageBreakdownRow {
  stage: string;
  count: number;
  value: string; // PostgreSQL SUM(numeric) returns a string
}

/** Shape of the dashboard summary returned to the controller */
export interface DashboardSummary {
  /** Number of open tasks whose due_date is before today (YYYY-MM-DD comparison) */
  overdueTasks: number;
  /** Number of open tasks whose due_date equals today */
  tasksDueToday: number;
  /** Total count of open (non-closed) deals */
  openDealCount: number;
  /** Sum of value for all open deals, as a decimal string */
  openPipelineValue: string;
  /** Per-stage breakdown of open deal count and total value */
  stageBreakdown: StageBreakdownRow[];
}

/**
 * Returns the dashboard summary metrics.
 * When ownerId is null (admin), metrics are team-wide.
 * When ownerId is a UUID (rep), metrics are scoped to that user's records.
 *
 * @param ownerId - UUID of the rep to scope data to, or null for team-wide (admin)
 * @returns Dashboard summary object
 */
export async function getDashboardSummary(ownerId: string | null): Promise<DashboardSummary> {
  const ownerFilter = ownerId !== null;

  // ── Task counts ──────────────────────────────────────────────────────────────
  // Two counts in one query using conditional aggregation.
  // "Today" is computed server-side using CURRENT_DATE so the timezone matches the db.
  interface TaskCountRow {
    overdue_tasks: string;
    tasks_due_today: string;
  }

  const taskQuery = ownerFilter
    ? `SELECT
         COUNT(*) FILTER (WHERE status = 'open' AND due_date IS NOT NULL AND due_date < CURRENT_DATE) AS overdue_tasks,
         COUNT(*) FILTER (WHERE status = 'open' AND due_date = CURRENT_DATE) AS tasks_due_today
       FROM activities
       WHERE type = 'Task' AND owner_id = $1`
    : `SELECT
         COUNT(*) FILTER (WHERE status = 'open' AND due_date IS NOT NULL AND due_date < CURRENT_DATE) AS overdue_tasks,
         COUNT(*) FILTER (WHERE status = 'open' AND due_date = CURRENT_DATE) AS tasks_due_today
       FROM activities
       WHERE type = 'Task'`;

  const taskParams = ownerFilter ? [ownerId] : [];
  const taskResult = await pool.query<TaskCountRow>(taskQuery, taskParams);
  const taskRow = taskResult.rows[0];
  const overdueTasks = parseInt(taskRow.overdue_tasks, 10);
  const tasksDueToday = parseInt(taskRow.tasks_due_today, 10);

  // ── Deal aggregates ──────────────────────────────────────────────────────────
  // Exclude closed stages from all open-deal metrics.
  interface DealTotalsRow {
    open_deal_count: string;
    open_pipeline_value: string | null;
  }

  const dealTotalsQuery = ownerFilter
    ? `SELECT
         COUNT(*) AS open_deal_count,
         COALESCE(SUM(value), 0)::text AS open_pipeline_value
       FROM deals
       WHERE stage NOT IN ('Closed Won', 'Closed Lost') AND owner_id = $1`
    : `SELECT
         COUNT(*) AS open_deal_count,
         COALESCE(SUM(value), 0)::text AS open_pipeline_value
       FROM deals
       WHERE stage NOT IN ('Closed Won', 'Closed Lost')`;

  const dealParams = ownerFilter ? [ownerId] : [];
  const dealTotalsResult = await pool.query<DealTotalsRow>(dealTotalsQuery, dealParams);
  const dealTotalsRow = dealTotalsResult.rows[0];
  const openDealCount = parseInt(dealTotalsRow.open_deal_count, 10);
  const openPipelineValue = dealTotalsRow.open_pipeline_value ?? '0';

  // ── Per-stage breakdown ──────────────────────────────────────────────────────
  const stageQuery = ownerFilter
    ? `SELECT
         stage,
         COUNT(*) AS count,
         COALESCE(SUM(value), 0)::text AS value
       FROM deals
       WHERE stage NOT IN ('Closed Won', 'Closed Lost') AND owner_id = $1
       GROUP BY stage
       ORDER BY MIN(created_at) ASC`
    : `SELECT
         stage,
         COUNT(*) AS count,
         COALESCE(SUM(value), 0)::text AS value
       FROM deals
       WHERE stage NOT IN ('Closed Won', 'Closed Lost')
       GROUP BY stage
       ORDER BY MIN(created_at) ASC`;

  interface StageQueryRow {
    stage: string;
    count: string;
    value: string;
  }

  const stageResult = await pool.query<StageQueryRow>(stageQuery, dealParams);
  const stageBreakdown: StageBreakdownRow[] = stageResult.rows.map((row) => ({
    stage: row.stage,
    count: parseInt(row.count, 10),
    value: row.value,
  }));

  return {
    overdueTasks,
    tasksDueToday,
    openDealCount,
    openPipelineValue,
    stageBreakdown,
  };
}
