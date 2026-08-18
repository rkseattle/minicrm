/**
 * Integration tests for aiTokenBudgetService.
 *
 * Covers:
 *  - getOrgTokenBudget: default 0 (unlimited), after explicit set
 *  - getEffectiveUserBudget: per-user override, fallback to org default
 *  - getUserUsageForMonth: no usage, after recording
 *  - getUserBudgetStatus: admin exemption, rep at 0%/79%/80%/100%+, limit=0=unlimited
 *  - setOrgTokenBudget: persists, writes audit entry
 *  - setUserTokenBudget: sets override, removes override (null)
 *  - recordTokenUsage: upserts correctly, accumulates across calls
 *  - getOrgConsumptionSummary: org total, per-user breakdown
 *
 * Runs against the real PostgreSQL minicrm_test DB.
 */

import 'dotenv/config';
import pool from '../db.js';
import {
  getOrgTokenBudget,
  getEffectiveUserBudget,
  getUserUsageForMonth,
  getUserBudgetStatus,
  setOrgTokenBudget,
  setUserTokenBudget,
  recordTokenUsage,
  getOrgConsumptionSummary,
} from '../services/aiTokenBudgetService.js';

const FILE_PREFIX = 'atb-svc';
const ACTOR = { id: '00000000-0000-0000-0000-000000000001', name: 'Test Admin' };
const CURRENT_MONTH = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

let adminId: string;
let repId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const adminResult = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role, password_hash, status)
     VALUES ($1, 'Budget Admin', 'admin', '$2b$12$placeholder', 'active')
     RETURNING id`,
    [`${FILE_PREFIX}-admin@example.com`],
  );
  adminId = adminResult.rows[0].id;

  const repResult = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role, password_hash, status)
     VALUES ($1, 'Budget Rep', 'rep', '$2b$12$placeholder', 'active')
     RETURNING id`,
    [`${FILE_PREFIX}-rep@example.com`],
  );
  repId = repResult.rows[0].id;
});

beforeEach(async () => {
  // Reset org budget to 0 (unlimited) and remove any per-user overrides for test users.
  await pool.query(`UPDATE ai_token_budgets SET monthly_limit = 0 WHERE user_id IS NULL`);
  await pool.query(`DELETE FROM ai_token_budgets WHERE user_id IN ($1, $2)`, [adminId, repId]);
  // Clear all usage for the current month for test users.
  await pool.query(`DELETE FROM ai_token_usage WHERE user_id IN ($1, $2)`, [adminId, repId]);
  await pool.query(`DELETE FROM ai_token_usage_daily WHERE user_id IN ($1, $2)`, [adminId, repId]);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── getOrgTokenBudget ─────────────────────────────────────────────────────────

describe('getOrgTokenBudget', () => {
  it('returns 0 (unlimited) when no limit is configured', async () => {
    await expect(getOrgTokenBudget()).resolves.toBe(0);
  });

  it('returns the configured limit after setOrgTokenBudget', async () => {
    await setOrgTokenBudget({ monthly_limit: 500_000 }, ACTOR);
    await expect(getOrgTokenBudget()).resolves.toBe(500_000);
  });
});

// ── getEffectiveUserBudget ────────────────────────────────────────────────────

describe('getEffectiveUserBudget', () => {
  it('falls back to org default when no user override exists', async () => {
    await setOrgTokenBudget({ monthly_limit: 200_000 }, ACTOR);
    await expect(getEffectiveUserBudget(repId)).resolves.toBe(200_000);
  });

  it('returns the per-user override when one is set', async () => {
    await setOrgTokenBudget({ monthly_limit: 200_000 }, ACTOR);
    await setUserTokenBudget(repId, { monthly_limit: 50_000 }, ACTOR);
    await expect(getEffectiveUserBudget(repId)).resolves.toBe(50_000);
  });

  it('returns org default after per-user override is removed (null)', async () => {
    await setOrgTokenBudget({ monthly_limit: 200_000 }, ACTOR);
    await setUserTokenBudget(repId, { monthly_limit: 50_000 }, ACTOR);
    await setUserTokenBudget(repId, { monthly_limit: null }, ACTOR);
    await expect(getEffectiveUserBudget(repId)).resolves.toBe(200_000);
  });
});

// ── getUserUsageForMonth ──────────────────────────────────────────────────────

describe('getUserUsageForMonth', () => {
  it('returns 0 when no usage recorded', async () => {
    await expect(getUserUsageForMonth(repId, CURRENT_MONTH)).resolves.toBe(0);
  });

  it('returns combined input+output tokens after recordTokenUsage', async () => {
    recordTokenUsage(repId, 1000, 500);
    // Give the fire-and-forget promise time to settle.
    await new Promise((r) => setTimeout(r, 100));
    await expect(getUserUsageForMonth(repId, CURRENT_MONTH)).resolves.toBe(1500);
  });

  it('accumulates usage across multiple calls', async () => {
    recordTokenUsage(repId, 1000, 500);
    await new Promise((r) => setTimeout(r, 100));
    recordTokenUsage(repId, 200, 100);
    await new Promise((r) => setTimeout(r, 100));
    await expect(getUserUsageForMonth(repId, CURRENT_MONTH)).resolves.toBe(1800);
  });
});

// ── getUserBudgetStatus ───────────────────────────────────────────────────────

describe('getUserBudgetStatus', () => {
  it('admins always get status=ok with limit=null regardless of usage', async () => {
    await setOrgTokenBudget({ monthly_limit: 1000 }, ACTOR);
    // Seed more usage than the limit to confirm admin exemption.
    await pool.query(
      `INSERT INTO ai_token_usage (user_id, year_month, input_tokens, output_tokens)
       VALUES ($1, $2, 2000, 0)`,
      [adminId, CURRENT_MONTH],
    );
    const status = await getUserBudgetStatus(adminId, 'admin');
    expect(status.limit).toBeNull();
    expect(status.status).toBe('ok');
  });

  it('returns ok when limit=0 (unlimited)', async () => {
    // org limit stays 0 (unlimited)
    const status = await getUserBudgetStatus(repId, 'rep');
    expect(status.limit).toBeNull();
    expect(status.status).toBe('ok');
  });

  it('returns ok when usage is below 80%', async () => {
    await setOrgTokenBudget({ monthly_limit: 100_000 }, ACTOR);
    await pool.query(
      `INSERT INTO ai_token_usage (user_id, year_month, input_tokens, output_tokens)
       VALUES ($1, $2, 79_000, 0)`,
      [repId, CURRENT_MONTH],
    );
    const status = await getUserBudgetStatus(repId, 'rep');
    expect(status.status).toBe('ok');
    expect(status.percentage).toBe(79);
  });

  it('returns warning at exactly 80%', async () => {
    await setOrgTokenBudget({ monthly_limit: 100_000 }, ACTOR);
    await pool.query(
      `INSERT INTO ai_token_usage (user_id, year_month, input_tokens, output_tokens)
       VALUES ($1, $2, 80_000, 0)`,
      [repId, CURRENT_MONTH],
    );
    const status = await getUserBudgetStatus(repId, 'rep');
    expect(status.status).toBe('warning');
    expect(status.percentage).toBe(80);
  });

  it('returns exceeded at 100%', async () => {
    await setOrgTokenBudget({ monthly_limit: 100_000 }, ACTOR);
    await pool.query(
      `INSERT INTO ai_token_usage (user_id, year_month, input_tokens, output_tokens)
       VALUES ($1, $2, 100_000, 0)`,
      [repId, CURRENT_MONTH],
    );
    const status = await getUserBudgetStatus(repId, 'rep');
    expect(status.status).toBe('exceeded');
    expect(status.percentage).toBe(100);
  });

  it('returns exceeded when usage exceeds limit (over 100%)', async () => {
    await setOrgTokenBudget({ monthly_limit: 100_000 }, ACTOR);
    await pool.query(
      `INSERT INTO ai_token_usage (user_id, year_month, input_tokens, output_tokens)
       VALUES ($1, $2, 150_000, 0)`,
      [repId, CURRENT_MONTH],
    );
    const status = await getUserBudgetStatus(repId, 'rep');
    expect(status.status).toBe('exceeded');
    expect(status.percentage).toBeGreaterThan(100);
  });

  it('uses per-user override rather than org limit', async () => {
    await setOrgTokenBudget({ monthly_limit: 100_000 }, ACTOR);
    await setUserTokenBudget(repId, { monthly_limit: 10_000 }, ACTOR);
    await pool.query(
      `INSERT INTO ai_token_usage (user_id, year_month, input_tokens, output_tokens)
       VALUES ($1, $2, 9_000, 0)`,
      [repId, CURRENT_MONTH],
    );
    const status = await getUserBudgetStatus(repId, 'rep');
    // 9000/10000 = 90%, so warning
    expect(status.status).toBe('warning');
    expect(status.limit).toBe(10_000);
  });
});

// ── setOrgTokenBudget ─────────────────────────────────────────────────────────

describe('setOrgTokenBudget', () => {
  it('persists the new org limit', async () => {
    await setOrgTokenBudget({ monthly_limit: 1_000_000 }, ACTOR);
    await expect(getOrgTokenBudget()).resolves.toBe(1_000_000);
  });

  it('is idempotent (upsert)', async () => {
    await setOrgTokenBudget({ monthly_limit: 100_000 }, ACTOR);
    await setOrgTokenBudget({ monthly_limit: 200_000 }, ACTOR);
    await expect(getOrgTokenBudget()).resolves.toBe(200_000);
  });

  it('writes an audit entry', async () => {
    await setOrgTokenBudget({ monthly_limit: 500_000 }, ACTOR);
    const result = await pool.query(
      // Scoped by changed_by_id: record_type + field_name are shared with
      // aiTokenBudgetController.test.ts, which is NOT in SERIAL_FILES and so
      // runs in the parallel project alongside this one. A single interleaved
      // controller write would take the LIMIT 1 slot.
      `SELECT * FROM audit_log
       WHERE record_type = 'ai_settings' AND field_name = 'org_monthly_limit'
         AND changed_by_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [ACTOR.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].new_value).toBe('500000');
    expect(result.rows[0].changed_by_name).toBe(ACTOR.name);
  });
});

// ── setUserTokenBudget ────────────────────────────────────────────────────────

describe('setUserTokenBudget', () => {
  it('sets a per-user override', async () => {
    await setUserTokenBudget(repId, { monthly_limit: 25_000 }, ACTOR);
    await expect(getEffectiveUserBudget(repId)).resolves.toBe(25_000);
  });

  it('removes the override when monthly_limit is null', async () => {
    await setUserTokenBudget(repId, { monthly_limit: 25_000 }, ACTOR);
    await setUserTokenBudget(repId, { monthly_limit: null }, ACTOR);
    const result = await pool.query(`SELECT * FROM ai_token_budgets WHERE user_id = $1`, [repId]);
    expect(result.rows).toHaveLength(0);
  });

  it('writes an audit entry for the change', async () => {
    await setUserTokenBudget(repId, { monthly_limit: 75_000 }, ACTOR);
    const result = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'ai_settings' AND field_name = 'user_monthly_limit'
         AND record_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [repId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].new_value).toBe('75000');
  });
});

// ── getOrgConsumptionSummary ──────────────────────────────────────────────────

describe('getOrgConsumptionSummary', () => {
  it('returns org total and per-user breakdown', async () => {
    await setOrgTokenBudget({ monthly_limit: 100_000 }, ACTOR);
    await pool.query(
      `INSERT INTO ai_token_usage (user_id, year_month, input_tokens, output_tokens)
       VALUES ($1, $2, 10_000, 5_000), ($3, $2, 20_000, 0)`,
      [adminId, CURRENT_MONTH, repId],
    );

    const summary = await getOrgConsumptionSummary();

    // Org total must include both users.
    expect(summary.org_used_this_month).toBeGreaterThanOrEqual(35_000);

    // Admin row should have limit=null and status=ok.
    const adminRow = summary.users.find((u) => u.user_id === adminId);
    expect(adminRow).toBeDefined();
    expect(adminRow!.limit).toBeNull();
    expect(adminRow!.status).toBe('ok');

    // Rep row should reflect correct percentage.
    const repRow = summary.users.find((u) => u.user_id === repId);
    expect(repRow).toBeDefined();
    expect(repRow!.limit).toBe(100_000);
    expect(repRow!.used).toBe(20_000);
    expect(repRow!.percentage).toBe(20);
    expect(repRow!.status).toBe('ok');
  });
});

// ── recordTokenUsage: dual-write to ai_token_usage_daily ────────

describe('recordTokenUsage — daily/per-feature dual-write', () => {
  it('writes to both ai_token_usage and ai_token_usage_daily', async () => {
    recordTokenUsage(repId, 1000, 500, 'nli_chat');

    // Both writes are fire-and-forget; poll briefly for the daily row to land.
    let dailyRow: { input_tokens: number; output_tokens: number; feature: string } | undefined;
    for (let attempt = 0; attempt < 10 && !dailyRow; attempt++) {
      const result = await pool.query<{
        input_tokens: number;
        output_tokens: number;
        feature: string;
      }>(
        `SELECT input_tokens, output_tokens, feature FROM ai_token_usage_daily
         WHERE user_id = $1 AND usage_date = CURRENT_DATE AND feature = 'nli_chat'`,
        [repId],
      );
      dailyRow = result.rows[0];
      if (!dailyRow) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(dailyRow).toBeDefined();
    expect(dailyRow!.input_tokens).toBe(1000);
    expect(dailyRow!.output_tokens).toBe(500);

    const monthlyUsed = await getUserUsageForMonth(repId, CURRENT_MONTH);
    expect(monthlyUsed).toBeGreaterThanOrEqual(1500);
  });

  it('accumulates across multiple calls for the same day/feature', async () => {
    recordTokenUsage(repId, 100, 50, 'nli_chat');
    recordTokenUsage(repId, 200, 25, 'nli_chat');

    let dailyRow: { input_tokens: number; output_tokens: number } | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await pool.query<{ input_tokens: number; output_tokens: number }>(
        `SELECT input_tokens, output_tokens FROM ai_token_usage_daily
         WHERE user_id = $1 AND usage_date = CURRENT_DATE AND feature = 'nli_chat'`,
        [repId],
      );
      dailyRow = result.rows[0];
      if (dailyRow && dailyRow.input_tokens === 300) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(dailyRow?.input_tokens).toBe(300);
    expect(dailyRow?.output_tokens).toBe(75);
  });

  it('defaults feature to nli_chat when omitted', async () => {
    recordTokenUsage(repId, 42, 7);

    let dailyRow: { feature: string } | undefined;
    for (let attempt = 0; attempt < 10 && !dailyRow; attempt++) {
      const result = await pool.query<{ feature: string }>(
        `SELECT feature FROM ai_token_usage_daily
         WHERE user_id = $1 AND usage_date = CURRENT_DATE AND input_tokens = 42`,
        [repId],
      );
      dailyRow = result.rows[0];
      if (!dailyRow) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(dailyRow?.feature).toBe('nli_chat');
  });
});
