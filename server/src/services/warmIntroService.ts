/**
 * Warm introduction path mapping service. (MINCRM-468)
 *
 * Traversal (Rep -> Known Contact -> Target Contact, capped at 2 hops) is
 * pure query/graph logic over existing relationship data — no AI call.
 * Candidate "known contacts" are contacts the requesting rep has actually
 * engaged with (owns, or has logged activity against), scoped by the same
 * visibility policy as the rest of the app. A known contact is linked to
 * the target when they share an account (direct or parent/child hierarchy),
 * co-occur on a deal together, or the target's name/company appears in the
 * known contact's notes (best-effort keyword match — not real NLP entity
 * extraction, a known limitation).
 *
 * Only the "suggested introduction message" is AI-generated; the traversal
 * and ranking themselves are deterministic.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { findContactById } from './contactService.js';
import { findAccountById } from './accountService.js';
import { buildVisibilityFilter } from './visibilityService.js';
import { withRlsQuery } from './rlsContextService.js';
import type {
  WarmIntroPath,
  WarmIntroPathResponse,
} from '@minicrm/shared/schemas/warmIntroPathSchema.js';

const IS_E2E = process.env.E2E === 'true';

/** Maximum candidate paths returned, per the ticket's "ranked order" AC. */
const MAX_PATHS = 5;
/** Signals older than this no longer contribute to relationship strength, mirroring
 * championBlockerService's SIGNAL_DECAY_DAYS convention. */
const ACTIVITY_DECAY_DAYS = 180;

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
}

interface CandidateLinkRow {
  known_contact_id: string;
  known_first_name: string;
  known_last_name: string;
  known_title: string | null;
  link_reason: 'same_account' | 'account_hierarchy' | 'shared_deal' | 'notes_mention';
  /** Number of activities the rep has logged with the known contact, decay-windowed. */
  rep_activity_count: number;
  rep_last_activity_at: Date | null;
}

/**
 * Scores relationship strength for one hop: recency-weighted activity frequency,
 * normalized to 0-1. Mirrors championBlockerService's confidence-from-count shape.
 */
function computeHopStrength(activityCount: number, lastActivityAt: Date | null): number {
  if (activityCount === 0) return 0;
  const recencyFactor = lastActivityAt
    ? Math.max(
        0,
        1 - (Date.now() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24 * ACTIVITY_DECAY_DAYS),
      )
    : 0;
  const frequencyFactor = Math.min(1, activityCount / 5);
  return Math.round(((recencyFactor + frequencyFactor) / 2) * 100) / 100;
}

/** Per-link-reason base weight — direct account overlap is the strongest, in-notes
 * mentions the weakest since it's a best-effort keyword match. */
const LINK_REASON_WEIGHT: Record<CandidateLinkRow['link_reason'], number> = {
  same_account: 1,
  shared_deal: 0.85,
  account_hierarchy: 0.7,
  notes_mention: 0.3,
};

async function findCandidateLinks(
  requestingUserId: string,
  requestingUserRole: string,
  targetContactId: string,
  targetAccountId: string | null,
  targetFirstName: string,
  targetLastName: string,
): Promise<CandidateLinkRow[]> {
  // Values built incrementally so parameter positions stay correct regardless of how
  // many params buildVisibilityFilter contributes (zero for admin/viewer, one or more
  // for reps/managers) — a fixed offset here previously caused "could not determine
  // data type of parameter" errors whenever the visibility param count didn't match
  // the hardcoded assumption.
  const values: unknown[] = [requestingUserId, targetAccountId, targetContactId];
  const visFilter = await buildVisibilityFilter(
    'contact',
    requestingUserId,
    requestingUserRole,
    'c.owner_id',
    values.length + 1,
  );
  values.push(...visFilter.params);
  const visClause = visFilter.clause ? `AND ${visFilter.clause}` : '';

  // Candidates: contacts the rep has actually engaged with (owns, or has logged
  // activity against), excluding the target itself. Same-account/hierarchy/shared-deal
  // links are computed directly in SQL; notes-mention is a separate best-effort pass
  // that needs the target's name as a search term. The two queries are independent
  // (notes-mention resolves its own buildVisibilityFilter call internally), so they
  // run concurrently rather than paying both DB round trips back-to-back.
  const [result, notesMentionCandidates] = await Promise.all([
    withRlsQuery((client) =>
      client.query<CandidateLinkRow>(
        `WITH rep_activity AS (
         SELECT contact_id, COUNT(*) AS activity_count, MAX(created_at) AS last_activity_at
         FROM activities
         WHERE owner_id = $1 AND contact_id IS NOT NULL
         GROUP BY contact_id
       )
       SELECT DISTINCT ON (c.id)
         c.id AS known_contact_id,
         c.first_name AS known_first_name,
         c.last_name AS known_last_name,
         c.title AS known_title,
         CASE
           WHEN c.account_id = $2::uuid THEN 'same_account'
           WHEN c.account_id IN (
             SELECT id FROM accounts WHERE parent_account_id = $2::uuid
             UNION
             SELECT parent_account_id FROM accounts WHERE id = $2::uuid AND parent_account_id IS NOT NULL
           ) THEN 'account_hierarchy'
           ELSE 'shared_deal'
         END AS link_reason,
         COALESCE(ra.activity_count, 0) AS rep_activity_count,
         ra.last_activity_at AS rep_last_activity_at
       FROM contacts c
       LEFT JOIN rep_activity ra ON ra.contact_id = c.id
       WHERE c.id != $3
         AND (c.owner_id = $1 OR ra.contact_id IS NOT NULL)
         ${visClause}
         AND (
           c.account_id = $2::uuid
           OR c.account_id IN (
             SELECT id FROM accounts WHERE parent_account_id = $2::uuid
             UNION
             SELECT parent_account_id FROM accounts WHERE id = $2::uuid AND parent_account_id IS NOT NULL
           )
           OR c.id IN (
             SELECT dc2.contact_id
             FROM deal_contacts dc1
             JOIN deal_contacts dc2 ON dc2.deal_id = dc1.deal_id AND dc2.contact_id != dc1.contact_id
             WHERE dc1.contact_id = $3
           )
         )
       ORDER BY c.id, rep_activity_count DESC
       LIMIT 50`,
        values,
      ),
    ),
    findNotesMentionCandidates(
      requestingUserId,
      requestingUserRole,
      targetContactId,
      targetFirstName,
      targetLastName,
    ),
  ]);

  const seen = new Set(result.rows.map((r) => r.known_contact_id));
  const merged = [...result.rows];
  for (const candidate of notesMentionCandidates) {
    if (!seen.has(candidate.known_contact_id)) {
      merged.push(candidate);
      seen.add(candidate.known_contact_id);
    }
  }
  return merged;
}

/**
 * Best-effort: contacts the rep has engaged with whose notes mention the target
 * contact's name. Not real NLP entity extraction — a literal substring match,
 * which can both miss real mentions (nicknames, misspellings) and false-positive
 * on common names. Documented limitation, per the ticket's traversal-source list.
 */
async function findNotesMentionCandidates(
  requestingUserId: string,
  requestingUserRole: string,
  targetContactId: string,
  targetFirstName: string,
  targetLastName: string,
): Promise<CandidateLinkRow[]> {
  if (!targetFirstName || !targetLastName) return [];
  const fullName = `${targetFirstName} ${targetLastName}`;

  // A notes-mention candidate must still be someone the rep has actually engaged with —
  // otherwise "Rep -> Known Contact" isn't a real hop. rep_activity_count/last_activity_at
  // feed the same computeHopStrength() as the other link reasons (a candidate with zero
  // engagement is filtered out by the pathStrength > 0 check in the caller).
  const values: unknown[] = [`%${fullName}%`, requestingUserId, targetContactId];
  const visFilter = await buildVisibilityFilter(
    'contact',
    requestingUserId,
    requestingUserRole,
    'c.owner_id',
    values.length + 1,
  );
  values.push(...visFilter.params);
  const visClause = visFilter.clause ? `AND ${visFilter.clause}` : '';

  const result = await withRlsQuery((client) =>
    client.query<CandidateLinkRow>(
      `WITH rep_activity AS (
         SELECT contact_id, COUNT(*) AS activity_count, MAX(created_at) AS last_activity_at
         FROM activities
         WHERE owner_id = $2 AND contact_id IS NOT NULL
         GROUP BY contact_id
       )
       SELECT DISTINCT ON (c.id)
         c.id AS known_contact_id,
         c.first_name AS known_first_name,
         c.last_name AS known_last_name,
         c.title AS known_title,
         'notes_mention' AS link_reason,
         COALESCE(ra.activity_count, 0) AS rep_activity_count,
         ra.last_activity_at AS rep_last_activity_at
       FROM notes n
       JOIN contacts c ON c.id = n.entity_id AND n.entity_type = 'contact'
       LEFT JOIN rep_activity ra ON ra.contact_id = c.id
       WHERE n.deleted_at IS NULL
         AND c.id != $3
         AND n.body_text ILIKE $1
         AND (c.owner_id = $2 OR ra.contact_id IS NOT NULL)
         ${visClause}
       LIMIT 20`,
      values,
    ),
  );
  return result.rows;
}

const INTRO_MESSAGE_TOOL_NAME = 'report_intro_message';

const INTRO_MESSAGE_TOOL: Anthropic.Messages.Tool = {
  name: INTRO_MESSAGE_TOOL_NAME,
  description:
    'Reports a short, warm introduction message a rep can send to an intermediary contact.',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          '2-4 sentence message the rep can send to the known contact, asking for an introduction to the target contact.',
      },
    },
    required: ['message'],
  },
};

function buildIntroSystemPrompt(): string {
  return (
    'You write a short, warm message a sales rep can send to a contact they know, asking that ' +
    'contact to introduce them to a target contact. Keep it natural and low-pressure — the ' +
    'intermediary should feel comfortable declining. Call the report_intro_message tool exactly once.'
  );
}

/** Generates the suggested introduction message for one path. Falls back to a
 * generic template on any AI failure — a missing message must never fail the request. */
async function generateIntroMessage(
  anthropicClient: Anthropic | null,
  model: string | null,
  knownContactName: string,
  targetContactName: string,
  targetCompany: string | null,
): Promise<string> {
  const fallback = `Hi! Would you be open to introducing me to ${targetContactName}${targetCompany ? ` at ${targetCompany}` : ''}? No pressure if now isn't a good time.`;

  if (IS_E2E || !anthropicClient || !model) return fallback;

  try {
    const { sanitised } = await applyPiiFilter(
      {
        known_contact_name: knownContactName,
        target_contact_name: targetContactName,
        target_company: targetCompany,
      },
      'contact',
    );
    const response = await anthropicClient.messages.create({
      model,
      max_tokens: 256,
      system: buildIntroSystemPrompt(),
      tools: [INTRO_MESSAGE_TOOL],
      tool_choice: { type: 'tool', name: INTRO_MESSAGE_TOOL_NAME },
      messages: [{ role: 'user', content: JSON.stringify(sanitised) }],
    });
    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === 'tool_use' && block.name === INTRO_MESSAGE_TOOL_NAME,
    );
    const input = toolUseBlock?.input as { message: string } | undefined;
    return input?.message ?? fallback;
  } catch (err) {
    logger.warn({ err }, 'Warm intro: message generation failed — using fallback template');
    return fallback;
  }
}

/**
 * Finds ranked warm introduction paths (Rep -> Known Contact -> Target Contact,
 * capped at 2 hops) for the given target contact. Returns an empty paths array
 * when no path exists — never fabricates weak connections.
 */
export async function findWarmIntroPaths(
  targetContactId: string,
  requestingUserId: string,
  requestingUserRole: string,
): Promise<WarmIntroPathResponse | null> {
  const target = await findContactById(targetContactId);
  if (!target) return null;

  const targetAccount = target.account_id ? await findAccountById(target.account_id) : null;

  const candidates = await findCandidateLinks(
    requestingUserId,
    requestingUserRole,
    targetContactId,
    target.account_id,
    target.first_name,
    target.last_name,
  );

  const ranked = candidates
    .map((candidate) => {
      const hopStrength = computeHopStrength(
        candidate.rep_activity_count,
        candidate.rep_last_activity_at,
      );
      const pathStrength = Math.min(hopStrength, LINK_REASON_WEIGHT[candidate.link_reason]);
      return { candidate, pathStrength };
    })
    // A known contact the rep has never actually engaged with is not a real path —
    // hopStrength of 0 means "Rep -> Known Contact" itself doesn't exist yet.
    .filter(({ pathStrength }) => pathStrength > 0)
    .sort((a, b) => b.pathStrength - a.pathStrength)
    .slice(0, MAX_PATHS);

  if (ranked.length === 0) {
    return { target_contact_id: targetContactId, paths: [] };
  }

  let anthropicClient: Anthropic | null = null;
  let model: string | null = null;
  if (!IS_E2E) {
    const configResult = await pool.query<AiConfigRow>(
      `SELECT model, api_key_encrypted, api_key_key_version, base_url, enabled FROM ai_configuration LIMIT 1`,
    );
    const row = configResult.rows[0];
    if (row?.enabled && row.api_key_encrypted?.trim()) {
      try {
        const apiKey = decryptVersioned(row.api_key_encrypted, row.api_key_key_version ?? 1);
        const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
        if (row.base_url?.trim()) clientOptions.baseURL = row.base_url;
        anthropicClient = new Anthropic(clientOptions);
        model = row.model;
      } catch (err) {
        logger.warn(
          { err },
          'Warm intro: could not decrypt AI key — using fallback message template',
        );
      }
    }
  }

  const paths: WarmIntroPath[] = await Promise.all(
    ranked.map(async ({ candidate, pathStrength }) => {
      const knownName = `${candidate.known_first_name} ${candidate.known_last_name}`;
      const targetName = `${target.first_name} ${target.last_name}`;
      const message = await generateIntroMessage(
        anthropicClient,
        model,
        knownName,
        targetName,
        targetAccount?.name ?? null,
      );
      return {
        links: [
          {
            contact_id: candidate.known_contact_id,
            first_name: candidate.known_first_name,
            last_name: candidate.known_last_name,
            title: candidate.known_title,
            relationship_strength: computeHopStrength(
              candidate.rep_activity_count,
              candidate.rep_last_activity_at,
            ),
          },
          {
            contact_id: target.id,
            first_name: target.first_name,
            last_name: target.last_name,
            title: target.title,
            relationship_strength: LINK_REASON_WEIGHT[candidate.link_reason],
          },
        ],
        path_strength: pathStrength,
        suggested_introduction_message: message,
      };
    }),
  );

  return { target_contact_id: targetContactId, paths };
}
