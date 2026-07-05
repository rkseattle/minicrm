/**
 * Follow-up task suggestion service — on-demand AI suggestions of 1-3
 * follow-up tasks after an activity is logged. (MINCRM-438)
 *
 * Follows the same "gather context, PII-filter, forced-tool Claude call,
 * record token usage" shape as dealHealthService.generateDealHealthCheck.
 * Not persisted — generated once when the client calls it right after
 * activity save; not regenerated on subsequent page loads.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { findActivityById } from './activityService.js';
import { withRlsQuery } from './rlsContextService.js';
import type { TaskSuggestionResponse } from '@minicrm/shared/schemas/taskSuggestionSchema.js';

const IS_E2E = process.env.E2E === 'true';
const AI_USAGE_FEATURE_LABEL = 'task_suggestions';

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
const E2E_STUB_RESPONSE: TaskSuggestionResponse = {
  suggestions: [
    {
      description: '[E2E stub] Send follow-up recap email',
      suggested_due_date: new Date(0).toISOString().slice(0, 10),
      linked_entity: 'contact',
    },
  ],
  generated_at: new Date(0).toISOString(),
};

const TASK_SUGGESTION_TOOL_NAME = 'report_task_suggestions';

/** Tool-forced structured output so the response never needs free-text JSON parsing. */
const TASK_SUGGESTION_TOOL: Anthropic.Messages.Tool = {
  name: TASK_SUGGESTION_TOOL_NAME,
  description: 'Reports 1-3 suggested follow-up tasks for a just-logged CRM activity.',
  input_schema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Short task description.' },
            suggested_due_date: {
              type: 'string',
              description: 'Suggested due date in YYYY-MM-DD format, relative to today.',
            },
            linked_entity: {
              type: 'string',
              enum: ['contact', 'opportunity'],
              description: 'Which entity this task naturally follows up on.',
            },
          },
          required: ['description', 'suggested_due_date'],
        },
      },
    },
    required: ['suggestions'],
  },
};

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
}

interface TaskSuggestionContext {
  activity_type: string;
  notes: string | null;
  contact_name: string | null;
  account_name: string | null;
  opportunity_stage: string | null;
}

async function gatherTaskSuggestionContext(
  activityId: string,
): Promise<TaskSuggestionContext | null> {
  const activity = await findActivityById(activityId);
  if (!activity) return null;

  const [contactResult, accountResult, dealResult] = await Promise.all([
    activity.contact_id
      ? withRlsQuery((client) =>
          client.query<{ first_name: string; last_name: string }>(
            'SELECT first_name, last_name FROM contacts WHERE id = $1',
            [activity.contact_id],
          ),
        )
      : Promise.resolve({ rows: [] as { first_name: string; last_name: string }[] }),
    activity.account_id
      ? withRlsQuery((client) =>
          client.query<{ name: string }>('SELECT name FROM accounts WHERE id = $1', [
            activity.account_id,
          ]),
        )
      : Promise.resolve({ rows: [] as { name: string }[] }),
    activity.deal_id
      ? withRlsQuery((client) =>
          client.query<{ stage: string }>('SELECT stage FROM deals WHERE id = $1', [
            activity.deal_id,
          ]),
        )
      : Promise.resolve({ rows: [] as { stage: string }[] }),
  ]);

  const contact = contactResult.rows[0];

  return {
    activity_type: activity.type,
    notes: activity.notes,
    contact_name: contact ? `${contact.first_name} ${contact.last_name}` : null,
    account_name: accountResult.rows[0]?.name ?? null,
    opportunity_stage: dealResult.rows[0]?.stage ?? null,
  };
}

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return (
    `You are a CRM sales assistant suggesting follow-up tasks right after a rep logs an ` +
    `activity. Today's date is ${today}. You are given the activity type, its notes, the ` +
    `contact name, account name, and any linked opportunity's stage. Suggest 1-3 concrete ` +
    `follow-up tasks with due dates relative to today, and note whether each naturally links ` +
    `to the contact or the opportunity. Only suggest tasks implied by the given context — do ` +
    `not invent details. Call the ${TASK_SUGGESTION_TOOL_NAME} tool exactly once with your result.`
  );
}

/**
 * Runs an on-demand AI follow-up task suggestion for a just-saved activity.
 * Returns null when the activity does not exist. Throws a tagged error
 * (statusCode 502/503) when AI is unavailable or misconfigured.
 */
export async function generateTaskSuggestions(
  activityId: string,
  userId: string,
): Promise<TaskSuggestionResponse | null> {
  const context = await gatherTaskSuggestionContext(activityId);
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

  // PII-filter the gathered facts before they leave the server. (MINCRM-445)
  const { sanitised, strippedFields } = await applyPiiFilter(context, 'activity');
  if (strippedFields.length > 0) {
    logger.info(
      { activityId, strippedFields },
      'Task suggestions: fields stripped from AI payload (MINCRM-445)',
    );
  }

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropicClient.messages.create({
      model: row.model,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools: [TASK_SUGGESTION_TOOL],
      tool_choice: { type: 'tool', name: TASK_SUGGESTION_TOOL_NAME },
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
      block.type === 'tool_use' && block.name === TASK_SUGGESTION_TOOL_NAME,
  );
  if (!toolUseBlock) {
    throw Object.assign(new Error('AI provider did not return task suggestions'), {
      statusCode: 502,
    });
  }

  const input = toolUseBlock.input as {
    suggestions: Array<{
      description: string;
      suggested_due_date: string;
      linked_entity?: 'contact' | 'opportunity';
    }>;
  };

  return {
    suggestions: input.suggestions.map((s) => ({
      description: s.description,
      suggested_due_date: s.suggested_due_date,
      linked_entity: s.linked_entity ?? null,
    })),
    generated_at: new Date().toISOString(),
  };
}
