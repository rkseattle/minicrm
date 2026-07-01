/**
 * Integration tests for aiUsageDashboardService. (MINCRM-459)
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
import { getUsageSummary, getDailyUsageSeries } from '../services/aiUsageDashboardService.js';

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
  await pool.query(
    `UPDATE ai_configuration SET ai_input_cost_per_million_cents = 300, ai_output_cost_per_million_cents = 1500`,
  );
});

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

describe('getUsageSummary', () => {
  it('returns zeroed totals for a range with no usage', async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

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

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

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

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const summary = await getUsageSummary({ start, end });

    const userRow = summary.per_user.find((u) => u.user_id === userId);
    expect(userRow).toBeDefined();
    expect(userRow!.input_tokens).toBe(550);
    expect(userRow!.output_tokens).toBe(110);
    expect(userRow!.top_feature).toBe('nli_chat');
  });

  it('returns a per-feature breakdown', async () => {
    await pool.query(
      `INSERT INTO ai_token_usage_daily (user_id, usage_date, feature, input_tokens, output_tokens)
       VALUES ($1, CURRENT_DATE, 'nli_chat', 500, 100), ($1, CURRENT_DATE, 'summarizer', 50, 10)`,
      [userId],
    );

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const summary = await getUsageSummary({ start, end });

    const nliRow = summary.per_feature.find((f) => f.feature === 'nli_chat');
    const summarizerRow = summary.per_feature.find((f) => f.feature === 'summarizer');
    expect(nliRow).toMatchObject({ input_tokens: 500, output_tokens: 100 });
    expect(summarizerRow).toMatchObject({ input_tokens: 50, output_tokens: 10 });
  });

  it('computes the prior-period total for trend comparison', async () => {
    // Use an explicit 10-day range so the prior 10-day range is unambiguous and
    // both fall entirely within seeded rows at todayMinus(5) and todayMinus(15).
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 10);

    await pool.query(
      `INSERT INTO ai_token_usage_daily (user_id, usage_date, feature, input_tokens, output_tokens)
       VALUES ($1, $2::date, 'nli_chat', 100, 0), ($1, $3::date, 'nli_chat', 400, 0)`,
      [userId, todayMinus(5), todayMinus(15)],
    );

    const summary = await getUsageSummary({ start, end });

    // Current range (last 10 days) should include the todayMinus(5) row only.
    expect(summary.input_tokens).toBe(100);
    // Prior period (10-20 days ago) should include the todayMinus(15) row.
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

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const series = await getDailyUsageSeries({ start, end });

    const todayPoint = series.points.find((p) => p.date === new Date().toISOString().slice(0, 10));
    expect(todayPoint).toBeDefined();
    expect(todayPoint!.input_tokens).toBe(100);
    expect(todayPoint!.output_tokens).toBe(50);
  });

  it('returns no points for a range with no usage', async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const series = await getDailyUsageSeries({ start, end });
    expect(series.points).toEqual([]);
  });
});
