/**
 * Churn/expansion signal detection service — nightly AI job that scans
 * closed-won accounts for churn risk and expansion opportunity signals. (MINCRM-469)
 *
 * detectChurnExpansionSignals() is the cron entry point (server/src/server.ts).
 * Inserts a new signal row per account per run; clears a prior active signal
 * when new positive activity contradicts it. The read path
 * (getAccountChurnExpansionSignal / listChurnExpansionSignals) always serves
 * the latest active (non-cleared) signal — no AI call on the request path.
 *
 * Follows the same nightly-job shape as winLossAnalysisService: single
 * exported async function, per-account error isolation, structured logger
 * calls, IS_E2E stub branch.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { createNotification } from './notificationFeedService.js';
import { SYSTEM_ACTOR, writeAuditEntry } from './auditService.js';
import type {
  AccountChurnExpansionSignal,
  AccountChurnExpansionResponse,
  ChurnExpansionListResponse,
  ChurnExpansionSignalType,
} from '@minicrm/shared/schemas/churnExpansionSchema.js';

const IS_E2E = process.env.E2E === 'true';

/** Signals above this confidence trigger an in-app notification to the account owner. */
const HIGH_CONFIDENCE_NOTIFICATION_THRESHOLD = 0.85;

/**
 * Runs fn inside a BEGIN/COMMIT/ROLLBACK transaction on a single client, so the
 * signal clear+insert and its audit entry can never be observed half-applied.
 */
async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
  churn_expansion_confidence_threshold: string;
}

interface ClosedWonAccountSignals {
  id: string;
  name: string;
  ownerId: string;
  recentActivityCount: number;
  daysSinceLastActivity: number | null;
  recentNotes: string[];
}

const SIGNAL_TOOL_NAME = 'report_churn_expansion_signal';

const SIGNAL_TOOL: Anthropic.Messages.Tool = {
  name: SIGNAL_TOOL_NAME,
  description: 'Reports a churn risk or expansion opportunity signal for a closed-won account.',
  input_schema: {
    type: 'object',
    properties: {
      signal_detected: {
        type: 'boolean',
        description:
          'True only when there is clear evidence of churn risk or expansion opportunity.',
      },
      signal_type: {
        type: 'string',
        enum: ['churn_risk', 'expansion'],
        description: 'Required when signal_detected is true.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence 0-1. Required when signal_detected is true.',
      },
      contributing_factors: {
        type: 'array',
        items: { type: 'string' },
        description:
          '1-2 short factors supporting the signal. Required when signal_detected is true.',
      },
    },
    required: ['signal_detected'],
  },
};

function buildSystemPrompt(): string {
  return (
    'You monitor a closed-won CRM account for churn risk and expansion opportunity signals. ' +
    'Churn signals: declining activity frequency, negative sentiment trend in notes, missed ' +
    'scheduled check-ins, rep silence for an extended period, mentions of a competitor in recent ' +
    'notes. Expansion signals: mentions of new teams or departments, growing headcount, new use ' +
    'cases surfaced in notes, increased engagement frequency, inbound contact from new ' +
    'stakeholders. Only report signal_detected=true with clear evidence — do not guess. Call the ' +
    'report_churn_expansion_signal tool exactly once.'
  );
}

async function getAiConfig(): Promise<AiConfigRow | null> {
  const result = await pool.query<AiConfigRow>(
    `SELECT model, api_key_encrypted, api_key_key_version, base_url, enabled,
            churn_expansion_confidence_threshold
     FROM ai_configuration
     LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

/** Closed-won accounts with activity history, per the ticket's "with activity history" scope. */
async function gatherClosedWonAccounts(): Promise<ClosedWonAccountSignals[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    owner_id: string;
    recent_activity_count: string;
    last_activity_at: Date | null;
    recent_notes: string[] | null;
  }>(
    `SELECT
       a.id, a.name, a.owner_id,
       (SELECT COUNT(*) FROM activities act WHERE act.account_id = a.id AND act.created_at >= now() - interval '30 days') AS recent_activity_count,
       (SELECT MAX(act.created_at) FROM activities act WHERE act.account_id = a.id) AS last_activity_at,
       (SELECT array_agg(act.notes ORDER BY act.created_at DESC)
          FROM (SELECT notes, created_at FROM activities WHERE account_id = a.id AND notes IS NOT NULL ORDER BY created_at DESC LIMIT 5) act
       ) AS recent_notes
     FROM accounts a
     WHERE EXISTS (SELECT 1 FROM deals d WHERE d.account_id = a.id AND d.stage = 'Closed Won')
       AND EXISTS (SELECT 1 FROM activities act WHERE act.account_id = a.id)`,
  );

  const now = Date.now();
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    recentActivityCount: parseInt(row.recent_activity_count, 10),
    daysSinceLastActivity: row.last_activity_at
      ? Math.floor((now - row.last_activity_at.getTime()) / (1000 * 60 * 60 * 24))
      : null,
    recentNotes: row.recent_notes ?? [],
  }));
}

/**
 * Nightly cron entry point. Scans every closed-won account with activity
 * history, asks Claude for a churn/expansion signal, and stores results —
 * clearing a prior active signal when the new evidence contradicts it.
 * No-ops per-account on error so one bad account doesn't abort the run.
 */
export async function detectChurnExpansionSignals(): Promise<void> {
  const config = await getAiConfig();
  if (!config?.enabled) {
    logger.info('churnExpansion: skipped — AI is not enabled');
    return;
  }

  const accounts = await gatherClosedWonAccounts();
  logger.info({ accountCount: accounts.length }, 'churnExpansion: nightly run starting');

  for (const account of accounts) {
    try {
      await processAccount(account, config);
    } catch (err) {
      logger.error({ err, accountId: account.id }, 'churnExpansion: failed to process account');
    }
  }

  logger.info('churnExpansion: nightly run complete');
}

async function processAccount(
  account: ClosedWonAccountSignals,
  config: AiConfigRow,
): Promise<void> {
  let result: {
    signalType: ChurnExpansionSignalType;
    confidence: number;
    factors: string[];
  } | null = null;

  if (IS_E2E) {
    result = null;
  } else {
    if (!config.api_key_encrypted || config.api_key_encrypted.trim() === '') return;
    const apiKey = decryptVersioned(config.api_key_encrypted, config.api_key_key_version ?? 1);
    const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
    if (config.base_url && config.base_url.trim() !== '') {
      clientOptions.baseURL = config.base_url;
    }
    const anthropicClient = new Anthropic(clientOptions);

    const { sanitised } = await applyPiiFilter(
      {
        recent_activity_count: account.recentActivityCount,
        days_since_last_activity: account.daysSinceLastActivity,
        recent_notes: account.recentNotes,
      },
      'account',
    );

    const response = await anthropicClient.messages.create({
      model: config.model,
      max_tokens: 512,
      system: buildSystemPrompt(),
      tools: [SIGNAL_TOOL],
      tool_choice: { type: 'tool', name: SIGNAL_TOOL_NAME },
      messages: [{ role: 'user', content: JSON.stringify(sanitised) }],
    });

    // Background job, not a per-user request — see winLossAnalysisService/championBlockerService
    // for why token usage is logged rather than recorded against a real user FK. (MINCRM-464, MINCRM-466)
    logger.info(
      { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      'churnExpansion: AI token usage (not attributed to a user — background job)',
    );

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === 'tool_use' && block.name === SIGNAL_TOOL_NAME,
    );
    const input = toolUseBlock?.input as
      | {
          signal_detected: boolean;
          signal_type?: ChurnExpansionSignalType;
          confidence?: number;
          contributing_factors?: string[];
        }
      | undefined;

    if (
      input?.signal_detected &&
      input.signal_type &&
      typeof input.confidence === 'number' &&
      input.contributing_factors
    ) {
      const threshold = parseFloat(config.churn_expansion_confidence_threshold);
      if (input.confidence >= threshold) {
        result = {
          signalType: input.signal_type,
          confidence: input.confidence,
          factors: input.contributing_factors,
        };
      }
    }
  }

  const existingActive = await pool.query<{ id: string; signal_type: string }>(
    `SELECT id, signal_type FROM account_churn_expansion_signals
     WHERE account_id = $1 AND cleared_at IS NULL
     ORDER BY detected_at DESC LIMIT 1`,
    [account.id],
  );
  const existing = existingActive.rows[0];

  if (!result) {
    // No signal this run — clear a prior active signal since positive/neutral activity
    // contradicts it, per the ticket's "signals cleared when new positive activity" AC.
    if (existing) {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE account_churn_expansion_signals SET cleared_at = now() WHERE id = $1`,
          [existing.id],
        );
        await writeAuditEntry(client, {
          recordType: 'account',
          recordId: account.id,
          recordName: account.name,
          eventType: 'updated',
          fieldName: 'churn_expansion_signal',
          oldValue: existing.signal_type,
          newValue: null,
          changedById: SYSTEM_ACTOR.id,
          changedByName: SYSTEM_ACTOR.name,
        });
      });
    }
    return;
  }

  // Same signal type already active — do not insert a duplicate row.
  if (existing && existing.signal_type === result.signalType) return;

  await withTransaction(async (client) => {
    if (existing) {
      await client.query(
        `UPDATE account_churn_expansion_signals SET cleared_at = now() WHERE id = $1`,
        [existing.id],
      );
    }

    await client.query(
      `INSERT INTO account_churn_expansion_signals (account_id, signal_type, confidence, contributing_factors)
       VALUES ($1, $2, $3, $4)`,
      [
        account.id,
        result.signalType,
        result.confidence,
        JSON.stringify(result.factors.map((description) => ({ description }))),
      ],
    );

    await writeAuditEntry(client, {
      recordType: 'account',
      recordId: account.id,
      recordName: account.name,
      eventType: 'updated',
      fieldName: 'churn_expansion_signal',
      oldValue: existing?.signal_type ?? null,
      newValue: result.signalType,
      changedById: SYSTEM_ACTOR.id,
      changedByName: SYSTEM_ACTOR.name,
    });
  });

  if (
    result.signalType === 'churn_risk' &&
    result.confidence >= HIGH_CONFIDENCE_NOTIFICATION_THRESHOLD
  ) {
    await createNotification({
      userId: account.ownerId,
      type: 'churn_risk_detected',
      title: `Churn risk detected: ${account.name}`,
      body: result.factors[0],
      linkPath: `/accounts/${account.id}`,
    });
  }
}

function toSignalResponse(row: {
  id: string;
  signal_type: string;
  confidence: string;
  contributing_factors: Array<{ description: string }>;
  detected_at: Date;
}): AccountChurnExpansionSignal {
  return {
    id: row.id,
    signal_type: row.signal_type as ChurnExpansionSignalType,
    confidence: parseFloat(row.confidence),
    contributing_factors: row.contributing_factors,
    detected_at: row.detected_at.toISOString(),
  };
}

/** Returns the active (non-cleared) churn/expansion signal for a single account, if any. */
export async function getAccountChurnExpansionSignal(
  accountId: string,
): Promise<AccountChurnExpansionResponse> {
  const result = await pool.query<{
    id: string;
    signal_type: string;
    confidence: string;
    contributing_factors: Array<{ description: string }>;
    detected_at: Date;
  }>(
    `SELECT id, signal_type, confidence, contributing_factors, detected_at
     FROM account_churn_expansion_signals
     WHERE account_id = $1 AND cleared_at IS NULL
     ORDER BY detected_at DESC LIMIT 1`,
    [accountId],
  );
  const row = result.rows[0];
  return { signal: row ? toSignalResponse(row) : null };
}

/** Returns all active churn-risk and expansion signals across accounts, for the Reporting view / NLI. */
export async function listChurnExpansionSignals(): Promise<ChurnExpansionListResponse> {
  const result = await pool.query<{
    id: string;
    signal_type: string;
    confidence: string;
    contributing_factors: Array<{ description: string }>;
    detected_at: Date;
    account_id: string;
    account_name: string;
    owner_id: string;
  }>(
    `SELECT s.id, s.signal_type, s.confidence, s.contributing_factors, s.detected_at,
            a.id AS account_id, a.name AS account_name, a.owner_id
     FROM account_churn_expansion_signals s
     INNER JOIN accounts a ON a.id = s.account_id
     WHERE s.cleared_at IS NULL
     ORDER BY s.confidence DESC, s.detected_at DESC`,
  );

  const atRisk: ChurnExpansionListResponse['at_risk'] = [];
  const expansion: ChurnExpansionListResponse['expansion'] = [];

  for (const row of result.rows) {
    const summary = {
      account_id: row.account_id,
      account_name: row.account_name,
      owner_id: row.owner_id,
      signal: toSignalResponse(row),
    };
    if (row.signal_type === 'churn_risk') atRisk.push(summary);
    else expansion.push(summary);
  }

  return { at_risk: atRisk, expansion };
}
