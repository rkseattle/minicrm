/**
 * Objection pattern matching service — on-demand AI classification of
 * objections in activity notes, with precedent matching against past won
 * deals. (MINCRM-471)
 *
 * classifyActivityObjection() and findObjectionPrecedents() both run
 * on-demand (not pre-computed), per the ticket's AC. Classification uses a
 * single tool-forced Claude call (mirroring championBlockerService.ts).
 * Precedent search is plain SQL — no second AI call, matching this
 * codebase's established division of labor (AI classifies/narrates once;
 * reads are pure SQL). Category is stored in a dedicated table
 * (activity_objection_signals), not activities.metadata jsonb, per ADR-002's
 * warning against O(n) jsonb-scan queries — see migration 143.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { findActivityById } from './activityService.js';
import type {
  ObjectionCategory,
  ActivityObjectionClassification,
  ObjectionPrecedentsResponse,
} from '@minicrm/shared/schemas/objectionSchema.js';
import { OBJECTION_CATEGORIES } from '@minicrm/shared/schemas/objectionSchema.js';

const IS_E2E = process.env.E2E === 'true';

/** Minimum closed-won deals with logged activities required before precedents are surfaced. */
const MIN_CLOSED_WON_DEALS = 10;
/** Maximum precedents returned, per the ticket's "top 3" AC. */
const MAX_PRECEDENTS = 3;

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
}

const CLASSIFY_TOOL_NAME = 'report_objection_category';

const CLASSIFY_TOOL: Anthropic.Messages.Tool = {
  name: CLASSIFY_TOOL_NAME,
  description: 'Reports whether an activity note logs an objection, and its category.',
  input_schema: {
    type: 'object',
    properties: {
      objection_detected: {
        type: 'boolean',
        description: 'True only when the note clearly logs an objection raised by the contact.',
      },
      category: {
        type: 'string',
        enum: [...OBJECTION_CATEGORIES],
        description: 'Required when objection_detected is true.',
      },
    },
    required: ['objection_detected'],
  },
};

function buildSystemPrompt(): string {
  return (
    'You classify a single CRM activity note for a sales objection. Categories: Price (cost, ' +
    'budget), Timing (not now, later), Competitor (evaluating alternatives), Product Fit ' +
    '(missing features, wrong fit), Authority (needs approval from someone else), Risk ' +
    '(concerns about implementation, security, reliability), Other. Only report ' +
    'objection_detected=true when the note clearly logs an objection the contact raised — not ' +
    'every note is an objection. Call the report_objection_category tool exactly once.'
  );
}

async function getAiConfig(): Promise<AiConfigRow | null> {
  const result = await pool.query<AiConfigRow>(
    `SELECT model, api_key_encrypted, api_key_key_version, base_url, enabled
     FROM ai_configuration
     LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

/**
 * Classifies a single activity's note text into an objection category.
 * Returns null when the activity has no note text, AI is unavailable, or no
 * clear objection was detected. Caches the result in activity_objection_signals
 * so re-viewing the same activity doesn't re-call the AI.
 */
export async function classifyActivityObjection(
  activityId: string,
  userId: string,
): Promise<ActivityObjectionClassification | null> {
  const existing = await pool.query<{ category: string }>(
    `SELECT category FROM activity_objection_signals WHERE activity_id = $1`,
    [activityId],
  );
  if (existing.rows[0]) {
    return { activity_id: activityId, category: existing.rows[0].category as ObjectionCategory };
  }

  const activity = await findActivityById(activityId);
  if (!activity?.notes || activity.notes.trim() === '') return null;

  const config = await getAiConfig();
  if (!config?.enabled) {
    throw Object.assign(new Error('AI features are not enabled'), { statusCode: 503 });
  }

  let category: ObjectionCategory | null = null;

  if (IS_E2E) {
    category = null;
  } else {
    if (!config.api_key_encrypted || config.api_key_encrypted.trim() === '') {
      throw Object.assign(new Error('AI API key is not configured'), { statusCode: 503 });
    }
    let apiKey: string;
    try {
      apiKey = decryptVersioned(config.api_key_encrypted, config.api_key_key_version ?? 1);
    } catch {
      throw Object.assign(new Error('AI API key could not be decrypted — please re-enter it'), {
        statusCode: 503,
      });
    }
    const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
    if (config.base_url && config.base_url.trim() !== '') {
      clientOptions.baseURL = config.base_url;
    }
    const anthropicClient = new Anthropic(clientOptions);

    const { sanitised } = await applyPiiFilter({ note_text: activity.notes }, 'deal');

    let response: Anthropic.Messages.Message;
    try {
      response = await anthropicClient.messages.create({
        model: config.model,
        max_tokens: 256,
        system: buildSystemPrompt(),
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: 'tool', name: CLASSIFY_TOOL_NAME },
        messages: [{ role: 'user', content: JSON.stringify(sanitised) }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw Object.assign(new Error('AI provider authentication failed'), { statusCode: 502 });
      }
      if (err instanceof Anthropic.APIConnectionError) {
        throw Object.assign(new Error('Could not reach the AI provider'), { statusCode: 502 });
      }
      if (err instanceof Anthropic.APIError) {
        throw Object.assign(new Error(`AI provider error: ${err.message}`), { statusCode: 502 });
      }
      throw err;
    }

    recordTokenUsage(
      userId,
      response.usage.input_tokens,
      response.usage.output_tokens,
      'objection_matching',
    );

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === 'tool_use' && block.name === CLASSIFY_TOOL_NAME,
    );
    const input = toolUseBlock?.input as
      | { objection_detected: boolean; category?: ObjectionCategory }
      | undefined;
    if (input?.objection_detected && input.category) {
      category = input.category;
    }
  }

  if (!category) return null;

  await pool.query(
    `INSERT INTO activity_objection_signals (activity_id, category)
     VALUES ($1, $2)
     ON CONFLICT (activity_id) DO UPDATE SET category = $2`,
    [activityId, category],
  );

  return { activity_id: activityId, category };
}

/**
 * Returns the top 3 similar objections from past won deals for a given
 * category. Plain SQL — no AI call. Requires at least MIN_CLOSED_WON_DEALS
 * closed-won deals with logged activities before precedents are surfaced.
 */
export async function findObjectionPrecedents(
  category: ObjectionCategory,
): Promise<ObjectionPrecedentsResponse> {
  const closedWonCountResult = await pool.query<{ count: string }>(
    `SELECT COUNT(DISTINCT d.id) AS count
     FROM deals d
     WHERE d.stage = 'Closed Won' AND EXISTS (SELECT 1 FROM activities a WHERE a.deal_id = d.id)`,
  );
  const closedWonDealsCount = parseInt(closedWonCountResult.rows[0]?.count ?? '0', 10);

  if (closedWonDealsCount < MIN_CLOSED_WON_DEALS) {
    return {
      category,
      precedents: [],
      has_sufficient_data: false,
      min_closed_won_deals_required: MIN_CLOSED_WON_DEALS,
      closed_won_deals_count: closedWonDealsCount,
    };
  }

  // For each objection-classified activity on a won deal, find the deal's response summary
  // (the next activity on the same deal after the objection) and time-to-close from the
  // objection's date to the deal's close_date.
  const result = await pool.query<{
    deal_id: string;
    deal_name: string;
    objection_quote: string;
    response_summary: string | null;
    objection_date: Date;
    close_date: string | null;
  }>(
    `SELECT
       d.id AS deal_id, d.name AS deal_name,
       COALESCE(a.notes, a.subject) AS objection_quote,
       (SELECT COALESCE(a2.notes, a2.subject)
          FROM activities a2
          WHERE a2.deal_id = d.id AND a2.created_at > a.created_at
          ORDER BY a2.created_at ASC LIMIT 1) AS response_summary,
       a.created_at AS objection_date,
       d.close_date::text
     FROM activity_objection_signals s
     INNER JOIN activities a ON a.id = s.activity_id
     INNER JOIN deals d ON d.id = a.deal_id
     WHERE s.category = $1 AND d.stage = 'Closed Won'
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [category, MAX_PRECEDENTS],
  );

  const precedents = result.rows.map((row) => {
    const closeDate = row.close_date ? new Date(row.close_date) : null;
    const timeToCloseDays = closeDate
      ? Math.max(
          0,
          Math.floor((closeDate.getTime() - row.objection_date.getTime()) / (1000 * 60 * 60 * 24)),
        )
      : 0;
    return {
      deal_id: row.deal_id,
      deal_name: row.deal_name,
      objection_quote: row.objection_quote,
      response_summary: row.response_summary ?? '',
      time_to_close_days: timeToCloseDays,
    };
  });

  return {
    category,
    precedents,
    has_sufficient_data: true,
    min_closed_won_deals_required: MIN_CLOSED_WON_DEALS,
    closed_won_deals_count: closedWonDealsCount,
  };
}
