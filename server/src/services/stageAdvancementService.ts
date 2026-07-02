/**
 * Stage advancement suggestion service — passive, page-load AI check for
 * whether a deal looks ready to move to its next pipeline stage. (MINCRM-443)
 *
 * Gathers deal/stage/activity facts and asks Claude for a yes/no readiness
 * signal with a short rationale, via a tool-forced structured call. No
 * indicator is returned when the deal is already in a terminal stage, has no
 * next stage configured, or the AI is not confident. Follows the same
 * "build client, call Anthropic, record token usage" shape as
 * dealHealthService.generateDealHealthCheck.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { findDealById } from './dealService.js';
import { listPipelineStages } from './pipelineStageService.js';
import { withRlsQuery } from './rlsContextService.js';
import type { StageAdvancementCheckResponse } from '@minicrm/shared/schemas/stageAdvancementSchema.js';

const IS_E2E = process.env.E2E === 'true';

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
const E2E_STUB_NO_SUGGESTION: StageAdvancementCheckResponse = { ready: false };

const ADVANCEMENT_TOOL_NAME = 'report_stage_advancement';

/** Tool-forced structured output so the response never needs free-text JSON parsing. */
const ADVANCEMENT_TOOL: Anthropic.Messages.Tool = {
  name: ADVANCEMENT_TOOL_NAME,
  description: 'Reports whether a CRM deal looks ready to advance to its next pipeline stage.',
  input_schema: {
    type: 'object',
    properties: {
      ready: {
        type: 'boolean',
        description:
          'True only when there is clear, specific evidence the deal is ready to advance. ' +
          'False when the data is insufficient or the signal is weak — do not guess.',
      },
      rationale: {
        type: 'string',
        description:
          '1-3 sentence rationale citing the specific signal(s) found. Required when ready is true; omit or leave empty when ready is false.',
      },
    },
    required: ['ready'],
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
  created_at: Date;
}

/** Facts about a deal and its candidate next stage gathered for the prompt. */
interface StageAdvancementContext {
  current_stage_name: string;
  next_stage_name: string;
  /** Deal fields still missing to formally satisfy the next stage's exit requirements, if any are configured. */
  next_stage_required_fields_missing: string[];
  days_in_current_stage: number;
  days_since_last_activity: number | null;
  recent_activity_count: number;
  open_tasks_count: number;
  recent_activities: Array<{
    type: string;
    subject: string;
    notes: string | null;
    direction: string | null;
    days_ago: number;
  }>;
}

interface GatheredContext {
  context: StageAdvancementContext;
  nextStageId: string;
  nextStageName: string;
}

/**
 * Gathers the deal and candidate-next-stage facts required for an advancement
 * check. Returns null when the deal does not exist, its current stage is
 * terminal, or there is no next stage configured in the pipeline (deal is
 * already in the last stage).
 */
async function gatherStageAdvancementContext(dealId: string): Promise<GatheredContext | null> {
  const deal = await findDealById(dealId);
  if (!deal) return null;

  const stages = await listPipelineStages(deal.pipeline_id);
  const currentIndex = stages.findIndex((s) => s.id === deal.pipeline_stage_id);
  if (currentIndex === -1) return null;

  const currentStage = stages[currentIndex];
  if (currentStage.is_terminal) return null;

  const nextStage = stages[currentIndex + 1];
  if (!nextStage) return null;

  const [lastActivityResult, activityCountResult, openTasksResult, recentActivitiesResult] =
    await Promise.all([
      withRlsQuery((client) =>
        client.query<{ created_at: Date }>(
          `SELECT created_at FROM activities WHERE deal_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [dealId],
        ),
      ),
      withRlsQuery((client) =>
        client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM activities WHERE deal_id = $1 AND created_at >= now() - interval '30 days'`,
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
          `SELECT type, subject, notes, direction, created_at
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

  const mergedDeal = deal as unknown as Record<string, unknown>;
  const requiredFieldsMissing = nextStage.stage_exit_requirements.required_fields.filter(
    (field) => mergedDeal[field] === null || mergedDeal[field] === undefined,
  );

  return {
    nextStageId: nextStage.id,
    nextStageName: nextStage.name,
    context: {
      current_stage_name: currentStage.name,
      next_stage_name: nextStage.name,
      next_stage_required_fields_missing: requiredFieldsMissing,
      days_in_current_stage: daysSince({ created_at: deal.updated_at }) ?? 0,
      days_since_last_activity: daysSince(lastActivityResult.rows[0]),
      recent_activity_count: parseInt(activityCountResult.rows[0]?.count ?? '0', 10),
      open_tasks_count: parseInt(openTasksResult.rows[0]?.count ?? '0', 10),
      recent_activities: recentActivitiesResult.rows.map((row) => ({
        type: row.type,
        subject: row.subject,
        notes: row.notes,
        direction: row.direction,
        days_ago: Math.floor((now - row.created_at.getTime()) / (1000 * 60 * 60 * 24)),
      })),
    },
  };
}

function buildSystemPrompt(): string {
  return (
    'You are a CRM sales assistant deciding whether a deal looks ready to advance to its next ' +
    "pipeline stage. You are given the current and next stage names, any of the next stage's " +
    'required fields the deal is still missing, days in the current stage, days since last ' +
    'activity, recent activity count, open tasks, and its 5 most recent activities. ' +
    'Only report ready=true when there is clear, specific evidence in the activity notes that ' +
    'the deal has progressed (e.g. a proposal was sent and acknowledged, a decision maker ' +
    'confirmed next steps). If the next stage has required fields still missing, or the data is ' +
    'thin or ambiguous, report ready=false — do not guess. Call the report_stage_advancement ' +
    'tool exactly once.'
  );
}

/**
 * Runs a passive AI stage-advancement check for a deal. Returns
 * { ready: false } when the deal does not exist, is in a terminal stage, has
 * no next stage, or the AI is not confident — the caller renders no
 * indicator in every { ready: false } case except "deal not found", which the
 * controller maps to 404 by checking existence separately.
 */
export async function checkStageAdvancement(
  dealId: string,
  userId: string,
): Promise<StageAdvancementCheckResponse | null> {
  const gathered = await gatherStageAdvancementContext(dealId);
  if (gathered === null) {
    // Distinguish "deal not found" from "no next stage / terminal stage" — both gather to
    // null, but the controller needs the former to 404. Re-check existence explicitly.
    const deal = await findDealById(dealId);
    if (!deal) return null;
    return { ready: false };
  }

  // IS_E2E must short-circuit before the ai_configuration.enabled check —
  // reset-e2e-data.ts always sets enabled=false in the E2E database, so
  // checking it first would 503 every E2E run before reaching the stub.
  if (IS_E2E) {
    return E2E_STUB_NO_SUGGESTION;
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

  const { sanitised, strippedFields } = await applyPiiFilter(gathered.context, 'deal');
  if (strippedFields.length > 0) {
    logger.info(
      { dealId, strippedFields },
      'Stage advancement check: fields stripped from AI payload (MINCRM-445)',
    );
  }

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropicClient.messages.create({
      model: row.model,
      max_tokens: 512,
      system: buildSystemPrompt(),
      tools: [ADVANCEMENT_TOOL],
      tool_choice: { type: 'tool', name: ADVANCEMENT_TOOL_NAME },
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
    'stage_advancement',
  );

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === 'tool_use' && block.name === ADVANCEMENT_TOOL_NAME,
  );
  if (!toolUseBlock) {
    throw Object.assign(new Error('AI provider did not return a stage advancement assessment'), {
      statusCode: 502,
    });
  }

  const input = toolUseBlock.input as { ready: boolean; rationale?: string };
  if (!input.ready || !input.rationale) {
    return { ready: false };
  }

  return {
    ready: true,
    next_stage_id: gathered.nextStageId,
    next_stage_name: gathered.nextStageName,
    rationale: input.rationale,
  };
}
