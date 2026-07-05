/**
 * Email draft generation service — on-demand AI first-draft follow-up email
 * from a contact's context and recent activity. (MINCRM-437)
 *
 * Follows the same "gather context, PII-filter, forced-tool Claude call,
 * record token usage" shape as dealHealthService.generateDealHealthCheck.
 * Not persisted — the draft is only kept if the user copies it; regenerated
 * on every call, including tone changes.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { findContactById } from './contactService.js';
import { withRlsQuery } from './rlsContextService.js';
import type {
  EmailDraftResponse,
  EmailDraftTone,
} from '@minicrm/shared/schemas/emailDraftSchema.js';

const IS_E2E = process.env.E2E === 'true';
const AI_USAGE_FEATURE_LABEL = 'email_draft';

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
function e2eStubResponse(tone: EmailDraftTone): EmailDraftResponse {
  return {
    subject: '[E2E stub] Following up',
    body: '[E2E stub] Hi there, following up on our last conversation. Let me know if you have any questions.',
    tone,
    generated_at: new Date(0).toISOString(),
  };
}

const EMAIL_DRAFT_TOOL_NAME = 'report_email_draft';

/** Tool-forced structured output so the response never needs free-text JSON parsing. */
const EMAIL_DRAFT_TOOL: Anthropic.Messages.Tool = {
  name: EMAIL_DRAFT_TOOL_NAME,
  description: 'Reports a drafted follow-up email for a CRM contact.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Email subject line.' },
      body: { type: 'string', description: 'Email body text.' },
    },
    required: ['subject', 'body'],
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
  created_at: Date;
}

/**
 * Facts about a contact gathered for the email draft prompt.
 */
interface EmailDraftContext {
  first_name: string;
  last_name: string;
  title: string | null;
  company_name: string | null;
  last_interaction_date: string | null;
  recent_activity_summary: string | null;
  open_opportunities: string[];
}

async function gatherEmailDraftContext(contactId: string): Promise<EmailDraftContext | null> {
  const contact = await findContactById(contactId);
  if (!contact) return null;

  const [accountResult, recentActivitiesResult, openDealsResult] = await Promise.all([
    contact.account_id
      ? withRlsQuery((client) =>
          client.query<{ name: string }>('SELECT name FROM accounts WHERE id = $1', [
            contact.account_id,
          ]),
        )
      : Promise.resolve({ rows: [] as { name: string }[] }),
    withRlsQuery((client) =>
      client.query<RecentActivityRow>(
        `SELECT type, subject, notes, created_at
         FROM activities
         WHERE contact_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [contactId],
      ),
    ),
    withRlsQuery((client) =>
      client.query<{ name: string }>(
        `SELECT d.name
         FROM deals d
         INNER JOIN deal_contacts dc ON dc.deal_id = d.id
         WHERE dc.contact_id = $1
           AND d.pipeline_stage_id NOT IN (
             SELECT id FROM pipeline_stages
             WHERE pipeline_id = d.pipeline_id AND is_terminal = true
           )
         ORDER BY d.created_at ASC`,
        [contactId],
      ),
    ),
  ]);

  const recentActivities = recentActivitiesResult.rows;

  return {
    first_name: contact.first_name,
    last_name: contact.last_name,
    title: contact.title,
    company_name: accountResult.rows[0]?.name ?? null,
    last_interaction_date: recentActivities[0]?.created_at.toISOString().slice(0, 10) ?? null,
    recent_activity_summary:
      recentActivities.length > 0
        ? recentActivities
            .map((a) => `${a.type}: ${a.subject}${a.notes ? ` — ${a.notes}` : ''}`)
            .join('; ')
        : null,
    open_opportunities: openDealsResult.rows.map((deal) => deal.name),
  };
}

function buildSystemPrompt(tone: EmailDraftTone): string {
  return (
    `You are a CRM sales assistant drafting a first-draft follow-up email to a contact, in a ` +
    `${tone.toLowerCase()} tone. You are given the contact's name, title, company, most recent ` +
    `interaction date, a summary of recent activity, and any open opportunities. If no recent ` +
    `activity is present, write a fallback introduction using only the contact's fields. Write a ` +
    `subject line and a body. Do not invent facts not present in the provided context. Call the ` +
    `${EMAIL_DRAFT_TOOL_NAME} tool exactly once with your draft.`
  );
}

/**
 * Runs an on-demand AI email draft generation for a contact. Returns null
 * when the contact does not exist. Throws a tagged error (statusCode
 * 502/503) when AI is unavailable or misconfigured.
 */
export async function generateEmailDraft(
  contactId: string,
  tone: EmailDraftTone,
  userId: string,
): Promise<EmailDraftResponse | null> {
  const context = await gatherEmailDraftContext(contactId);
  if (!context) return null;

  // IS_E2E must short-circuit before the ai_configuration.enabled check —
  // reset-e2e-data.ts always sets enabled=false in the E2E database, so
  // checking it first would 503 every E2E run before reaching the stub.
  if (IS_E2E) {
    return e2eStubResponse(tone);
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
  const { sanitised, strippedFields } = await applyPiiFilter(context, 'contact');
  if (strippedFields.length > 0) {
    logger.info(
      { contactId, strippedFields },
      'Email draft: fields stripped from AI payload (MINCRM-445)',
    );
  }

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropicClient.messages.create({
      model: row.model,
      max_tokens: 1024,
      system: buildSystemPrompt(tone),
      tools: [EMAIL_DRAFT_TOOL],
      tool_choice: { type: 'tool', name: EMAIL_DRAFT_TOOL_NAME },
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
      block.type === 'tool_use' && block.name === EMAIL_DRAFT_TOOL_NAME,
  );
  if (!toolUseBlock) {
    throw Object.assign(new Error('AI provider did not return an email draft'), {
      statusCode: 502,
    });
  }

  const input = toolUseBlock.input as { subject: string; body: string };

  return {
    subject: input.subject,
    body: input.body,
    tone,
    generated_at: new Date().toISOString(),
  };
}
