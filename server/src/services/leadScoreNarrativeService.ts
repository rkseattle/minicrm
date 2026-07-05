/**
 * Lead score narrative service — on-demand AI plain-English explanation of a
 * lead's rule-based quality score. (MINCRM-441)
 *
 * Follows the same "gather context, PII-filter, forced-tool Claude call,
 * record token usage" shape as dealHealthService.generateDealHealthCheck.
 * Not persisted — generated on demand, never pre-generated.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { findLeadById } from './leadsService.js';
import { scoreLead } from './leadScoreService.js';
import type { LeadScoreNarrativeResponse } from '@minicrm/shared/schemas/leadScoreNarrativeSchema.js';

const IS_E2E = process.env.E2E === 'true';
const AI_USAGE_FEATURE_LABEL = 'lead_score_narrative';

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
const E2E_STUB_RESPONSE: LeadScoreNarrativeResponse = {
  narrative:
    '[E2E stub] This lead scores well due to a strong referral source and recent activity.',
  insufficient_data: false,
  generated_at: new Date(0).toISOString(),
};

const NARRATIVE_TOOL_NAME = 'report_lead_score_narrative';

/** Tool-forced structured output so the response never needs free-text JSON parsing. */
const NARRATIVE_TOOL: Anthropic.Messages.Tool = {
  name: NARRATIVE_TOOL_NAME,
  description: "Reports a plain-language narrative explaining a lead's quality score.",
  input_schema: {
    type: 'object',
    properties: {
      narrative: {
        type: 'string',
        description:
          '3-5 sentence plain-English narrative referencing the specific scoring factors, or a clear statement that there is not enough data.',
      },
      insufficient_data: {
        type: 'boolean',
        description: 'True when the scoring data is too sparse to explain meaningfully.',
      },
    },
    required: ['narrative', 'insufficient_data'],
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
    `You are a CRM sales assistant explaining a lead's quality score in plain English. You are ` +
    `given the composite score, a breakdown of scoring factors (each with its points, max ` +
    `points, and a short reason), and the lead's field values. Write a 3-5 sentence narrative ` +
    `referencing the specific factors that drove the score — do not invent signals not present ` +
    `in the given breakdown. If insufficient_data is true in the input, say clearly "Not enough ` +
    `activity data to explain this score yet" rather than fabricating a reason. Call the ` +
    `${NARRATIVE_TOOL_NAME} tool exactly once with your result.`
  );
}

/**
 * Runs an on-demand AI narrative explanation of a lead's score. Returns null
 * when the lead does not exist. Throws a tagged error (statusCode 502/503)
 * when AI is unavailable or misconfigured.
 */
export async function generateLeadScoreNarrative(
  leadId: string,
  userId: string,
): Promise<LeadScoreNarrativeResponse | null> {
  const lead = await findLeadById(leadId);
  if (!lead) return null;

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

  const scoreResult = await scoreLead(lead);

  const context = {
    score: scoreResult.score,
    factors: scoreResult.factors,
    insufficient_data: scoreResult.insufficient_data,
    lead_source: lead.lead_source,
    status: lead.status,
    company_name: lead.company_name,
  };

  // PII-filter the gathered facts before they leave the server. (MINCRM-445)
  // 'lead' is not a valid ai_field_exclusions entity_type (contact/account/deal
  // only) — map to 'contact' since a lead is pre-conversion contact data, so
  // admin-configured contact-field exclusions still apply to this payload.
  const { sanitised, strippedFields } = await applyPiiFilter(context, 'contact');
  if (strippedFields.length > 0) {
    logger.info(
      { leadId, strippedFields },
      'Lead score narrative: fields stripped from AI payload (MINCRM-445)',
    );
  }

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropicClient.messages.create({
      model: row.model,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools: [NARRATIVE_TOOL],
      tool_choice: { type: 'tool', name: NARRATIVE_TOOL_NAME },
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
      block.type === 'tool_use' && block.name === NARRATIVE_TOOL_NAME,
  );
  if (!toolUseBlock) {
    throw Object.assign(new Error('AI provider did not return a lead score narrative'), {
      statusCode: 502,
    });
  }

  // Safe: forced tool_choice guarantees Claude returns exactly this shape (schema enforced
  // server-side via the tool's input_schema); ToolUseBlock.input is typed unknown by the SDK.
  const input = toolUseBlock.input as { narrative: string; insufficient_data: boolean };

  return {
    narrative: input.narrative,
    insufficient_data: input.insufficient_data,
    generated_at: new Date().toISOString(),
  };
}
