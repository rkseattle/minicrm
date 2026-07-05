/**
 * Duplicate detection explanation service — on-demand AI explanation of why
 * two contact or account records are flagged as potential duplicates. (MINCRM-440)
 *
 * Follows the same "gather context, PII-filter, forced-tool Claude call,
 * record token usage" shape as dealHealthService.generateDealHealthCheck.
 * Not persisted — generated on demand, one pair at a time, never pre-generated
 * for all flagged pairs.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { scoreDuplicateMatch } from './duplicateMatchService.js';
import type { DuplicateMatchCandidate } from './duplicateMatchService.js';
import type { DuplicateExplanationResponse } from '@minicrm/shared/schemas/duplicateExplanationSchema.js';

const IS_E2E = process.env.E2E === 'true';
const AI_USAGE_FEATURE_LABEL = 'duplicate_explanation';

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
const E2E_STUB_RESPONSE: DuplicateExplanationResponse = {
  explanation: '[E2E stub] Same email domain and similar names suggest these may be duplicates.',
  inconclusive: false,
  generated_at: new Date(0).toISOString(),
};

const EXPLANATION_TOOL_NAME = 'report_duplicate_explanation';

/** Tool-forced structured output so the response never needs free-text JSON parsing. */
const EXPLANATION_TOOL: Anthropic.Messages.Tool = {
  name: EXPLANATION_TOOL_NAME,
  description: 'Reports a plain-language explanation of why two CRM records look like duplicates.',
  input_schema: {
    type: 'object',
    properties: {
      explanation: {
        type: 'string',
        description:
          '2-4 sentence explanation referencing the specific matched signals, or a clear statement that no meaningful similarity was found.',
      },
      inconclusive: {
        type: 'boolean',
        description: 'True when no meaningful similarity reason could be determined.',
      },
    },
    required: ['explanation', 'inconclusive'],
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
  return (
    `You are a CRM data-quality assistant explaining why two records were flagged as potential ` +
    `duplicates. You are given each record's field data and a list of matched_signals (which ` +
    `specific similarities a deterministic scoring pass already found: exact_email, ` +
    `email_domain, similar_name, phone_match, company_match). Write a 2-4 sentence, plain-` +
    `language explanation referencing the specific signals present — do not invent similarities ` +
    `not listed in matched_signals. If matched_signals is empty or the similarity is not ` +
    `meaningful, set inconclusive to true and say so clearly rather than hallucinating a reason. ` +
    `Call the ${EXPLANATION_TOOL_NAME} tool exactly once with your result.`
  );
}

/**
 * Runs an on-demand AI explanation of why two records (contacts or accounts)
 * look like duplicates. Throws a tagged error (statusCode 502/503) when AI is
 * unavailable or misconfigured.
 */
export async function explainDuplicateMatch(
  recordA: DuplicateMatchCandidate,
  recordB: DuplicateMatchCandidate,
  userId: string,
): Promise<DuplicateExplanationResponse> {
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

  const matchResult = scoreDuplicateMatch(recordA, recordB);

  const context = {
    record_a: recordA,
    record_b: recordB,
    match_score: matchResult.score,
    matched_signals: matchResult.matched_signals,
  };

  // PII-filter both records' field data before it leaves the server. (MINCRM-445)
  const { sanitised, strippedFields } = await applyPiiFilter(context, 'contact');
  if (strippedFields.length > 0) {
    logger.info(
      { strippedFields },
      'Duplicate explanation: fields stripped from AI payload (MINCRM-445)',
    );
  }

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropicClient.messages.create({
      model: row.model,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools: [EXPLANATION_TOOL],
      tool_choice: { type: 'tool', name: EXPLANATION_TOOL_NAME },
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
      block.type === 'tool_use' && block.name === EXPLANATION_TOOL_NAME,
  );
  if (!toolUseBlock) {
    throw Object.assign(new Error('AI provider did not return a duplicate explanation'), {
      statusCode: 502,
    });
  }

  // Safe: forced tool_choice guarantees Claude returns exactly this shape (schema enforced
  // server-side via the tool's input_schema); ToolUseBlock.input is typed unknown by the SDK.
  const input = toolUseBlock.input as { explanation: string; inconclusive: boolean };

  return {
    explanation: input.explanation,
    inconclusive: input.inconclusive,
    generated_at: new Date().toISOString(),
  };
}
