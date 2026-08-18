/**
 * Migration 040: Add B-tree indexes on deals.stage and deals.close_date.
 *
 * Primary beneficiaries:
 *
 *   reportService.ts → getWinLossReport()
 *     Filters WHERE stage IN ('Closed Won', 'Closed Lost')
 *       AND close_date >= $1 AND close_date <= $2 on every invocation.
 *     Without indexes these are sequential scans across the full deals table.
 *
 *   dashboardService.ts → open-deal metrics
 *     Filters WHERE stage NOT IN (...closed stages...) to count/sum open deals.
 *
 * Three indexes are added:
 *
 *   deals_stage_idx          — serves single-column stage filters (dashboard open-deal
 *                              metrics, any future widget filtering by stage alone)
 *   deals_close_date_idx     — serves single-column close_date range scans (e.g. a
 *                              future "deals closing this month" widget)
 *   deals_stage_close_date_idx — composite (stage, close_date); satisfies the Win/Loss
 *                              report's combined equality + range predicate in one index
 *                              scan. Column order: stage first (equality/IN) then
 *                              close_date (range) — correct for this query shape.
 *
 * The two single-column indexes are retained alongside the composite because PostgreSQL
 * can use them independently for queries that filter on only one of the two columns.
 *
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createIndex('deals', 'stage');
  pgm.createIndex('deals', 'close_date');
  pgm.createIndex('deals', ['stage', 'close_date'], {
    name: 'deals_stage_close_date_idx',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex('deals', ['stage', 'close_date'], { name: 'deals_stage_close_date_idx' });
  pgm.dropIndex('deals', 'close_date');
  pgm.dropIndex('deals', 'stage');
};
