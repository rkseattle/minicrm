/**
 * AI token budget service — org-wide and per-user monthly token limit management.
 *
 * Design notes:
 *  - monthly_limit = 0 in ai_token_budgets means "unlimited" (no enforcement).
 *    Use a large positive value to set a real limit.
 *  - Admins are exempt from per-user budget enforcement but are counted in org totals.
 *  - recordTokenUsage is fire-and-forget; callers must not await it.
 *  - Budget resets automatically on the 1st of each month because each month gets
 *    its own row keyed by year_month ('YYYY-MM'). No cron job is needed.
 *
 * (MINCRM-458)
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { writeAuditEntry, type AuditActor } from './auditService.js';
import type {
  AiTokenBudgetsResponse,
  AiTokenBudgetStatusResponse,
  AiTokenBudgetStatus,
  AiTokenUsageRow,
  SetOrgTokenBudgetInput,
  SetUserTokenBudgetInput,
} from '@minicrm/shared/schemas/settingsSchema.js';

// ── Internal types ─────────────────────────────────────────────────────────────

interface BudgetRow {
  id: string;
  user_id: string | null;
  monthly_limit: number;
}

interface UsageRow {
  user_id: string;
  year_month: string;
  input_tokens: number;
  output_tokens: number;
}

interface ActiveUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns the current calendar month in 'YYYY-MM' format. */
function currentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Returns the current calendar date in 'YYYY-MM-DD' format. */
function currentDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Derives the threshold status from consumed percentage.
 * exceeded: 100%+, warning: 80–99%, ok: below 80%.
 */
function deriveStatus(percentage: number): AiTokenBudgetStatus {
  if (percentage >= 100) return 'exceeded';
  if (percentage >= 80) return 'warning';
  return 'ok';
}

// ── Read operations ────────────────────────────────────────────────────────────

/**
 * Returns the org-wide monthly token limit.
 * 0 means no limit is configured (unlimited).
 */
export async function getOrgTokenBudget(): Promise<number> {
  const result = await pool.query<BudgetRow>(
    `SELECT monthly_limit FROM ai_token_budgets WHERE user_id IS NULL LIMIT 1`,
  );
  return result.rows[0]?.monthly_limit ?? 0;
}

/**
 * Returns the effective monthly token limit for a user.
 * Checks for a per-user override first; falls back to the org default.
 * Returns 0 when no limit is configured (unlimited).
 */
export async function getEffectiveUserBudget(userId: string): Promise<number> {
  const result = await pool.query<BudgetRow>(
    `SELECT monthly_limit FROM ai_token_budgets
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  if (result.rows[0]) {
    return result.rows[0].monthly_limit;
  }
  return getOrgTokenBudget();
}

/**
 * Returns the number of tokens consumed by a user in the given year_month.
 * input_tokens + output_tokens combined.
 */
export async function getUserUsageForMonth(userId: string, yearMonth: string): Promise<number> {
  const result = await pool.query<UsageRow>(
    `SELECT input_tokens, output_tokens
     FROM ai_token_usage
     WHERE user_id = $1 AND year_month = $2`,
    [userId, yearMonth],
  );
  if (!result.rows[0]) return 0;
  return result.rows[0].input_tokens + result.rows[0].output_tokens;
}

/**
 * Returns the calling user's budget status for the current calendar month.
 * Admins always get status='ok' with limit=null (exempt from enforcement).
 */
export async function getUserBudgetStatus(
  userId: string,
  userRole: string,
): Promise<AiTokenBudgetStatusResponse> {
  const yearMonth = currentYearMonth();

  // Admins are exempt from per-user budget enforcement.
  if (userRole === 'admin') {
    const used = await getUserUsageForMonth(userId, yearMonth);
    return { limit: null, used, percentage: null, status: 'ok' };
  }

  // Fetch the effective limit and current usage concurrently — they are independent.
  const [limit, used] = await Promise.all([
    getEffectiveUserBudget(userId),
    getUserUsageForMonth(userId, yearMonth),
  ]);

  // limit = 0 means unlimited — no enforcement.
  if (limit === 0) {
    return { limit: null, used, percentage: null, status: 'ok' };
  }

  const percentage = Math.round((used / limit) * 100);
  return { limit, used, percentage, status: deriveStatus(percentage) };
}

/**
 * Returns the admin consumption summary: org total + per-user breakdown for the
 * current calendar month. Includes all active users.
 */
export async function getOrgConsumptionSummary(): Promise<AiTokenBudgetsResponse> {
  const yearMonth = currentYearMonth();

  const [orgLimit, usersResult, usageResult, budgetOverridesResult] = await Promise.all([
    getOrgTokenBudget(),
    pool.query<ActiveUserRow>(
      `SELECT id, name, email, role FROM users WHERE status = 'active' ORDER BY name`,
    ),
    // Scope usage to active users so org_used_this_month matches the per-user table sum.
    // Deactivated users' historical rows are preserved in ai_token_usage for auditing
    // but are excluded from the admin dashboard totals to prevent unexplained discrepancies.
    pool.query<UsageRow>(
      `SELECT u.user_id, u.input_tokens, u.output_tokens
       FROM ai_token_usage u
       JOIN users usr ON usr.id = u.user_id AND usr.status = 'active'
       WHERE u.year_month = $1`,
      [yearMonth],
    ),
    pool.query<BudgetRow>(
      `SELECT user_id, monthly_limit FROM ai_token_budgets WHERE user_id IS NOT NULL`,
    ),
  ]);

  const usageMap = new Map<string, number>();
  let orgTotal = 0;
  for (const row of usageResult.rows) {
    const total = row.input_tokens + row.output_tokens;
    usageMap.set(row.user_id, total);
    orgTotal += total;
  }

  const overrideMap = new Map<string, number>();
  for (const row of budgetOverridesResult.rows) {
    if (row.user_id !== null) {
      overrideMap.set(row.user_id, row.monthly_limit);
    }
  }

  const users: AiTokenUsageRow[] = usersResult.rows.map((user) => {
    const used = usageMap.get(user.id) ?? 0;

    // Admins have no per-user limit.
    if (user.role === 'admin') {
      return {
        user_id: user.id,
        user_name: user.name,
        user_email: user.email,
        user_role: user.role,
        limit: null,
        used,
        percentage: null,
        status: 'ok' as AiTokenBudgetStatus,
      };
    }

    const effectiveLimit = overrideMap.has(user.id) ? overrideMap.get(user.id)! : orgLimit;
    if (effectiveLimit === 0) {
      return {
        user_id: user.id,
        user_name: user.name,
        user_email: user.email,
        user_role: user.role,
        limit: null,
        used,
        percentage: null,
        status: 'ok' as AiTokenBudgetStatus,
      };
    }

    const percentage = Math.round((used / effectiveLimit) * 100);
    return {
      user_id: user.id,
      user_name: user.name,
      user_email: user.email,
      user_role: user.role,
      limit: effectiveLimit,
      used,
      percentage,
      status: deriveStatus(percentage),
    };
  });

  return {
    org_monthly_limit: orgLimit,
    org_used_this_month: orgTotal,
    users,
  };
}

// ── Write operations ───────────────────────────────────────────────────────────

/**
 * Sets the org-wide monthly token limit.
 * Writes an audit entry in the same transaction.
 */
export async function setOrgTokenBudget(
  input: SetOrgTokenBudgetInput,
  actor: AuditActor,
): Promise<number> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query<BudgetRow>(
      `SELECT monthly_limit FROM ai_token_budgets WHERE user_id IS NULL FOR UPDATE`,
    );
    const previousLimit = before.rows[0]?.monthly_limit ?? 0;

    // Update the single org-default row (user_id IS NULL). If somehow absent, insert it.
    // We avoid ON CONFLICT because the partial unique index is not a named constraint.
    const updateResult = await client.query(
      `UPDATE ai_token_budgets SET monthly_limit = $1, updated_at = now()
       WHERE user_id IS NULL`,
      [input.monthly_limit],
    );
    if (updateResult.rowCount === 0) {
      await client.query(
        `INSERT INTO ai_token_budgets (user_id, monthly_limit) VALUES (NULL, $1)`,
        [input.monthly_limit],
      );
    }

    await writeAuditEntry(client, {
      recordType: 'ai_settings',
      recordId: null,
      recordName: 'AI Token Budget',
      eventType: 'updated',
      fieldName: 'org_monthly_limit',
      oldValue: String(previousLimit),
      newValue: String(input.monthly_limit),
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return input.monthly_limit;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sets or removes a per-user monthly token limit override.
 * monthly_limit = null removes the override (user inherits org default).
 * Writes an audit entry in the same transaction.
 */
export async function setUserTokenBudget(
  userId: string,
  input: SetUserTokenBudgetInput,
  actor: AuditActor,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query<BudgetRow>(
      `SELECT monthly_limit FROM ai_token_budgets WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const previousLimit = before.rows[0]?.monthly_limit ?? null;

    if (input.monthly_limit === null) {
      // Remove the per-user override so the user inherits the org default.
      await client.query(`DELETE FROM ai_token_budgets WHERE user_id = $1`, [userId]);
    } else {
      // Update existing override if present; insert if absent.
      // ON CONFLICT (user_id) is not usable since the index is partial (WHERE user_id IS NOT NULL).
      const updateResult = await client.query(
        `UPDATE ai_token_budgets SET monthly_limit = $1, updated_at = now() WHERE user_id = $2`,
        [input.monthly_limit, userId],
      );
      if (updateResult.rowCount === 0) {
        await client.query(
          `INSERT INTO ai_token_budgets (user_id, monthly_limit) VALUES ($1, $2)`,
          [userId, input.monthly_limit],
        );
      }
    }

    await writeAuditEntry(client, {
      recordType: 'ai_settings',
      recordId: userId,
      recordName: 'AI Token Budget',
      eventType: 'updated',
      fieldName: 'user_monthly_limit',
      oldValue: previousLimit !== null ? String(previousLimit) : '(org default)',
      newValue: input.monthly_limit !== null ? String(input.monthly_limit) : '(org default)',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Records token usage for a user in the current calendar month, for budget
 * enforcement, and independently in ai_token_usage_daily for the usage/cost
 * dashboard (MINCRM-459). The two upserts are independent fire-and-forget
 * calls — a failure writing the daily/per-feature row must never affect the
 * monthly budget-enforcement row, and vice versa.
 *
 * Fire-and-forget — callers must not await this function. Errors are logged and swallowed.
 *
 * @param feature - Identifies which AI feature generated this usage (e.g. 'nli_chat').
 *   Defaults to 'nli_chat', the only feature that records usage today.
 */
export function recordTokenUsage(
  userId: string,
  inputTokens: number,
  outputTokens: number,
  feature: string = 'nli_chat',
): void {
  const yearMonth = currentYearMonth();
  pool
    .query(
      `INSERT INTO ai_token_usage (user_id, year_month, input_tokens, output_tokens, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, year_month) DO UPDATE
         SET input_tokens = ai_token_usage.input_tokens + $3,
             output_tokens = ai_token_usage.output_tokens + $4,
             updated_at = now()`,
      [userId, yearMonth, inputTokens, outputTokens],
    )
    .catch((err: unknown) => {
      logger.error({ err, userId, yearMonth }, 'recordTokenUsage: failed to persist token usage');
    });

  const usageDate = currentDate();
  pool
    .query(
      `INSERT INTO ai_token_usage_daily (user_id, usage_date, feature, input_tokens, output_tokens, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, usage_date, feature) DO UPDATE
         SET input_tokens = ai_token_usage_daily.input_tokens + $4,
             output_tokens = ai_token_usage_daily.output_tokens + $5,
             updated_at = now()`,
      [userId, usageDate, feature, inputTokens, outputTokens],
    )
    .catch((err: unknown) => {
      logger.error(
        { err, userId, usageDate, feature },
        'recordTokenUsage: failed to persist daily token usage',
      );
    });
}
