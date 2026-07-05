/**
 * Contact auto-enrich service — on-demand AI extraction of contact fields
 * from pasted freeform text (LinkedIn bio, email signature, vCard, business
 * card text). (MINCRM-439)
 *
 * Follows the same "gather context, PII-filter, forced-tool Claude call,
 * record token usage" shape as dealHealthService.generateDealHealthCheck.
 * Not persisted — the raw pasted text is never stored; only the extracted
 * fields (previewed and editable by the user) may end up saved, and only
 * when the user explicitly submits the contact create form.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { withRlsQuery } from './rlsContextService.js';
import type {
  ContactEnrichmentFields,
  ContactEnrichmentResponse,
} from '@minicrm/shared/schemas/contactEnrichmentSchema.js';

const IS_E2E = process.env.E2E === 'true';
const AI_USAGE_FEATURE_LABEL = 'contact_enrichment';

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
const E2E_STUB_FIELDS: ContactEnrichmentFields = {
  first_name: '[E2E stub] Jane',
  last_name: '[E2E stub] Doe',
  title: 'VP Sales',
  company_name: null,
  email: null,
  phone: null,
  linkedin_url: null,
  location: null,
};

const ENRICHMENT_TOOL_NAME = 'report_contact_enrichment';

/** Tool-forced structured output so the response never needs free-text JSON parsing. */
const ENRICHMENT_TOOL: Anthropic.Messages.Tool = {
  name: ENRICHMENT_TOOL_NAME,
  description: 'Reports contact fields extracted from pasted freeform text.',
  input_schema: {
    type: 'object',
    properties: {
      first_name: { type: ['string', 'null'] },
      last_name: { type: ['string', 'null'] },
      title: { type: ['string', 'null'] },
      company_name: { type: ['string', 'null'] },
      email: { type: ['string', 'null'] },
      phone: { type: ['string', 'null'] },
      linkedin_url: { type: ['string', 'null'] },
      location: { type: ['string', 'null'] },
      insufficient_data: {
        type: 'boolean',
        description:
          'True when the text did not contain enough information to extract anything useful.',
      },
    },
    required: [
      'first_name',
      'last_name',
      'title',
      'company_name',
      'email',
      'phone',
      'linkedin_url',
      'location',
      'insufficient_data',
    ],
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
    `You are a CRM data-entry assistant extracting contact fields from pasted freeform text ` +
    `(a LinkedIn bio, email signature, vCard, or business card text). Extract only what is ` +
    `explicitly present: first name, last name, job title, company name, email, phone, ` +
    `LinkedIn URL, and location. Never invent or guess a value that is not present in the ` +
    `text — leave a field null if it cannot be found. Set insufficient_data to true if the ` +
    `text yields no usable fields at all. Call the ${ENRICHMENT_TOOL_NAME} tool exactly once ` +
    `with your result.`
  );
}

/** Finds an existing account by exact, case-insensitive name match. */
async function findAccountByExactName(name: string): Promise<{ id: string } | null> {
  const result = await withRlsQuery((client) =>
    client.query<{ id: string }>('SELECT id FROM accounts WHERE lower(name) = lower($1) LIMIT 1', [
      name,
    ]),
  );
  return result.rows[0] ?? null;
}

/**
 * Runs an on-demand AI extraction of contact fields from pasted text. Throws
 * a tagged error (statusCode 502/503) when AI is unavailable or misconfigured.
 */
export async function enrichContactFromText(
  rawText: string,
  userId: string,
): Promise<ContactEnrichmentResponse> {
  // IS_E2E must short-circuit before the ai_configuration.enabled check —
  // reset-e2e-data.ts always sets enabled=false in the E2E database, so
  // checking it first would 503 every E2E run before reaching the stub.
  if (IS_E2E) {
    return { fields: E2E_STUB_FIELDS, matched_account_id: null, insufficient_data: false };
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

  // The raw pasted text is user-authored freeform content, not a CRM record with named
  // fields — applyPiiFilter's field-name exclusion set does not apply to it. Defense in
  // depth is still run for consistency with every other AI call site. (MINCRM-445)
  const { sanitised, strippedFields } = await applyPiiFilter({ raw_text: rawText }, 'contact');
  if (strippedFields.length > 0) {
    logger.info(
      { strippedFields },
      'Contact enrichment: fields stripped from AI payload (MINCRM-445)',
    );
  }

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropicClient.messages.create({
      model: row.model,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools: [ENRICHMENT_TOOL],
      tool_choice: { type: 'tool', name: ENRICHMENT_TOOL_NAME },
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
      block.type === 'tool_use' && block.name === ENRICHMENT_TOOL_NAME,
  );
  if (!toolUseBlock) {
    throw Object.assign(new Error('AI provider did not return contact enrichment fields'), {
      statusCode: 502,
    });
  }

  const input = toolUseBlock.input as ContactEnrichmentFields & { insufficient_data: boolean };

  const matchedAccount = input.company_name
    ? await findAccountByExactName(input.company_name)
    : null;

  return {
    fields: {
      first_name: input.first_name,
      last_name: input.last_name,
      title: input.title,
      company_name: input.company_name,
      email: input.email,
      phone: input.phone,
      linkedin_url: input.linkedin_url,
      location: input.location,
    },
    matched_account_id: matchedAccount?.id ?? null,
    insufficient_data: input.insufficient_data,
  };
}
