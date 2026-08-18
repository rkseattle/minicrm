/**
 * Win/loss pattern analysis service — nightly AI job that mines closed deals
 * for patterns correlating with winning and losing.
 *
 * analyzeWinLossPatterns() is the cron entry point (server/src/server.ts).
 * It replaces the full deal_win_loss_insights table contents on each run —
 * the read path (getWinLossInsights) always serves the latest cached run,
 * never calling the AI on the request path.
 *
 * Follows the `advanceDueEnrollments()` shape: single exported async
 * function, per-signal error isolation so one bad computation doesn't abort
 * the whole run, structured logger calls throughout.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { SYSTEM_ACTOR, writeAuditEntry } from './auditService.js';
import type {
  WinLossInsight,
  LossReasonTrend,
  WinLossInsightsResponse,
} from '@minicrm/shared/schemas/winLossInsightSchema.js';

const IS_E2E = process.env.E2E === 'true';

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
  win_loss_min_closed_deals: number;
  win_loss_min_sample_size: number;
}

/** One closed deal's raw signal data, gathered before AI narration. */
interface ClosedDealSignals {
  id: string;
  won: boolean;
  activity_count: number;
  had_demo_in_week_1: boolean;
  contacts_engaged: number;
  deal_size: number | null;
  industry: string | null;
  lead_source: string | null;
  objection_logged: boolean;
  creation_to_close_days: number;
  loss_reason: string | null;
  close_date: string | null;
}

async function getAiConfig(): Promise<AiConfigRow | null> {
  const result = await pool.query<AiConfigRow>(
    `SELECT model, api_key_encrypted, api_key_key_version, base_url, enabled,
            win_loss_min_closed_deals, win_loss_min_sample_size
     FROM ai_configuration
     LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

/**
 * Gathers per-deal signal data for every closed deal (Closed Won or Closed
 * Lost). Matches the hardcoded stage-name convention already used by
 * reportService.getWinLossReport for won/lost detection.
 */
async function gatherClosedDealSignals(): Promise<ClosedDealSignals[]> {
  const result = await pool.query<{
    id: string;
    stage: string;
    created_at: Date;
    close_date: string | null;
    updated_at: Date;
    value: string | null;
    industry: string | null;
    lead_source: string | null;
    loss_reason: string | null;
    activity_count: string;
    demo_week1_count: string;
    contacts_engaged: string;
    objection_count: string;
  }>(
    `SELECT
       d.id, d.stage, d.created_at, d.close_date::text, d.updated_at, d.value,
       a.industry, l.lead_source, d.loss_reason,
       (SELECT COUNT(*) FROM activities act WHERE act.deal_id = d.id) AS activity_count,
       (SELECT COUNT(*) FROM activities act
          WHERE act.deal_id = d.id AND act.type = 'Meeting' AND act.subject ILIKE '%demo%'
            AND act.created_at <= d.created_at + interval '7 days') AS demo_week1_count,
       (SELECT COUNT(DISTINCT dc.contact_id) FROM deal_contacts dc WHERE dc.deal_id = d.id) AS contacts_engaged,
       (SELECT COUNT(*) FROM activities act
          WHERE act.deal_id = d.id AND act.notes ILIKE '%objection%') AS objection_count
     FROM deals d
     LEFT JOIN accounts a ON a.id = d.account_id
     LEFT JOIN leads l ON l.id = d.source_lead_id
     WHERE d.stage IN ('Closed Won', 'Closed Lost')`,
  );

  return result.rows.map((row) => {
    const closedAt = row.close_date ? new Date(row.close_date) : row.updated_at;
    return {
      id: row.id,
      won: row.stage === 'Closed Won',
      activity_count: parseInt(row.activity_count, 10),
      had_demo_in_week_1: parseInt(row.demo_week1_count, 10) > 0,
      contacts_engaged: parseInt(row.contacts_engaged, 10),
      deal_size: row.value ? parseFloat(row.value) : null,
      industry: row.industry,
      lead_source: row.lead_source,
      objection_logged: parseInt(row.objection_count, 10) > 0,
      creation_to_close_days: Math.max(
        0,
        Math.floor((closedAt.getTime() - row.created_at.getTime()) / (1000 * 60 * 60 * 24)),
      ),
      loss_reason: row.loss_reason,
      close_date: row.close_date,
    };
  });
}

/** Computes a win-rate-with-vs-without comparison for a boolean signal. */
function computeBinarySignalStats(
  deals: ClosedDealSignals[],
  predicate: (d: ClosedDealSignals) => boolean,
): { winRateWith: number; winRateWithout: number; sampleSize: number } {
  const withSignal = deals.filter(predicate);
  const withoutSignal = deals.filter((d) => !predicate(d));
  const winRate = (subset: ClosedDealSignals[]): number =>
    subset.length === 0 ? 0 : subset.filter((d) => d.won).length / subset.length;
  return {
    winRateWith: winRate(withSignal),
    winRateWithout: winRate(withoutSignal),
    sampleSize: withSignal.length,
  };
}

const SIGNAL_DEFINITIONS: Array<{
  signalType: string;
  predicate: (d: ClosedDealSignals) => boolean;
}> = [
  { signalType: 'demo_in_week_1', predicate: (d) => d.had_demo_in_week_1 },
  { signalType: 'multiple_contacts_engaged', predicate: (d) => d.contacts_engaged >= 2 },
  { signalType: 'objection_logged', predicate: (d) => d.objection_logged },
  // Renamed from 'fast_stage_velocity': there is no per-stage transition history table in
  // this schema, so this can only ever measure total deal lifecycle length (creation to
  // close) — not per-stage pipeline velocity. The old name/threshold duplicated
  // creation_to_close_days verbatim and implied a metric this data can't support.
  // (Greptile self-review finding)
  { signalType: 'fast_creation_to_close', predicate: (d) => d.creation_to_close_days <= 30 },
  { signalType: 'high_activity_count', predicate: (d) => d.activity_count >= 5 },
];

const ANALYSIS_TOOL_NAME = 'report_win_loss_insights';

const ANALYSIS_TOOL: Anthropic.Messages.Tool = {
  name: ANALYSIS_TOOL_NAME,
  description: 'Reports plain-language win/loss pattern observations and loss reason trends.',
  input_schema: {
    type: 'object',
    properties: {
      patterns: {
        type: 'array',
        description:
          'Plain-language observations for each statistically significant signal provided.',
        items: {
          type: 'object',
          properties: {
            signal_type: { type: 'string' },
            observation: {
              type: 'string',
              description:
                'Plain-language observation with supporting statistics, e.g. "Deals that include a live demo in week 1 close at 2.3x the rate of those that don\'t (based on 47 deals)."',
            },
          },
          required: ['signal_type', 'observation'],
        },
      },
      loss_reason_trends: {
        type: 'array',
        items: {
          type: 'object',
          properties: { observation: { type: 'string' } },
          required: ['observation'],
        },
        description: 'Plain-language trends in the free-text loss_reason distribution over time.',
      },
    },
    required: ['patterns', 'loss_reason_trends'],
  },
};

function buildSystemPrompt(): string {
  return (
    'You are a sales analytics assistant. You are given aggregate win-rate statistics for ' +
    'several deal signals (each already computed: win rate with vs without the signal, and ' +
    'sample size) plus a list of recent free-text loss reasons with dates. For each signal, ' +
    'write a plain-language observation citing the specific win-rate multiplier and sample ' +
    'size. For loss reasons, identify any notable trends over time (e.g. a recurring theme ' +
    'increasing in frequency). Call the report_win_loss_insights tool exactly once.'
  );
}

/**
 * Nightly cron entry point. Recomputes win/loss signal statistics for all
 * closed deals, asks Claude to narrate the statistically significant ones,
 * and replaces the deal_win_loss_insights table contents. No-ops below the
 * admin-configured minimum closed-deal threshold.
 */
export async function analyzeWinLossPatterns(): Promise<void> {
  try {
    const config = await getAiConfig();
    if (!config?.enabled) {
      logger.info('winLossAnalysis: skipped — AI is not enabled');
      return;
    }

    const deals = await gatherClosedDealSignals();
    if (deals.length < config.win_loss_min_closed_deals) {
      logger.info(
        { closedDeals: deals.length, required: config.win_loss_min_closed_deals },
        'winLossAnalysis: skipped — below minimum closed-deal threshold',
      );
      return;
    }

    const signalStats = SIGNAL_DEFINITIONS.map((def) => {
      const stats = computeBinarySignalStats(deals, def.predicate);
      return { signal_type: def.signalType, ...stats };
    }).filter((s) => s.sampleSize >= config.win_loss_min_sample_size);

    if (signalStats.length === 0) {
      logger.info('winLossAnalysis: no signals met the minimum sample size threshold');
      await replaceInsights([], []);
      return;
    }

    const lossReasonTrendInput = deals
      .filter((d) => !d.won && d.loss_reason)
      .map((d) => ({ loss_reason: d.loss_reason, close_date: d.close_date }));

    let narratedPatterns: Array<{ signal_type: string; observation: string }> = [];
    let narratedTrends: Array<{ observation: string }> = [];

    if (IS_E2E) {
      narratedPatterns = signalStats.map((s) => ({
        signal_type: s.signal_type,
        observation: `[E2E stub] ${s.signal_type} pattern (${s.sampleSize} deals).`,
      }));
    } else {
      const result = await callAiForNarration(config, signalStats, lossReasonTrendInput);
      narratedPatterns = result.patterns;
      narratedTrends = result.trends;
    }

    const insights = signalStats
      .map((s) => {
        const narration = narratedPatterns.find((p) => p.signal_type === s.signal_type);
        if (!narration) return null;
        return {
          signal_type: s.signal_type,
          observation: narration.observation,
          win_rate_with: s.winRateWith,
          win_rate_without: s.winRateWithout,
          sample_size: s.sampleSize,
          is_win_pattern: s.winRateWith >= s.winRateWithout,
        };
      })
      .filter((i): i is NonNullable<typeof i> => i !== null);

    await replaceInsights(insights, narratedTrends);
    logger.info(
      { insightCount: insights.length, trendCount: narratedTrends.length },
      'winLossAnalysis: nightly run complete',
    );
  } catch (err) {
    logger.error({ err }, 'winLossAnalysis: nightly run failed');
  }
}

async function callAiForNarration(
  config: AiConfigRow,
  signalStats: Array<{
    signal_type: string;
    winRateWith: number;
    winRateWithout: number;
    sampleSize: number;
  }>,
  lossReasonTrendInput: Array<{ loss_reason: string | null; close_date: string | null }>,
): Promise<{
  patterns: Array<{ signal_type: string; observation: string }>;
  trends: Array<{ observation: string }>;
}> {
  if (!config.api_key_encrypted || config.api_key_encrypted.trim() === '') {
    logger.warn('winLossAnalysis: AI API key is not configured — skipping narration');
    return { patterns: [], trends: [] };
  }

  const apiKey = decryptVersioned(config.api_key_encrypted, config.api_key_key_version ?? 1);
  const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
  if (config.base_url && config.base_url.trim() !== '') {
    clientOptions.baseURL = config.base_url;
  }
  const anthropicClient = new Anthropic(clientOptions);

  const { sanitised } = await applyPiiFilter(
    { signal_stats: signalStats, loss_reasons: lossReasonTrendInput },
    'deal',
  );

  const response = await anthropicClient.messages.create({
    model: config.model,
    max_tokens: 2048,
    system: buildSystemPrompt(),
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: ANALYSIS_TOOL_NAME },
    messages: [{ role: 'user', content: JSON.stringify(sanitised) }],
  });

  // This is a background job, not a per-user request — ai_token_usage/ai_token_usage_daily
  // both FK user_id to a real users row (ON DELETE CASCADE, NOT NULL), so there is no valid
  // per-user attribution for a cron-triggered call. Logged for cost observability instead of
  // recordTokenUsage, which would otherwise fail its insert against SYSTEM_ACTOR's placeholder id.
  logger.info(
    { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    'winLossAnalysis: AI token usage (not attributed to a user — background job)',
  );

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === 'tool_use' && block.name === ANALYSIS_TOOL_NAME,
  );
  if (!toolUseBlock) {
    logger.warn('winLossAnalysis: AI did not return the expected tool call');
    return { patterns: [], trends: [] };
  }

  // Safe: forced tool_choice guarantees Claude returns exactly this shape (schema enforced
  // server-side via the tool's input_schema); ToolUseBlock.input is typed unknown by the SDK.
  const input = toolUseBlock.input as {
    patterns: Array<{ signal_type: string; observation: string }>;
    loss_reason_trends: Array<{ observation: string }>;
  };
  return { patterns: input.patterns ?? [], trends: input.loss_reason_trends ?? [] };
}

/**
 * Replaces the full contents of deal_win_loss_insights and a lightweight
 * loss-reason-trends cache in a single transaction, plus an audit entry.
 * Trends are stored as a single row keyed by signal_type = 'loss_reason_trend'
 * with the observation text carrying the narrative (no separate stats needed).
 */
async function replaceInsights(
  insights: Array<{
    signal_type: string;
    observation: string;
    win_rate_with: number;
    win_rate_without: number;
    sample_size: number;
    is_win_pattern: boolean;
  }>,
  trends: Array<{ observation: string }>,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM deal_win_loss_insights');

    for (const insight of insights) {
      await client.query(
        `INSERT INTO deal_win_loss_insights
           (signal_type, observation, win_rate_with, win_rate_without, sample_size, is_win_pattern)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          insight.signal_type,
          insight.observation,
          insight.win_rate_with,
          insight.win_rate_without,
          insight.sample_size,
          insight.is_win_pattern,
        ],
      );
    }

    for (const trend of trends) {
      await client.query(
        `INSERT INTO deal_win_loss_insights
           (signal_type, observation, win_rate_with, win_rate_without, sample_size, is_win_pattern)
         VALUES ('loss_reason_trend', $1, 0, 0, 0, false)`,
        [trend.observation],
      );
    }

    await writeAuditEntry(client, {
      recordType: 'ai_settings',
      recordName: 'Win/Loss Insights',
      eventType: 'updated',
      fieldName: 'nightly_analysis',
      oldValue: null,
      newValue: `${insights.length} insight(s), ${trends.length} trend(s)`,
      changedById: SYSTEM_ACTOR.id,
      changedByName: SYSTEM_ACTOR.name,
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
 * Serves the cached results of the most recent nightly run. Never calls the
 * AI on the request path.
 */
export async function getWinLossInsights(): Promise<WinLossInsightsResponse> {
  const config = await getAiConfig();
  const minClosedDeals = config?.win_loss_min_closed_deals ?? 20;

  const closedCountResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM deals WHERE stage IN ('Closed Won', 'Closed Lost')`,
  );
  const closedDealsCount = parseInt(closedCountResult.rows[0]?.count ?? '0', 10);

  const rowsResult = await pool.query<{
    id: string;
    signal_type: string;
    observation: string;
    win_rate_with: string;
    win_rate_without: string;
    sample_size: number;
    is_win_pattern: boolean;
    generated_at: Date;
  }>(
    `SELECT id, signal_type, observation, win_rate_with, win_rate_without, sample_size, is_win_pattern, generated_at
     FROM deal_win_loss_insights
     ORDER BY ABS(win_rate_with - win_rate_without) DESC, generated_at DESC`,
  );

  const insights: WinLossInsight[] = [];
  const lossReasonTrends: LossReasonTrend[] = [];

  for (const row of rowsResult.rows) {
    if (row.signal_type === 'loss_reason_trend') {
      lossReasonTrends.push({
        observation: row.observation,
        generated_at: row.generated_at.toISOString(),
      });
      continue;
    }
    insights.push({
      id: row.id,
      signal_type: row.signal_type,
      observation: row.observation,
      win_rate_with: parseFloat(row.win_rate_with),
      win_rate_without: parseFloat(row.win_rate_without),
      sample_size: row.sample_size,
      is_win_pattern: row.is_win_pattern,
      generated_at: row.generated_at.toISOString(),
    });
  }

  return {
    insights,
    loss_reason_trends: lossReasonTrends,
    has_sufficient_data: closedDealsCount >= minClosedDeals,
    min_closed_deals_required: minClosedDeals,
    closed_deals_count: closedDealsCount,
  };
}
