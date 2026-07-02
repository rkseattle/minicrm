/**
 * Champion/blocker detection service — background AI classification of
 * contacts based on champion/blocker language in activity notes. (MINCRM-466)
 *
 * analyzeContactSignals() is the event-driven entry point, fired
 * fire-and-forget after each new activity is saved (activityService.createActivity),
 * mirroring the fireAutomationTrigger convention: errors are caught and
 * logged, never propagated to the triggering request.
 *
 * Classification is not visible to contacts — internal only. Always labeled
 * as AI-inferred, never presented as fact, per the ticket's Privacy & Accuracy AC.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { findDealById } from './dealService.js';
import type {
  ChampionBlockerStatus,
  ChampionBlockerSignal,
  ContactChampionBlockerResponse,
  StakeholderMapResponse,
  StakeholderMapEntry,
} from '@minicrm/shared/schemas/championBlockerSchema.js';
import { CHAMPION_BLOCKER_STATUSES } from '@minicrm/shared/schemas/championBlockerSchema.js';

const IS_E2E = process.env.E2E === 'true';

/** Signals older than this no longer contribute to the classification. */
const SIGNAL_DECAY_DAYS = 90;
/** Maximum contributing signals retained per contact (most recent kept). */
const MAX_SIGNALS = 10;

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
  champion_blocker_deal_value_threshold: string;
}

const CLASSIFY_TOOL_NAME = 'report_champion_blocker_signal';

const CLASSIFY_TOOL: Anthropic.Messages.Tool = {
  name: CLASSIFY_TOOL_NAME,
  description:
    'Reports whether an activity note contains champion or blocker language about a contact.',
  input_schema: {
    type: 'object',
    properties: {
      signal_detected: {
        type: 'boolean',
        description: 'True only when the note contains clear champion or blocker language.',
      },
      direction: {
        type: 'string',
        enum: ['champion', 'blocker'],
        description: 'Required when signal_detected is true.',
      },
      description: {
        type: 'string',
        description:
          'Short quote or paraphrase of the signal, e.g. "Mentioned sharing proposal with VP Finance". Required when signal_detected is true.',
      },
    },
    required: ['signal_detected'],
  },
};

function buildSystemPrompt(): string {
  return (
    'You scan a single CRM activity note for champion or blocker language about the contact ' +
    'it concerns. Champion signals: internal advocacy language ("taking this to the team", ' +
    '"I\'ve shared this with my manager"), reference to internal budget or approval processes ' +
    'being initiated. Blocker signals: deflection language, negative sentiment, references to ' +
    'a competing vendor being preferred, mentions of another stakeholder with veto authority. ' +
    'Only report signal_detected=true when the language is clear — do not infer from silence or ' +
    'neutral small talk. Call the report_champion_blocker_signal tool exactly once.'
  );
}

interface AnalyzeContactSignalsParams {
  activityId: string;
  contactId: string | null;
  notes: string | null;
  subject: string;
}

/**
 * Scans a single activity's note text for champion/blocker signals and
 * updates the contact's classification. No-ops when the activity has no
 * linked contact. Fire-and-forget — callers must not await this.
 */
export async function analyzeContactSignals(params: AnalyzeContactSignalsParams): Promise<void> {
  if (!params.contactId) return;

  try {
    const noteText = [params.subject, params.notes].filter(Boolean).join('\n').trim();
    if (!noteText) return;

    const configResult = await pool.query<AiConfigRow>(
      `SELECT model, api_key_encrypted, api_key_key_version, base_url, enabled,
              champion_blocker_deal_value_threshold
       FROM ai_configuration
       LIMIT 1`,
    );
    const config = configResult.rows[0];
    if (!config?.enabled) return;

    let signal: { direction: 'champion' | 'blocker'; description: string } | null = null;

    if (IS_E2E) {
      signal = null;
    } else {
      if (!config.api_key_encrypted || config.api_key_encrypted.trim() === '') return;
      const apiKey = decryptVersioned(config.api_key_encrypted, config.api_key_key_version ?? 1);
      const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
      if (config.base_url && config.base_url.trim() !== '') {
        clientOptions.baseURL = config.base_url;
      }
      const anthropicClient = new Anthropic(clientOptions);

      const { sanitised } = await applyPiiFilter({ note_text: noteText }, 'contact');

      const response = await anthropicClient.messages.create({
        model: config.model,
        max_tokens: 512,
        system: buildSystemPrompt(),
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: 'tool', name: CLASSIFY_TOOL_NAME },
        messages: [{ role: 'user', content: JSON.stringify(sanitised) }],
      });

      // This is an event-driven background analysis, not a per-user request — ai_token_usage/
      // ai_token_usage_daily both FK user_id to a real users row (ON DELETE CASCADE, NOT NULL),
      // so there is no valid per-user attribution here. Logged for cost observability instead,
      // matching winLossAnalysisService's background-job token accounting. (MINCRM-464, MINCRM-466)
      logger.info(
        { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        'championBlocker: AI token usage (not attributed to a user — background job)',
      );

      const toolUseBlock = response.content.find(
        (block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === 'tool_use' && block.name === CLASSIFY_TOOL_NAME,
      );
      const input = toolUseBlock?.input as
        | { signal_detected: boolean; direction?: 'champion' | 'blocker'; description?: string }
        | undefined;
      if (input?.signal_detected && input.direction && input.description) {
        signal = { direction: input.direction, description: input.description };
      }
    }

    if (!signal) return;

    await applySignal(params.contactId, params.activityId, signal);
  } catch (err) {
    logger.error({ err, activityId: params.activityId }, 'championBlocker: analysis failed');
  }
}

/** Merges a newly detected signal into the contact's classification row. */
async function applySignal(
  contactId: string,
  activityId: string,
  signal: { direction: 'champion' | 'blocker'; description: string },
): Promise<void> {
  const existingResult = await pool.query<{ contributing_signals: ChampionBlockerSignal[] }>(
    `SELECT contributing_signals FROM contact_champion_blocker_signals WHERE contact_id = $1`,
    [contactId],
  );
  const existingSignals: ChampionBlockerSignal[] =
    existingResult.rows[0]?.contributing_signals ?? [];

  const newSignal: ChampionBlockerSignal & { direction: 'champion' | 'blocker' } = {
    description: signal.description,
    detected_at: new Date().toISOString(),
    direction: signal.direction,
  };
  const mergedSignals = [newSignal, ...existingSignals].slice(0, MAX_SIGNALS);

  const status = classifyFromSignals(
    mergedSignals as Array<ChampionBlockerSignal & { direction?: string }>,
  );

  await pool.query(
    `INSERT INTO contact_champion_blocker_signals (contact_id, status, confidence, contributing_signals, last_activity_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (contact_id) DO UPDATE
       SET status = $2, confidence = $3, contributing_signals = $4, last_activity_id = $5, updated_at = now()`,
    [
      contactId,
      status,
      computeConfidence(mergedSignals.length),
      JSON.stringify(mergedSignals),
      activityId,
    ],
  );
}

/** Recency-weighted decay: signals older than SIGNAL_DECAY_DAYS no longer count. */
function classifyFromSignals(
  signals: Array<{ detected_at: string; direction?: string }>,
): ChampionBlockerStatus {
  const now = Date.now();
  const active = signals.filter(
    (s) => (now - new Date(s.detected_at).getTime()) / (1000 * 60 * 60 * 24) <= SIGNAL_DECAY_DAYS,
  );
  const championCount = active.filter((s) => s.direction === 'champion').length;
  const blockerCount = active.filter((s) => s.direction === 'blocker').length;

  if (championCount === 0 && blockerCount === 0) return 'neutral';
  if (championCount > blockerCount) return championCount >= 2 ? 'champion' : 'likely_champion';
  if (blockerCount > championCount) return blockerCount >= 2 ? 'blocker' : 'likely_blocker';
  return 'neutral';
}

function computeConfidence(signalCount: number): number {
  return Math.min(1, signalCount / MAX_SIGNALS);
}

/** Returns the effective champion/blocker classification for a contact, applying any override. */
export async function getContactChampionBlockerStatus(
  contactId: string,
): Promise<ContactChampionBlockerResponse> {
  const result = await pool.query<{
    status: string;
    contributing_signals: Array<ChampionBlockerSignal & { direction?: string }>;
    override_status: string | null;
    dismissed_at: Date | null;
    updated_at: Date;
  }>(
    `SELECT status, contributing_signals, override_status, dismissed_at, updated_at
     FROM contact_champion_blocker_signals
     WHERE contact_id = $1`,
    [contactId],
  );
  const row = result.rows[0];

  if (!row) {
    return {
      contact_id: contactId,
      status: 'neutral',
      is_overridden: false,
      recent_signals: [],
      dismissed: false,
      updated_at: new Date(0).toISOString(),
    };
  }

  const effectiveStatus = (row.override_status ?? row.status) as ChampionBlockerStatus;
  const recentSignals = (row.contributing_signals ?? [])
    .slice(0, 2)
    .map((s) => ({ description: s.description, detected_at: s.detected_at }));

  return {
    contact_id: contactId,
    status: CHAMPION_BLOCKER_STATUSES.includes(effectiveStatus) ? effectiveStatus : 'neutral',
    is_overridden: row.override_status !== null,
    recent_signals: recentSignals,
    dismissed: row.dismissed_at !== null,
    updated_at: row.updated_at.toISOString(),
  };
}

/** Rep-initiated "Not accurate" dismissal — suppresses the badge until new signals arrive. */
export async function dismissContactClassification(
  contactId: string,
  userId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO contact_champion_blocker_signals (contact_id, dismissed_by, dismissed_at, updated_at)
     VALUES ($1, $2, now(), now())
     ON CONFLICT (contact_id) DO UPDATE
       SET dismissed_by = $2, dismissed_at = now(), updated_at = now()`,
    [contactId, userId],
  );
}

/** Rep-initiated manual override, with an optional reason. Persists until new signals shift it. */
export async function overrideContactClassification(
  contactId: string,
  status: ChampionBlockerStatus,
  reason: string | null,
  userId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO contact_champion_blocker_signals (contact_id, override_status, override_reason, overridden_by, overridden_at, updated_at)
     VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT (contact_id) DO UPDATE
       SET override_status = $2, override_reason = $3, overridden_by = $4, overridden_at = now(), updated_at = now()`,
    [contactId, status, reason, userId],
  );
}

/**
 * Returns the stakeholder map for a deal: all linked contacts with their
 * champion/blocker status, plus a single-threaded-risk warning when only one
 * contact is engaged on a deal above the configured value threshold.
 */
export async function getDealStakeholderMap(dealId: string): Promise<StakeholderMapResponse> {
  const deal = await findDealById(dealId);

  const contactsResult = await pool.query<{
    id: string;
    first_name: string;
    last_name: string;
    status: string | null;
    override_status: string | null;
    dismissed_at: Date | null;
    last_activity_at: Date | null;
  }>(
    `SELECT c.id, c.first_name, c.last_name,
            s.status, s.override_status, s.dismissed_at,
            (SELECT MAX(a.created_at) FROM activities a WHERE a.contact_id = c.id) AS last_activity_at
     FROM contacts c
     INNER JOIN deal_contacts dc ON dc.contact_id = c.id
     LEFT JOIN contact_champion_blocker_signals s ON s.contact_id = c.id
     WHERE dc.deal_id = $1
     ORDER BY c.last_name ASC, c.first_name ASC`,
    [dealId],
  );

  const contacts: StakeholderMapEntry[] = contactsResult.rows.map((row) => {
    const effectiveStatus = (row.override_status ??
      row.status ??
      'neutral') as ChampionBlockerStatus;
    return {
      contact_id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      status: CHAMPION_BLOCKER_STATUSES.includes(effectiveStatus) ? effectiveStatus : 'neutral',
      is_overridden: row.override_status !== null,
      dismissed: row.dismissed_at !== null,
      last_activity_at: row.last_activity_at ? row.last_activity_at.toISOString() : null,
    };
  });

  const championCount = contacts.filter(
    (c) => !c.dismissed && (c.status === 'champion' || c.status === 'likely_champion'),
  ).length;
  const blockerCount = contacts.filter(
    (c) => !c.dismissed && (c.status === 'blocker' || c.status === 'likely_blocker'),
  ).length;

  const thresholdResult = await pool.query<{ champion_blocker_deal_value_threshold: string }>(
    `SELECT champion_blocker_deal_value_threshold FROM ai_configuration LIMIT 1`,
  );
  const threshold = parseFloat(
    thresholdResult.rows[0]?.champion_blocker_deal_value_threshold ?? '10000',
  );
  const dealValue = deal?.value ? parseFloat(deal.value) : 0;
  const singleThreadedRisk = contacts.length === 1 && dealValue > threshold;

  return {
    contacts,
    champion_count: championCount,
    blocker_count: blockerCount,
    single_threaded_risk: singleThreadedRisk,
  };
}
