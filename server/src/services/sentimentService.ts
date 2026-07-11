/**
 * Sentiment tracking service — background AI classification of activity
 * notes and call summaries, plus contact/account trend rollups. (MINCRM-472)
 *
 * scoreActivitySentiment() is the event-driven entry point, fired
 * fire-and-forget after an activity is created or its notes are updated
 * (activityService.createActivity / updateActivity), mirroring the
 * analyzeContactSignals convention: errors are caught and logged, never
 * propagated to the triggering request.
 *
 * Sentiment scores stored in the DB are not re-sent to the AI provider on
 * subsequent unrelated calls — only the note/summary text for the specific
 * scoring call goes through applyPiiFilter. (MINCRM-445)
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { writeAuditEntry, type AuditActor } from './auditService.js';
import { isFeatureEnabled } from './featureFlagService.js';
import type {
  SentimentValue,
  SentimentTrendState,
  SentimentScorePoint,
  ContactSentimentTrendResponse,
  AccountSentimentTrendResponse,
} from '@minicrm/shared/schemas/sentimentScoreSchema.js';
import { SENTIMENT_VALUES } from '@minicrm/shared/schemas/sentimentScoreSchema.js';

const IS_E2E = process.env.E2E === 'true';

/** Number of most-recent contact interactions considered for the sparkline/trend. */
const CONTACT_TREND_WINDOW = 10;
/** Number of days of account activity considered for the aggregate trend. */
const ACCOUNT_TREND_WINDOW_DAYS = 90;
/** Minimum non-flagged scores required before a trend is computed — below this, data is insufficient. */
const MIN_SCORES_FOR_TREND = 2;

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
}

const SCORE_TOOL_NAME = 'report_activity_sentiment';

const SCORE_TOOL: Anthropic.Messages.Tool = {
  name: SCORE_TOOL_NAME,
  description: 'Reports the sentiment of a single CRM activity note or call summary.',
  input_schema: {
    type: 'object',
    properties: {
      sentiment: {
        type: 'string',
        enum: [...SENTIMENT_VALUES],
        description: 'Overall sentiment conveyed by the note, inferred from tone and language.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence in this classification, from 0 to 1.',
      },
    },
    required: ['sentiment', 'confidence'],
  },
};

function buildSystemPrompt(): string {
  return (
    'You score the sentiment of a single CRM activity note or call summary. Infer sentiment ' +
    'from the tone and language used — not from keyword matching. "Positive" indicates warmth, ' +
    'enthusiasm, or forward progress; "negative" indicates frustration, pushback, or a cooling ' +
    'relationship; "neutral" covers factual or administrative notes with no clear emotional signal. ' +
    'Call the report_activity_sentiment tool exactly once.'
  );
}

interface ScoreActivitySentimentParams {
  activityId: string;
  notes: string | null;
  subject: string;
}

/**
 * Scores a single activity's note text for sentiment and upserts the result.
 * No-ops when there is no note/subject text to score. Fire-and-forget —
 * callers must not await this.
 */
export async function scoreActivitySentiment(params: ScoreActivitySentimentParams): Promise<void> {
  try {
    const noteText = [params.subject, params.notes].filter(Boolean).join('\n').trim();
    if (!noteText) return;

    // Mirrors championBlockerService: the background job must stop writing new
    // scores as soon as an admin disables the flag, even mid-flight.
    if (!(await isFeatureEnabled('ai_sentiment_tracking'))) return;

    const configResult = await pool.query<AiConfigRow>(
      `SELECT model, api_key_encrypted, api_key_key_version, base_url, enabled
       FROM ai_configuration
       LIMIT 1`,
    );
    const config = configResult.rows[0];
    if (!config?.enabled) return;

    let result: { sentiment: SentimentValue; confidence: number } | null = null;

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

      // 'contact' is the closest valid EntityType hint for activity note text — activities
      // themselves are outside ai_field_exclusions' supported entity set. (MINCRM-445)
      const { sanitised } = await applyPiiFilter({ note_text: noteText }, 'contact');

      const response = await anthropicClient.messages.create({
        model: config.model,
        max_tokens: 256,
        system: buildSystemPrompt(),
        tools: [SCORE_TOOL],
        tool_choice: { type: 'tool', name: SCORE_TOOL_NAME },
        messages: [{ role: 'user', content: JSON.stringify(sanitised) }],
      });

      // Event-driven background analysis, not a per-user request — ai_token_usage FKs
      // user_id to a real users row (NOT NULL, ON DELETE CASCADE), so there is no valid
      // per-user attribution here. Logged for cost observability instead, matching
      // championBlockerService's background-job token accounting.
      logger.info(
        { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        'sentiment: AI token usage (not attributed to a user — background job)',
      );

      const toolUseBlock = response.content.find(
        (block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === 'tool_use' && block.name === SCORE_TOOL_NAME,
      );
      const input = toolUseBlock?.input as
        | { sentiment: SentimentValue; confidence: number }
        | undefined;
      if (input?.sentiment) {
        result = { sentiment: input.sentiment, confidence: input.confidence };
      }
    }

    if (!result) return;

    await pool.query(
      `INSERT INTO activity_sentiment_scores (activity_id, sentiment, confidence, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (activity_id) DO UPDATE
         SET sentiment = $2, confidence = $3, updated_at = now(),
             -- Only clear a prior "not accurate" flag when the classification actually
             -- changes — a genuine re-score (e.g. notes edited) supersedes the flag since
             -- it applied to the old classification, but a same-value duplicate write (a
             -- delayed/duplicate fire-and-forget scoring call racing a rep's flag action)
             -- must not silently un-flag a score the rep already reviewed. (MINCRM-472
             -- self-review)
             flagged_inaccurate_by = CASE
               WHEN activity_sentiment_scores.sentiment IS DISTINCT FROM $2
                 THEN NULL ELSE activity_sentiment_scores.flagged_inaccurate_by END,
             flagged_inaccurate_at = CASE
               WHEN activity_sentiment_scores.sentiment IS DISTINCT FROM $2
                 THEN NULL ELSE activity_sentiment_scores.flagged_inaccurate_at END`,
      [params.activityId, result.sentiment, result.confidence],
    );
  } catch (err) {
    logger.error({ err, activityId: params.activityId }, 'sentiment: scoring failed');
  }
}

/** Recency-weighted trend: compares the average sentiment of the newest and oldest thirds
 * of the window. Ties (including windows too small to split into thirds) are "stable". */
function computeTrend(points: SentimentScorePoint[]): SentimentTrendState | null {
  if (points.length < MIN_SCORES_FOR_TREND) return null;

  const toScore = (s: SentimentValue): number => (s === 'positive' ? 1 : s === 'negative' ? -1 : 0);
  // points are ordered newest-first.
  const third = Math.max(1, Math.floor(points.length / 3));
  const newest = points.slice(0, third);
  const oldest = points.slice(-third);

  const avg = (pts: SentimentScorePoint[]): number =>
    pts.reduce((sum, p) => sum + toScore(p.sentiment), 0) / pts.length;

  const delta = avg(newest) - avg(oldest);
  const TREND_THRESHOLD = 0.34; // roughly one sentiment-step of average movement
  if (delta >= TREND_THRESHOLD) return 'warming';
  if (delta <= -TREND_THRESHOLD) return 'cooling';
  return 'stable';
}

interface SentimentRow {
  activity_id: string;
  sentiment: SentimentValue;
  flagged_inaccurate_at: Date | null;
  // The activity's actual interaction time (due_date, falling back to the
  // activity's created_at when due_date is unset) — NOT the sentiment row's
  // own created_at, which is when scoring ran and can lag far behind the
  // interaction itself (e.g. an older activity edited and scored for the
  // first time). Ordering/windowing by this keeps the trend and sparkline in
  // true chronological order of the interactions they represent.
  interaction_at: Date;
}

function toPoints(rows: SentimentRow[]): SentimentScorePoint[] {
  return rows.map((row) => ({
    activity_id: row.activity_id,
    sentiment: row.sentiment,
    flagged_inaccurate: row.flagged_inaccurate_at !== null,
    created_at: row.interaction_at.toISOString(),
  }));
}

/** Sentiment trend for a contact's last CONTACT_TREND_WINDOW interactions. */
export async function getContactSentimentTrend(
  contactId: string,
): Promise<ContactSentimentTrendResponse> {
  const result = await pool.query<SentimentRow>(
    `SELECT s.activity_id, s.sentiment, s.flagged_inaccurate_at,
            COALESCE(a.due_date::timestamptz, a.created_at) AS interaction_at
     FROM activity_sentiment_scores s
     JOIN activities a ON a.id = s.activity_id
     WHERE a.contact_id = $1
     ORDER BY interaction_at DESC
     LIMIT $2`,
    [contactId, CONTACT_TREND_WINDOW],
  );

  const allPoints = toPoints(result.rows);
  const scoredPoints = allPoints.filter((p) => !p.flagged_inaccurate);

  return {
    contact_id: contactId,
    trend: computeTrend(scoredPoints),
    has_sufficient_data: scoredPoints.length >= MIN_SCORES_FOR_TREND,
    points: allPoints,
  };
}

/** Aggregate sentiment trend across all contacts at an account, last ACCOUNT_TREND_WINDOW_DAYS days. */
export async function getAccountSentimentTrend(
  accountId: string,
): Promise<AccountSentimentTrendResponse> {
  const result = await pool.query<SentimentRow>(
    `SELECT s.activity_id, s.sentiment, s.flagged_inaccurate_at,
            COALESCE(a.due_date::timestamptz, a.created_at) AS interaction_at
     FROM activity_sentiment_scores s
     JOIN activities a ON a.id = s.activity_id
     LEFT JOIN contacts c ON c.id = a.contact_id
     LEFT JOIN deals d ON d.id = a.deal_id
     WHERE (a.account_id = $1 OR c.account_id = $1 OR d.account_id = $1)
       AND COALESCE(a.due_date::timestamptz, a.created_at) >= now() - ($2 || ' days')::interval
     ORDER BY interaction_at DESC`,
    [accountId, ACCOUNT_TREND_WINDOW_DAYS],
  );

  const allPoints = toPoints(result.rows);
  const scoredPoints = allPoints.filter((p) => !p.flagged_inaccurate);

  return {
    account_id: accountId,
    trend: computeTrend(scoredPoints),
    has_sufficient_data: scoredPoints.length >= MIN_SCORES_FOR_TREND,
    points: allPoints,
  };
}

/** Rep-initiated "Not accurate" feedback — excludes the score from trend calculations. */
export async function flagSentimentScoreInaccurate(
  activityId: string,
  actor: AuditActor,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateResult = await client.query(
      `UPDATE activity_sentiment_scores
       SET flagged_inaccurate_by = $2, flagged_inaccurate_at = now(), updated_at = now()
       WHERE activity_id = $1
       RETURNING id`,
      [activityId, actor.id],
    );

    if (updateResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await writeAuditEntry(client, {
      recordType: 'activity',
      recordId: activityId,
      eventType: 'updated',
      fieldName: 'sentiment_flagged_inaccurate',
      oldValue: null,
      newValue: 'true',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
