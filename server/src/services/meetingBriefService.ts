/**
 * Pre-meeting brief generation service — on-demand AI assembly of contact/
 * account/opportunity/activity context into a structured brief for an
 * upcoming Call or Meeting activity. (MINCRM-465)
 *
 * Follows the same "gather context, PII-filter, forced single-tool call"
 * shape as dealHealthService.ts. Persisted (overwritten on regenerate) so
 * the brief is readable at a stable, authenticated URL for the "shareable
 * link" requirement — unlike dealHealthService, which is never persisted.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { findActivityById } from './activityService.js';
import { findContactById } from './contactService.js';
import { findAccountById } from './accountService.js';
import { listContactDeals } from './dealService.js';
import { withRlsQuery } from './rlsContextService.js';
import { getFollowUpTiming } from './followUpTimingService.js';
import { isFlagEnabledForUser } from './featureFlagService.js';
import type {
  MeetingBriefResponse,
  MeetingBriefContent,
} from '@minicrm/shared/schemas/meetingBriefSchema.js';

const IS_E2E = process.env.E2E === 'true';

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
const E2E_STUB_BRIEF: MeetingBriefContent = {
  contact_snapshot: {
    name: '[E2E stub] Contact',
    title: null,
    company: null,
    contact_since: null,
    last_interaction_at: null,
  },
  account_summary: null,
  open_opportunities: [],
  recent_activity_summary: ['[E2E stub] No recent activity.'],
  suggested_talking_points: ['[E2E stub] Confirm current priorities.'],
  known_objections: [],
};

const BRIEF_TOOL_NAME = 'report_meeting_brief';

/** Tool-forced structured output so the response never needs free-text JSON parsing. */
const BRIEF_TOOL: Anthropic.Messages.Tool = {
  name: BRIEF_TOOL_NAME,
  description: 'Reports a structured pre-meeting brief for a CRM contact.',
  input_schema: {
    type: 'object',
    properties: {
      account_summary: {
        type: 'string',
        description: '2-3 sentence account summary: company size, industry, relationship history.',
      },
      recent_activity_summary: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 3,
        description: 'Last up-to-3 interactions summarized in plain language, most recent first.',
      },
      suggested_talking_points: {
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 5,
        description:
          '3-5 talking points derived from opportunity stage, recent activity, and open tasks.',
      },
      next_steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            deal_id: { type: 'string' },
            next_step: { type: 'string' },
          },
          required: ['deal_id', 'next_step'],
        },
        description: 'One suggested next step per open opportunity ID provided in the input.',
      },
    },
    required: [
      'account_summary',
      'recent_activity_summary',
      'suggested_talking_points',
      'next_steps',
    ],
  },
};

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
  web_search_enabled: boolean;
}

const NEWS_HOOK_TOOL: Anthropic.Messages.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 2,
};

/** Maximum news items surfaced in the brief, per the ticket's AC. */
const MAX_NEWS_ITEMS = 2;

/**
 * Best-effort web search for recent news about the account company. Returns
 * undefined (section omitted, not an empty array) on any failure or when
 * nothing relevant is found — a failed search must never fail the brief.
 * Genuinely new integration: no other AI service in this codebase uses a
 * server-side tool, only forced-choice custom tools.
 */
async function gatherNewsHook(
  anthropicClient: Anthropic,
  model: string,
  companyName: string,
): Promise<MeetingBriefContent['news_hook']> {
  try {
    const response = await anthropicClient.messages.create({
      model,
      max_tokens: 1024,
      system:
        'Search for recent, relevant news about the given company. Respond with nothing but ' +
        'the search results — no commentary.',
      tools: [NEWS_HOOK_TOOL],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: `Recent news about: ${companyName}` }],
    });

    const items: NonNullable<MeetingBriefContent['news_hook']> = [];
    for (const block of response.content) {
      if (block.type !== 'web_search_tool_result') continue;
      if (!Array.isArray(block.content)) continue; // WebSearchToolResultError — skip
      for (const result of block.content) {
        if (items.length >= MAX_NEWS_ITEMS) break;
        // Validate each item individually so one malformed result (missing
        // title/url, or a URL that fails to parse) is skipped rather than
        // either persisting a broken href or throwing and dropping every
        // other valid item already found in this response. (MINCRM-465
        // self-review)
        if (typeof result.title !== 'string' || !result.title.trim()) continue;
        if (typeof result.url !== 'string' || !result.url.trim()) continue;
        let hostname: string;
        try {
          hostname = new URL(result.url).hostname;
        } catch {
          continue;
        }
        items.push({
          title: result.title,
          url: result.url,
          source: hostname,
          published_at: result.page_age,
        });
      }
    }
    return items.length > 0 ? items : undefined;
  } catch (err) {
    logger.warn({ err }, 'Meeting brief: news hook search failed — omitting section');
    return undefined;
  }
}

interface BriefContext {
  contact: {
    id: string;
    name: string;
    title: string | null;
    company: string | null;
    contact_since: string;
    last_interaction_at: string | null;
  };
  open_opportunities: Array<{
    deal_id: string;
    name: string;
    stage: string;
    value: string | null;
    currency: string;
    days_in_current_stage: number;
  }>;
  recent_activities: Array<{
    type: string;
    subject: string;
    notes: string | null;
    days_ago: number;
  }>;
  open_tasks: string[];
  known_objections: string[];
}

/**
 * Gathers the brief context for a Call/Meeting activity's linked contact.
 * Returns null when the activity does not exist or has no linked contact.
 */
async function gatherBriefContext(activityId: string): Promise<BriefContext | null> {
  const activity = await findActivityById(activityId);
  if (!activity?.contact_id) return null;

  const contact = await findContactById(activity.contact_id);
  if (!contact) return null;

  const account = contact.account_id ? await findAccountById(contact.account_id) : null;

  const [dealsRaw, lastActivityResult, recentActivitiesResult, openTasksResult, objectionsResult] =
    await Promise.all([
      listContactDeals(contact.id),
      withRlsQuery((client) =>
        client.query<{ created_at: Date }>(
          `SELECT created_at FROM activities WHERE contact_id = $1 AND id != $2 ORDER BY created_at DESC LIMIT 1`,
          [contact.id, activityId],
        ),
      ),
      withRlsQuery((client) =>
        client.query<{ type: string; subject: string; notes: string | null; created_at: Date }>(
          `SELECT type, subject, notes, created_at FROM activities
           WHERE contact_id = $1 AND id != $2
           ORDER BY created_at DESC LIMIT 5`,
          [contact.id, activityId],
        ),
      ),
      withRlsQuery((client) =>
        client.query<{ subject: string }>(
          `SELECT subject FROM activities
           WHERE contact_id = $1 AND type = 'Task' AND status = 'open'
           ORDER BY due_date ASC NULLS LAST LIMIT 5`,
          [contact.id],
        ),
      ),
      withRlsQuery((client) =>
        client.query<{ category: string }>(
          `SELECT DISTINCT os.category
           FROM activity_objection_signals os
           JOIN activities a ON a.id = os.activity_id
           WHERE a.contact_id = $1`,
          [contact.id],
        ),
      ),
    ]);

  const now = Date.now();
  const daysSince = (date: Date): number =>
    Math.floor((now - date.getTime()) / (1000 * 60 * 60 * 24));

  const openDeals = dealsRaw.filter((deal) => deal.close_date === null);

  return {
    contact: {
      id: contact.id,
      name: `${contact.first_name} ${contact.last_name}`,
      title: contact.title ?? null,
      company: account?.name ?? null,
      contact_since: contact.created_at.toISOString(),
      last_interaction_at: lastActivityResult.rows[0]?.created_at.toISOString() ?? null,
    },
    open_opportunities: openDeals.map((deal) => ({
      deal_id: deal.id,
      name: deal.name,
      stage: deal.stage,
      value: deal.value,
      currency: deal.currency,
      // updated_at is used as a proxy for "entered current stage" — no dedicated
      // stage-entry timestamp exists, matching stageAdvancementService's convention.
      days_in_current_stage: daysSince(deal.updated_at),
    })),
    recent_activities: recentActivitiesResult.rows.map((row) => ({
      type: row.type,
      subject: row.subject,
      notes: row.notes,
      days_ago: daysSince(row.created_at),
    })),
    open_tasks: openTasksResult.rows.map((row) => row.subject),
    known_objections: objectionsResult.rows.map((row) => row.category),
  };
}

function buildSystemPrompt(): string {
  return (
    'You are a CRM sales assistant preparing a pre-meeting brief for a rep about to call or ' +
    'meet with a contact. You are given the contact, their open opportunities, recent activity ' +
    'history, open tasks, and any previously logged objection categories. Write a concise account ' +
    'summary, summarize the most recent interactions in plain language, suggest 3-5 talking points ' +
    'grounded in the specific data provided, and suggest one next step per open opportunity ID. ' +
    'Call the report_meeting_brief tool exactly once.'
  );
}

/**
 * Generates (or regenerates) the pre-meeting brief for an activity and persists
 * the result, overwriting any prior brief for the same activity. Returns null
 * when the activity does not exist or has no linked contact.
 */
export async function generateMeetingBrief(
  activityId: string,
  userId: string,
  userRole: string,
): Promise<MeetingBriefResponse | null> {
  const context = await gatherBriefContext(activityId);
  if (!context) return null;

  let brief: MeetingBriefContent;

  // IS_E2E must short-circuit before the ai_configuration.enabled check —
  // reset-e2e-data.ts always sets enabled=false in the E2E database.
  if (IS_E2E) {
    brief = {
      ...E2E_STUB_BRIEF,
      contact_snapshot: { ...E2E_STUB_BRIEF.contact_snapshot, name: context.contact.name },
    };
  } else {
    const configResult = await pool.query<AiConfigRow>(
      `SELECT model, api_key_encrypted, api_key_key_version, base_url, enabled, web_search_enabled
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
    const { sanitised, strippedFields } = await applyPiiFilter(context, 'contact');
    if (strippedFields.length > 0) {
      logger.info(
        { activityId, strippedFields },
        'Meeting brief: fields stripped from AI payload (MINCRM-445)',
      );
    }

    let response: Anthropic.Messages.Message;
    try {
      response = await anthropicClient.messages.create({
        model: row.model,
        max_tokens: 1536,
        system: buildSystemPrompt(),
        tools: [BRIEF_TOOL],
        tool_choice: { type: 'tool', name: BRIEF_TOOL_NAME },
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

    // On-demand, user-initiated call — attributable, unlike sentiment's background job.
    recordTokenUsage(
      userId,
      response.usage.input_tokens,
      response.usage.output_tokens,
      'meeting_brief',
    );

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === 'tool_use' && block.name === BRIEF_TOOL_NAME,
    );
    if (!toolUseBlock) {
      throw Object.assign(new Error('AI provider did not return a meeting brief'), {
        statusCode: 502,
      });
    }

    // Safe: forced tool_choice guarantees Claude returns exactly this shape (schema enforced
    // server-side via the tool's input_schema); ToolUseBlock.input is typed unknown by the SDK.
    const input = toolUseBlock.input as {
      account_summary: string;
      recent_activity_summary: string[];
      suggested_talking_points: string[];
      next_steps: Array<{ deal_id: string; next_step: string }>;
    };
    const nextStepByDealId = new Map(input.next_steps.map((s) => [s.deal_id, s.next_step]));

    brief = {
      contact_snapshot: {
        name: context.contact.name,
        title: context.contact.title,
        company: context.contact.company,
        contact_since: context.contact.contact_since,
        last_interaction_at: context.contact.last_interaction_at,
      },
      account_summary: input.account_summary,
      open_opportunities: context.open_opportunities.map((deal) => ({
        deal_id: deal.deal_id,
        name: deal.name,
        stage: deal.stage,
        value: deal.value,
        currency: deal.currency,
        days_in_current_stage: deal.days_in_current_stage,
        next_step: nextStepByDealId.get(deal.deal_id) ?? null,
      })),
      recent_activity_summary: input.recent_activity_summary,
      suggested_talking_points: input.suggested_talking_points,
      known_objections: context.known_objections,
    };

    // Optional news hook (MINCRM-465) — only attempted when the admin has enabled it and
    // there's a company name to search for. Best-effort: never fails the brief.
    if (row.web_search_enabled && context.contact.company) {
      const newsHook = await gatherNewsHook(anthropicClient, row.model, context.contact.company);
      if (newsHook) {
        brief.news_hook = newsHook;
      }
    }
  }

  // Follow-up timing suggestion (MINCRM-470) — a cached, deterministically-computed
  // fact, not LLM-authored. Fetched at read time (after the AI call, not sent to the
  // LLM as context) so it always reflects the latest cached suggestion regardless of
  // whether the brief itself was just regenerated or served from the E2E stub path.
  // Gated on the same flag as the standalone endpoint/NLI tool — this UI path must
  // not expose data the caller couldn't reach directly when the flag is off for them.
  const activity = await findActivityById(activityId);
  if (
    activity?.contact_id &&
    (await isFlagEnabledForUser('ai_followup_timing_suggestions', userId, userRole))
  ) {
    const followupTiming = await getFollowUpTiming(activity.contact_id);
    if (followupTiming) {
      brief.followup_timing = followupTiming;
    }
  }

  const generatedAt = new Date();
  await pool.query(
    `INSERT INTO activity_meeting_briefs (activity_id, brief_json, generated_by, generated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (activity_id) DO UPDATE
       SET brief_json = $2, generated_by = $3, generated_at = $4`,
    [activityId, JSON.stringify(brief), userId, generatedAt],
  );

  return {
    activity_id: activityId,
    brief,
    generated_by: userId,
    generated_at: generatedAt.toISOString(),
  };
}

/** Returns the most recently generated brief for an activity, or null if none exists. */
export async function getMeetingBrief(activityId: string): Promise<MeetingBriefResponse | null> {
  const result = await pool.query<{
    brief_json: MeetingBriefContent;
    generated_by: string;
    generated_at: Date;
  }>(
    `SELECT brief_json, generated_by, generated_at FROM activity_meeting_briefs WHERE activity_id = $1`,
    [activityId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    activity_id: activityId,
    brief: row.brief_json,
    generated_by: row.generated_by,
    generated_at: row.generated_at.toISOString(),
  };
}
