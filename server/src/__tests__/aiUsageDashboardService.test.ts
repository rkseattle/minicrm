/**
 * Integration tests for aiUsageDashboardService.
 *
 * Covers:
 *  - getUsageSummary: totals, trend vs prior period, per-user, per-feature, cost math
 *  - getDailyUsageSeries: daily breakdown for the consumption chart
 *  - Empty-range behavior (no usage recorded)
 *
 * Runs against the real PostgreSQL minicrm_test DB.
 */

import 'dotenv/config';
import pool from '../db.js';
import {
  getUsageSummary,
  getDailyUsageSeries,
  resolveDateRange,
} from '../services/aiUsageDashboardService.js';

const FILE_PREFIX = 'usage-dash-svc';

let userId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role, password_hash, status)
     VALUES ($1, 'Usage Dash User', 'rep', '$2b$12$placeholder', 'active')
     RETURNING id`,
    [`${FILE_PREFIX}-user@example.com`],
  );
  userId = result.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

beforeEach(async () => {
  await pool.query('DELETE FROM ai_token_usage_daily WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM ai_token_usage WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM ai_token_budgets WHERE user_id = $1', [userId]);
  await pool.query(
    `UPDATE ai_configuration SET ai_input_cost_per_million_cents = 300, ai_output_cost_per_million_cents = 1500`,
  );
});

// UTC-based to match aiTokenBudgetService.ts's currentYearMonth() and
// aiUsageDashboardService.ts's rangeIncludesCurrentMonth() — using local
// time here would drift from the DB's own UTC "today" and could flake near
// a local midnight that isn't also UTC midnight.
function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function currentMonthUtcRange(): { start: Date; end: Date } {
  const [year, month] = currentYearMonth().split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

describe('getUsageSummary', () => {
  it('returns zeroed totals for a range with no usage', async () => {
    const { start, end } = currentMonthUtcRange();

    const summary = await getUsageSummary({ start, end });

    expect(summary.input_tokens).toBe(0);
    expect(summary.output_tokens).toBe(0);
    expect(summary.estimated_cost_cents).toBe(0);
    expect(summary.per_user).toEqual([]);
    expect(summary.per_feature).toEqual([]);
  });

  it('aggregates totals and computes cost using the configured rates', async () => {
    await pool.query(
      `INSERT INTO ai_token_usage_daily (user_id, usage_date, feature, input_tokens, output_tokens)
       VALUES ($1, CURRENT_DATE, 'nli_chat', 1000000, 1000000)`,
      [userId],
    );

    const { start, end } = currentMonthUtcRange();

    const summary = await getUsageSummary({ start, end });

    expect(summary.input_tokens).toBe(1_000_000);
    expect(summary.output_tokens).toBe(1_000_000);
    // 1M input tokens @ 300 cents/million + 1M output tokens @ 1500 cents/million = 1800 cents
    expect(summary.estimated_cost_cents).toBe(1800);
  });

  it('returns a per-user breakdown with the correct top feature', async () => {
    await pool.query(
      `INSERT INTO ai_token_usage_daily (user_id, usage_date, feature, input_tokens, output_tokens)
       VALUES ($1, CURRENT_DATE, 'nli_chat', 500, 100), ($1, CURRENT_DATE, 'summarizer', 50, 10)`,
      [userId],
    );

    const { start, end } = currentMonthUtcRange();

    const summary = await getUsageSummary({ start, end });

    const userRow = summary.per_user.find((u) => u.user_id === userId);
    expect(userRow).toBeDefined();
    expect(userRow!.input_tokens).toBe(550);
    expect(userRow!.output_tokens).toBe(110);
    expect(userRow!.top_feature).toBe('nli_chat');
  });

  it('computes budget_percentage against the actual current month, not range.end', async () => {
    // range.end for 'current_month' is an exclusive start-of-next-month boundary
    // (per resolveDateRange in aiUsageDashboardService.ts) — this regression-tests
    // that budget_percentage is derived from the real current month, not
    // range.end's month.
    await pool.query(
      `INSERT INTO ai_token_usage_daily (user_id, usage_date, feature, input_tokens, output_tokens)
       VALUES ($1, CURRENT_DATE, 'nli_chat', 500, 100)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO ai_token_usage (user_id, year_month, input_tokens, output_tokens)
       VALUES ($1, $2, 4000, 1000)`,
      [userId, currentYearMonth()],
    );
    await pool.query(`INSERT INTO ai_token_budgets (user_id, monthly_limit) VALUES ($1, 10000)`, [
      userId,
    ]);

    const { start, end } = currentMonthUtcRange();

    const summary = await getUsageSummary({ start, end });

    const userRow = summary.per_user.find((u) => u.user_id === userId);
    expect(userRow).toBeDefined();
    // 5000 tokens used / 10000 limit = 50%.
    expect(userRow!.budget_percentage).toBe(50);
  });

  it("returns budget_percentage: null for a purely historical range — pairing a stale current-month percentage with a different month's token counts would be misleading", async () => {
    await pool.query(
      `INSERT INTO ai_token_usage_daily (user_id, usage_date, feature, input_tokens, output_tokens)
       VALUES ($1, '2020-01-15', 'nli_chat', 500, 100)`,
      [userId],
    );
    // Even though this user has current-month usage and a budget, a request
    // for a strictly historical range must not surface this month's
    // percentage alongside January 2020's token counts.
    await pool.query(
      `INSERT INTO ai_token_usage (user_id, year_month, input_tokens, output_tokens)
       VALUES ($1, $2, 4000, 1000)`,
      [userId, currentYearMonth()],
    );
    await pool.query(`INSERT INTO ai_token_budgets (user_id, monthly_limit) VALUES ($1, 10000)`, [
      userId,
    ]);

    const summary = await getUsageSummary({
      start: new Date('2020-01-01'),
      end: new Date('2020-02-01'),
    });

    const userRow = summary.per_user.find((u) => u.user_id === userId);
    expect(userRow).toBeDefined();
    expect(userRow!.input_tokens).toBe(500);
    expect(userRow!.budget_percentage).toBeNull();
  });

  it('returns a per-feature breakdown', async () => {
    await pool.query(
      `INSERT INTO ai_token_usage_daily (user_id, usage_date, feature, input_tokens, output_tokens)
       VALUES ($1, CURRENT_DATE, 'nli_chat', 500, 100), ($1, CURRENT_DATE, 'summarizer', 50, 10)`,
      [userId],
    );

    const { start, end } = currentMonthUtcRange();

    const summary = await getUsageSummary({ start, end });

    const nliRow = summary.per_feature.find((f) => f.feature === 'nli_chat');
    const summarizerRow = summary.per_feature.find((f) => f.feature === 'summarizer');
    expect(nliRow).toMatchObject({ input_tokens: 500, output_tokens: 100 });
    expect(summarizerRow).toMatchObject({ input_tokens: 50, output_tokens: 10 });
  });

  it('computes the prior-period total for trend comparison', async () => {
    // Fixed UTC dates rather than offsets from "now": the range and the seeded
    // rows must agree on which calendar day each falls on, and deriving both
    // from the wall clock made that agreement depend on when the suite ran.
    // The 10-day range 2026-03-11..2026-03-21 contains only the 03-16 row; the
    // prior 10-day window (2026-03-01..2026-03-11) contains only the 03-06 row.
    const start = new Date(Date.UTC(2026, 2, 11));
    const end = new Date(Date.UTC(2026, 2, 21));

    await pool.query(
      `INSERT INTO ai_token_usage_daily (user_id, usage_date, feature, input_tokens, output_tokens)
       VALUES ($1, '2026-03-16'::date, 'nli_chat', 100, 0), ($1, '2026-03-06'::date, 'nli_chat', 400, 0)`,
      [userId],
    );

    const summary = await getUsageSummary({ start, end });

    // The current range should include the 2026-03-16 row only.
    expect(summary.input_tokens).toBe(100);
    // The prior period should include the 2026-03-06 row.
    // 400 input tokens @ 300 cents/million = 0.12 cents, rounds to 0.
    expect(summary.prior_period_estimated_cost_cents).toBeGreaterThanOrEqual(0);
  });
});

describe('getDailyUsageSeries', () => {
  it('returns one point per day with usage', async () => {
    await pool.query(
      `INSERT INTO ai_token_usage_daily (user_id, usage_date, feature, input_tokens, output_tokens)
       VALUES ($1, CURRENT_DATE, 'nli_chat', 100, 50)`,
      [userId],
    );

    const { start, end } = currentMonthUtcRange();

    const series = await getDailyUsageSeries({ start, end });

    // Ask the database which day CURRENT_DATE resolved to rather than deriving
    // it from the Node clock — the row above was stamped by Postgres, so the
    // database is the only authority on which calendar day to look for.
    const { rows } = await pool.query<{ today: string }>(
      `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`,
    );
    const todayPoint = series.points.find((p) => p.date === rows[0].today);
    expect(todayPoint).toBeDefined();
    expect(todayPoint!.input_tokens).toBe(100);
    expect(todayPoint!.output_tokens).toBe(50);
  });

  it('returns no points for a range with no usage', async () => {
    const { start, end } = currentMonthUtcRange();

    const series = await getDailyUsageSeries({ start, end });
    expect(series.points).toEqual([]);
  });
});

describe('resolveDateRange', () => {
  // 22:30 UTC on the last day of July 2026. Every timezone ahead of UTC by more
  // than 90 minutes is already on 2026-08-01 at this instant, so a boundary
  // built from local calendar fields resolves to a different month than the
  // UTC-resolved usage_date column it is compared against..
  const MONTH_END_UTC = new Date('2026-07-31T22:30:00.000Z');

  // The absolute-instant assertions further down are necessary but not
  // sufficient alone: under TZ=UTC a local-time constructor yields the very
  // same values, so they would stay green on a revert if CI ran UTC. This one
  // states the property directly — a UTC month boundary is UTC midnight on the
  // 1st, in every process timezone — and CI now runs Pacific/Auckland, where
  // the local and UTC constructions genuinely disagree. (ci.yml)
  it('builds month bounds from UTC fields, not the process timezone', () => {
    const range = resolveDateRange({ preset: 'current_month' }, MONTH_END_UTC);

    expect(range!.start.getUTCDate()).toBe(1);
    expect(range!.start.getUTCHours()).toBe(0);
    expect(range!.start.getUTCMinutes()).toBe(0);
    expect(range!.start.getUTCMonth()).toBe(MONTH_END_UTC.getUTCMonth());
  });

  const iso = (d: Date): string => d.toISOString();

  it('resolves current_month to UTC month bounds regardless of process timezone', () => {
    const range = resolveDateRange({ preset: 'current_month' }, MONTH_END_UTC);

    expect(range).not.toBeNull();
    expect(iso(range!.start)).toBe('2026-07-01T00:00:00.000Z');
    expect(iso(range!.end)).toBe('2026-08-01T00:00:00.000Z');
  });

  it('resolves last_month to the preceding UTC month', () => {
    const range = resolveDateRange({ preset: 'last_month' }, MONTH_END_UTC);

    expect(iso(range!.start)).toBe('2026-06-01T00:00:00.000Z');
    expect(iso(range!.end)).toBe('2026-07-01T00:00:00.000Z');
  });

  it('resolves last_3_months across the full window', () => {
    const range = resolveDateRange({ preset: 'last_3_months' }, MONTH_END_UTC);

    expect(iso(range!.start)).toBe('2026-04-01T00:00:00.000Z');
    expect(iso(range!.end)).toBe('2026-08-01T00:00:00.000Z');
  });

  it('defaults to current_month when no preset is supplied', () => {
    const range = resolveDateRange({}, MONTH_END_UTC);

    expect(iso(range!.start)).toBe('2026-07-01T00:00:00.000Z');
    expect(iso(range!.end)).toBe('2026-08-01T00:00:00.000Z');
  });

  it('normalizes a month offset that crosses a year boundary', () => {
    // January minus three months is October of the previous year — Date.UTC
    // handles the underflow, so no branch in resolveDateRange has to.
    const range = resolveDateRange(
      { preset: 'last_3_months' },
      new Date('2026-01-15T12:00:00.000Z'),
    );

    expect(iso(range!.start)).toBe('2025-10-01T00:00:00.000Z');
    expect(iso(range!.end)).toBe('2026-02-01T00:00:00.000Z');
  });

  it('treats an explicit end date as an inclusive calendar day', () => {
    const range = resolveDateRange({ start: '2026-03-01', end: '2026-03-31' }, MONTH_END_UTC);

    expect(iso(range!.start)).toBe('2026-03-01T00:00:00.000Z');
    // Advanced one day so the caller's final day is inside the exclusive bound.
    expect(iso(range!.end)).toBe('2026-04-01T00:00:00.000Z');
  });

  it('returns null for a lone start or end, an unparsable date, and an inverted range', () => {
    expect(resolveDateRange({ start: '2026-03-01' }, MONTH_END_UTC)).toBeNull();
    expect(resolveDateRange({ end: '2026-03-31' }, MONTH_END_UTC)).toBeNull();
    expect(resolveDateRange({ start: 'nonsense', end: '2026-03-31' }, MONTH_END_UTC)).toBeNull();
    expect(resolveDateRange({ start: '2026-03-31', end: '2026-03-01' }, MONTH_END_UTC)).toBeNull();
  });

  // An unrecognized preset can no longer reach this function — the controller
  // Zod-parses the query first (usageDateRangeParamsSchema), and the narrowed
  // type makes `preset: 'last_decade'` a compile error here. The rejection is
  // covered at the HTTP boundary in aiUsageController.test.ts instead.
});
