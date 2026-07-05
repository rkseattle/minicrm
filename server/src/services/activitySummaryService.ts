/**
 * Activity call/note summarizer service — on-demand AI summarization of
 * pasted call transcripts, meeting notes, or raw call recording text. (MINCRM-436)
 *
 * Follows the same "gather context, PII-filter, forced-tool Claude call,
 * record token usage" shape as dealHealthService.generateDealHealthCheck —
 * the established template for one-shot (non-NLI) AI features in this codebase.
 * Not persisted — the result is only written to the activity record when the
 * user explicitly saves it via the normal activity create/update endpoints.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import type { ActivitySummaryResponse } from '@minicrm/shared/schemas/activitySummarySchema.js';

const IS_E2E = process.env.E2E === 'true';
const AI_USAGE_FEATURE_LABEL = 'activity_summary';

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
const E2E_STUB_RESPONSE: ActivitySummaryResponse = {
  summary: '[E2E stub] Call covered renewal pricing and a request for a revised proposal.',
  action_items: ['[E2E stub] Send revised proposal with updated pricing.'],
  suggested_follow_up_tasks: [
    {
      description: '[E2E stub] Follow up on revised proposal',
      suggested_due_date: new Date(0).toISOString().slice(0, 10),
    },
  ],
  generated_at: new Date(0).toISOString(),
};

const SUMMARIZE_TOOL_NAME = 'report_activity_summary';

/** Tool-forced structured output so the response never needs free-text JSON parsing. */
const SUMMARIZE_TOOL: Anthropic.Messages.Tool = {
  name: SUMMARIZE_TOOL_NAME,
  description: 'Reports a structured summary of a pasted call transcript or meeting notes.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: '2-4 sentence summary of the pasted text.',
      },
      action_items: {
        type: 'array',
        items: { type: 'string' },
        description: 'Bulleted list of concrete action items mentioned or implied in the text.',
      },
      suggested_follow_up_tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Short task description.' },
            suggested_due_date: {
              type: 'string',
              description: 'Suggested due date in YYYY-MM-DD format, relative to today.',
            },
          },
          required: ['description', 'suggested_due_date'],
        },
        description: '0-3 suggested follow-up tasks with due dates.',
      },
    },
    required: ['summary', 'action_items', 'suggested_follow_up_tasks'],
  },
};

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
}

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return (
    `You are a CRM sales assistant summarizing a pasted call transcript, meeting notes, or raw ` +
    `call recording text for a CRM activity record. Today's date is ${today}. Write a 2-4 sentence ` +
    `summary, extract concrete action items as a short bulleted list, and suggest up to 3 follow-up ` +
    `tasks with due dates relative to today. Only include information present in the text — do not ` +
    `invent details. Call the ${SUMMARIZE_TOOL_NAME} tool exactly once with your result.`
  );
}

/**
 * Runs an on-demand AI summarization of pasted activity text. Throws a
 * tagged error (statusCode 502/503) when AI is unavailable or misconfigured.
 */
export async function summarizeActivityText(
  rawText: string,
  userId: string,
): Promise<ActivitySummaryResponse> {
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

  // PII-filter the pasted text before it leaves the server. (MINCRM-445)
  // 'activity' is not a valid ai_field_exclusions entity_type (contact/account/deal
  // only) — map to 'deal' like objectionMatchingService does for the same reason.
  const { sanitised, strippedFields } = await applyPiiFilter({ raw_text: rawText }, 'deal');
  if (strippedFields.length > 0) {
    logger.info(
      { strippedFields },
      'Activity summary: fields stripped from AI payload (MINCRM-445)',
    );
  }

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropicClient.messages.create({
      model: row.model,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools: [SUMMARIZE_TOOL],
      tool_choice: { type: 'tool', name: SUMMARIZE_TOOL_NAME },
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
    AI_USAGE_FEATURE_LABEL,
  );

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === 'tool_use' && block.name === SUMMARIZE_TOOL_NAME,
  );
  if (!toolUseBlock) {
    throw Object.assign(new Error('AI provider did not return an activity summary'), {
      statusCode: 502,
    });
  }

  // Safe: forced tool_choice guarantees Claude returns exactly this shape (schema enforced
  // server-side via the tool's input_schema); ToolUseBlock.input is typed unknown by the SDK.
  const input = toolUseBlock.input as {
    summary: string;
    action_items: string[];
    suggested_follow_up_tasks: Array<{ description: string; suggested_due_date: string }>;
  };

  return {
    summary: input.summary,
    action_items: input.action_items,
    suggested_follow_up_tasks: input.suggested_follow_up_tasks,
    generated_at: new Date().toISOString(),
  };
}
