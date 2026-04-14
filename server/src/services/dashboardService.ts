/**
 * Dashboard service — business logic for the home dashboard summary.
 * All database access for dashboard metrics goes through this module.
 */

import pool from '../db.js';

/** PostgreSQL row shape for the task-count aggregation query */
interface TaskCountRow {
  overdue_tasks: string;
  tasks_due_today: string;
}

/** PostgreSQL row shape for the deal-totals aggregation query */
interface DealTotalsRow {
  open_deal_count: string;
  open_pipeline_value: string | null;
  weighted_pipeline_value: string | null;
}

/** PostgreSQL row shape for the per-stage breakdown query */
interface StageQueryRow {
  stage: string;
  count: string;
  value: string;
  weighted_value: string;
  sort_order: string;
}

/** A per-stage aggregate row returned from the database */
export interface StageBreakdownRow {
  stage: string;
  count: number;
  value: string; // PostgreSQL SUM(numeric) returns a string
  /** Sum of (value × effective_probability / 100) for deals in this stage */
  weightedValue: string;
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
  /**
   * Sum of (value × effective_probability / 100) for all open deals, as a decimal string.
   * effective_probability = deal.probability override if set, else stage default. (MINCRM-179)
   */
  weightedPipelineValue: string;
  /** Per-stage breakdown of open deal count and total value, ordered by pipeline funnel position */
  stageBreakdown: StageBreakdownRow[];
}

/**
 * Returns the dashboard summary metrics.
 * When ownerId is null (admin), metrics are team-wide.
 * When ownerId is a UUID (rep), metrics are scoped to that user's records.
 *
 * NOTE on timezone: CURRENT_DATE in PostgreSQL uses the database server's timezone (UTC in
 * the Docker setup). The client-side isOverdue() check in MyTasksPage uses
 * new Date().toISOString() which is also UTC. Both sides agree as long as the db runs in UTC.
 * If the db timezone is ever changed, both the SQL queries here and the client helper must be
 * updated together to avoid the overdue count on the dashboard disagreeing with the highlighted
 * rows in My Tasks.
 *
 * @param ownerId - UUID of the rep to scope data to, or null for team-wide (admin)
 * @returns Dashboard summary object
 */
export async function getDashboardSummary(ownerId: string | null): Promise<DashboardSummary> {
  const ownerFilter = ownerId !== null;

  // ── Task counts ──────────────────────────────────────────────────────────────
  // Two counts in one query using conditional aggregation.
  // "Today" is computed server-side using CURRENT_DATE so the timezone matches the db.
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
  // weighted_pipeline_value = SUM(value × COALESCE(d.probability, ps.probability, 0) / 100)
  // The three-argument COALESCE guards against deals whose stage has been deleted (ps absent).
  // effective_probability comes from a LEFT JOIN to pipeline_stages. (MINCRM-179)
  const dealTotalsQuery = ownerFilter
    ? `SELECT
         COUNT(*) AS open_deal_count,
         COALESCE(SUM(d.value), 0)::text AS open_pipeline_value,
         COALESCE(SUM(d.value * COALESCE(d.probability, ps.probability, 0) / 100.0), 0)::text AS weighted_pipeline_value
       FROM deals d
       LEFT JOIN pipeline_stages ps ON ps.name = d.stage
       WHERE d.stage NOT IN ('Closed Won', 'Closed Lost') AND d.owner_id = $1`
    : `SELECT
         COUNT(*) AS open_deal_count,
         COALESCE(SUM(d.value), 0)::text AS open_pipeline_value,
         COALESCE(SUM(d.value * COALESCE(d.probability, ps.probability, 0) / 100.0), 0)::text AS weighted_pipeline_value
       FROM deals d
       LEFT JOIN pipeline_stages ps ON ps.name = d.stage
       WHERE d.stage NOT IN ('Closed Won', 'Closed Lost')`;

  const dealParams = ownerFilter ? [ownerId] : [];
  const dealTotalsResult = await pool.query<DealTotalsRow>(dealTotalsQuery, dealParams);
  const dealTotalsRow = dealTotalsResult.rows[0];
  const openDealCount = parseInt(dealTotalsRow.open_deal_count, 10);
  const openPipelineValue = dealTotalsRow.open_pipeline_value ?? '0';
  const weightedPipelineValue = dealTotalsRow.weighted_pipeline_value ?? '0';

  // ── Per-stage breakdown ──────────────────────────────────────────────────────
  // Sort order comes from pipeline_stages.sort_order so custom stages sort correctly.
  // Deals whose stage has been deleted (ps absent) fall to sort_order = 2147483647 (INT max).
  const stageQuery = ownerFilter
    ? `SELECT
         d.stage,
         COUNT(*) AS count,
         COALESCE(SUM(d.value), 0)::text AS value,
         COALESCE(SUM(d.value * COALESCE(d.probability, ps.probability, 0) / 100.0), 0)::text AS weighted_value,
         COALESCE(MAX(ps.sort_order), 2147483647)::text AS sort_order
       FROM deals d
       LEFT JOIN pipeline_stages ps ON ps.name = d.stage
       WHERE d.stage NOT IN ('Closed Won', 'Closed Lost') AND d.owner_id = $1
       GROUP BY d.stage
       ORDER BY COALESCE(MAX(ps.sort_order), 2147483647)`
    : `SELECT
         d.stage,
         COUNT(*) AS count,
         COALESCE(SUM(d.value), 0)::text AS value,
         COALESCE(SUM(d.value * COALESCE(d.probability, ps.probability, 0) / 100.0), 0)::text AS weighted_value,
         COALESCE(MAX(ps.sort_order), 2147483647)::text AS sort_order
       FROM deals d
       LEFT JOIN pipeline_stages ps ON ps.name = d.stage
       WHERE d.stage NOT IN ('Closed Won', 'Closed Lost')
       GROUP BY d.stage
       ORDER BY COALESCE(MAX(ps.sort_order), 2147483647)`;

  const stageResult = await pool.query<StageQueryRow>(stageQuery, dealParams);

  const stageBreakdown: StageBreakdownRow[] = stageResult.rows.map((row) => ({
    stage: row.stage,
    count: parseInt(row.count, 10),
    value: row.value,
    weightedValue: row.weighted_value,
  }));

  return {
    overdueTasks,
    tasksDueToday,
    openDealCount,
    openPipelineValue,
    weightedPipelineValue,
    stageBreakdown,
  };
}
