/**
 * Deal health check service — on-demand AI assessment of a single deal's risk
 * signals.
 *
 * Gathers deal facts and recent activity, strips PII via applyPiiFilter, and
 * asks Claude to classify the deal as on_track / at_risk / stalled with a
 * short narrative and 1-2 next actions. Not persisted — callers regenerate on
 * every request. Follows the same "build client, call Anthropic, record token
 * usage" shape as aiSessionService.sendMessage, but without the agentic
 * tool-use loop (no tools are offered; this is a single structured call).
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { findDealById } from './dealService.js';
import { withRlsQuery } from './rlsContextService.js';
import type {
  DealHealthCheckResponse,
  DealHealthStatus,
} from '@minicrm/shared/schemas/dealHealthSchema.js';
import { DEAL_HEALTH_STATUSES } from '@minicrm/shared/schemas/dealHealthSchema.js';

const IS_E2E = process.env.E2E === 'true';

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
const E2E_STUB_RESPONSE: DealHealthCheckResponse = {
  status: 'at_risk',
  narrative:
    '[E2E stub] No activity logged in the last 14 days and the last email was never replied to.',
  next_actions: ['[E2E stub] Follow up with the primary contact.'],
  generated_at: new Date(0).toISOString(),
};

const HEALTH_CHECK_TOOL_NAME = 'report_deal_health';

/** Tool-forced structured output so the response never needs free-text JSON parsing. */
const HEALTH_CHECK_TOOL: Anthropic.Messages.Tool = {
  name: HEALTH_CHECK_TOOL_NAME,
  description: 'Reports the assessed health of a CRM deal.',
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: [...DEAL_HEALTH_STATUSES],
        description: 'Overall health classification for the deal.',
      },
      narrative: {
        type: 'string',
        description:
          '2-4 sentence narrative identifying specific risk signals found in the deal data.',
      },
      next_actions: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 2,
        description: '1-2 recommended next actions for the rep.',
      },
    },
    required: ['status', 'narrative', 'next_actions'],
  },
};

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
}

interface RecentActivityRow {
  type: string;
  subject: string;
  notes: string | null;
  direction: string | null;
  outcome: string | null;
  created_at: Date;
}

/**
 * Facts about a deal gathered for the health-check prompt. Field names mirror
 * the ticket's AC exactly so the prompt-building step stays a straight mapping.
 */
interface DealHealthContext {
  name: string;
  stage: string;
  value: string | null;
  currency: string;
  close_date: string | null;
  days_since_last_activity: number | null;
  /**
   * Days since the most recent outbound email. The AI infers whether it was
   * answered from recent_activities — 'outcome' has no controlled vocabulary
   * in this schema, so a "replied" flag cannot be queried directly.
   */
  days_since_last_outbound_email: number | null;
  open_tasks_count: number;
  recent_activities: Array<{
    type: string;
    subject: string;
    notes: string | null;
    direction: string | null;
    outcome: string | null;
    days_ago: number;
  }>;
}

/**
 * Gathers the deal facts required for a health check: core deal fields, days
 * since last activity, days since the last replied-to email, open task count,
 * and a summary of the last 5 activities. Returns null when the deal does not
 * exist so the controller can return 404.
 */
async function gatherDealHealthContext(dealId: string): Promise<DealHealthContext | null> {
  const deal = await findDealById(dealId);
  if (!deal) return null;

  const [lastActivityResult, lastOutboundEmailResult, openTasksResult, recentActivitiesResult] =
    await Promise.all([
      withRlsQuery((client) =>
        client.query<{ created_at: Date }>(
          `SELECT created_at FROM activities WHERE deal_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [dealId],
        ),
      ),
      // 'outcome' is freeform text with no controlled vocabulary in this schema, so
      // "replied" cannot be queried directly. The AI infers reply status itself from
      // whether a later inbound activity appears in recent_activities below.
      withRlsQuery((client) =>
        client.query<{ created_at: Date }>(
          `SELECT created_at FROM activities
           WHERE deal_id = $1 AND type = 'Email' AND direction = 'Outbound'
           ORDER BY created_at DESC LIMIT 1`,
          [dealId],
        ),
      ),
      withRlsQuery((client) =>
        client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM activities
           WHERE deal_id = $1 AND type = 'Task' AND status = 'open'`,
          [dealId],
        ),
      ),
      withRlsQuery((client) =>
        client.query<RecentActivityRow>(
          `SELECT type, subject, notes, direction, outcome, created_at
           FROM activities
           WHERE deal_id = $1
           ORDER BY created_at DESC
           LIMIT 5`,
          [dealId],
        ),
      ),
    ]);

  const now = Date.now();
  const daysSince = (row?: { created_at: Date }): number | null =>
    row ? Math.floor((now - row.created_at.getTime()) / (1000 * 60 * 60 * 24)) : null;

  return {
    name: deal.name,
    stage: deal.stage,
    value: deal.value,
    currency: deal.currency,
    close_date: deal.close_date,
    days_since_last_activity: daysSince(lastActivityResult.rows[0]),
    days_since_last_outbound_email: daysSince(lastOutboundEmailResult.rows[0]),
    open_tasks_count: parseInt(openTasksResult.rows[0]?.count ?? '0', 10),
    recent_activities: recentActivitiesResult.rows.map((row) => ({
      type: row.type,
      subject: row.subject,
      notes: row.notes,
      direction: row.direction,
      outcome: row.outcome,
      days_ago: Math.floor((now - row.created_at.getTime()) / (1000 * 60 * 60 * 24)),
    })),
  };
}

function buildSystemPrompt(): string {
  return (
    'You are a CRM sales assistant assessing the health of a single deal. ' +
    'You are given the deal facts, days_since_last_outbound_email, and its 5 most recent ' +
    'activities (each with a direction of Inbound or Outbound). Classify the deal as ' +
    '"on_track", "at_risk", or "stalled". Recognize these risk signals when present: no activity ' +
    'in many days, an outbound email with no later inbound activity from the contact (i.e. it ' +
    'appears unanswered), a close date that has passed with no stage change, and no open tasks ' +
    'tracking next steps. Call the report_deal_health tool exactly once with your assessment. ' +
    'Write the narrative and next actions for the sales rep, referencing the specific signals you found.'
  );
}

/**
 * Runs an on-demand AI health check for a deal. Returns null when the deal
 * does not exist.
 *
 * Not persisted: callers regenerate the assessment on every call, per the
 * ticket's "Panel result is not persisted" requirement.
 */
export async function generateDealHealthCheck(
  dealId: string,
  userId: string,
): Promise<DealHealthCheckResponse | null> {
  const context = await gatherDealHealthContext(dealId);
  if (!context) return null;

  // IS_E2E must short-circuit before the ai_configuration.enabled check —
  // reset-e2e-data.ts always sets enabled=false in the E2E database, so
  // checking it first would 503 every E2E run before reaching the stub.
  if (IS_E2E) {
    return E2E_STUB_RESPONSE;
  }

  const configResult = await pool.query<AiConfigRow>(
    `SELECT model, api_key_encrypted, api_key_key_version, base_url, enabled
     FROM ai_configuration
     LIMIT 1`,
  );
  const row = configResult.rows[0];
  if (!row?.enabled) {
    throw Object.assign(new Error('AI features are not enabled'), { statusCode: 503 });
  }

  if (!row.api_key_encrypted || row.api_key_encrypted.trim() === '') {
    throw Object.assign(new Error('AI API key is not configured'), { statusCode: 503 });
  }

  let apiKey: string;
  try {
    apiKey = decryptVersioned(row.api_key_encrypted, row.api_key_key_version ?? 1);
  } catch {
    throw Object.assign(new Error('AI API key could not be decrypted — please re-enter it'), {
      statusCode: 503,
    });
  }

  const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
  if (row.base_url && row.base_url.trim() !== '') {
    clientOptions.baseURL = row.base_url;
  }
  const anthropicClient = new Anthropic(clientOptions);

  // PII-filter the gathered facts before they leave the server.
  const { sanitised, strippedFields } = await applyPiiFilter(context, 'deal');
  if (strippedFields.length > 0) {
    logger.info(
      { dealId, strippedFields },
      'Deal health check: fields stripped from AI payload (MINCRM-445)',
    );
  }

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropicClient.messages.create({
      model: row.model,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools: [HEALTH_CHECK_TOOL],
      tool_choice: { type: 'tool', name: HEALTH_CHECK_TOOL_NAME },
      messages: [{ role: 'user', content: JSON.stringify(sanitised) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      logger.error({ err }, 'AI authentication error — check the API key in admin settings');
      throw Object.assign(new Error('AI provider authentication failed'), { statusCode: 502 });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      logger.error({ err }, 'AI connection error — check base URL and network');
      throw Object.assign(new Error('Could not reach the AI provider'), { statusCode: 502 });
    }
    if (err instanceof Anthropic.APIError) {
      logger.error({ err }, `AI API error ${err.status}`);
      throw Object.assign(new Error(`AI provider error: ${err.message}`), { statusCode: 502 });
    }
    throw err;
  }

  recordTokenUsage(
    userId,
    response.usage.input_tokens,
    response.usage.output_tokens,
    'deal_health_check',
  );

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === 'tool_use' && block.name === HEALTH_CHECK_TOOL_NAME,
  );
  if (!toolUseBlock) {
    throw Object.assign(new Error('AI provider did not return a deal health assessment'), {
      statusCode: 502,
    });
  }

  // Safe: forced tool_choice guarantees Claude returns exactly this shape (schema enforced
  // server-side via the tool's input_schema); ToolUseBlock.input is typed unknown by the SDK.
  const input = toolUseBlock.input as {
    status: DealHealthStatus;
    narrative: string;
    next_actions: string[];
  };

  return {
    status: input.status,
    narrative: input.narrative,
    next_actions: input.next_actions,
    generated_at: new Date().toISOString(),
  };
}
