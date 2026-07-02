/**
 * Proposal draft generation service — on-demand AI drafting of a first-pass
 * proposal document from a deal's context. (MINCRM-473)
 *
 * Gathers deal facts, account name, contact names/titles, linked notes,
 * recent activity, and non-PII-excluded custom fields; strips PII via
 * applyPiiFilter; asks Claude to draft the 6 sections via a tool-forced call.
 * Not persisted — the rep must explicitly export or dismiss, per the
 * ticket's AC. High-token operation: callers must gate on requireAiTokenBudget
 * at the route layer before invoking this. Follows the same shape as
 * dealHealthService.generateDealHealthCheck (the on-demand-generation template).
 */

import Anthropic from '@anthropic-ai/sdk';
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell } from 'docx';
import pool from '../db.js';
import logger from '../logger.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import { applyPiiFilter } from '../ai/piiFilter.js';
import { findDealById } from './dealService.js';
import { findAccountById } from './accountService.js';
import { getValuesForRecord } from './customFieldService.js';
import { withRlsQuery } from './rlsContextService.js';
import type {
  GenerateProposalDraftResponse,
  ProposalDraft,
  ProposalPricingLineItem,
} from '@minicrm/shared/schemas/proposalDraftSchema.js';

const IS_E2E = process.env.E2E === 'true';

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
function buildE2eStubResponse(
  dealValue: string | null,
  currency: string,
): GenerateProposalDraftResponse {
  return {
    draft: {
      executive_summary: '[E2E stub] Executive summary of the proposed engagement.',
      problem_statement: '[E2E stub] Problem statement derived from deal context.',
      proposed_solution: '[E2E stub] Proposed solution — [rep to fill in specifics].',
      pricing_line_items: [
        { description: '[E2E stub] Core package', amount: parseFloat(dealValue ?? '0') },
      ],
      pricing_currency: currency,
      next_steps: '[E2E stub] Next steps derived from current stage.',
      prepared_for: '[E2E stub] Prepared for.',
      prepared_by: '[E2E stub] Prepared by.',
    },
  };
}

const PROPOSAL_TOOL_NAME = 'draft_proposal';

/** Tool-forced structured output so the response never needs free-text JSON parsing. */
const PROPOSAL_TOOL: Anthropic.Messages.Tool = {
  name: PROPOSAL_TOOL_NAME,
  description: 'Reports a drafted sales proposal for a CRM deal.',
  input_schema: {
    type: 'object',
    properties: {
      executive_summary: {
        type: 'string',
        description: '2-3 sentence executive summary tailored to the account and use case.',
      },
      problem_statement: {
        type: 'string',
        description: 'Problem statement derived from the notes and deal context.',
      },
      proposed_solution: {
        type: 'string',
        description:
          'Proposed solution section. Mark clearly, e.g. with [rep to fill in], where the rep should add specifics not present in the gathered context.',
      },
      pricing_line_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            amount: { type: 'number' },
          },
          required: ['description', 'amount'],
        },
        description:
          'Editable pricing line items. Should sum to approximately the deal value when a single package is proposed.',
      },
      next_steps: {
        type: 'string',
        description: 'Next steps derived from the current stage and any open tasks.',
      },
      prepared_for: {
        type: 'string',
        description: 'Contact name(s) and title(s) this proposal is prepared for.',
      },
    },
    required: [
      'executive_summary',
      'problem_statement',
      'proposed_solution',
      'pricing_line_items',
      'next_steps',
      'prepared_for',
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

interface ProposalDraftContext {
  deal_name: string;
  account_name: string | null;
  deal_value: string | null;
  currency: string;
  stage: string;
  contacts: Array<{ name: string; title: string | null }>;
  notes: string[];
  recent_activity_summary: Array<{ type: string; subject: string; notes: string | null }>;
  open_tasks_count: number;
  custom_fields: Array<{ name: string; value: unknown }>;
}

/**
 * Gathers the deal context required to draft a proposal: deal facts, account
 * name, linked contacts (name + title), linked notes, a recent-activity
 * summary, open task count, and non-PII-excluded custom fields. Returns null
 * when the deal does not exist so the controller can return 404.
 */
async function gatherProposalContext(dealId: string): Promise<ProposalDraftContext | null> {
  const deal = await findDealById(dealId);
  if (!deal) return null;

  const [account, contactsResult, notesResult, activitiesResult, openTasksResult, customFields] =
    await Promise.all([
      deal.account_id ? findAccountById(deal.account_id) : Promise.resolve(null),
      withRlsQuery((client) =>
        client.query<{ first_name: string; last_name: string; title: string | null }>(
          `SELECT c.first_name, c.last_name, c.title
           FROM deal_contacts dc
           INNER JOIN contacts c ON c.id = dc.contact_id
           WHERE dc.deal_id = $1`,
          [dealId],
        ),
      ),
      withRlsQuery((client) =>
        client.query<{ body_text: string | null }>(
          `SELECT body_text FROM notes
           WHERE entity_type = 'deal' AND entity_id = $1 AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 10`,
          [dealId],
        ),
      ),
      withRlsQuery((client) =>
        client.query<{ type: string; subject: string; notes: string | null }>(
          `SELECT type, subject, notes FROM activities
           WHERE deal_id = $1 ORDER BY created_at DESC LIMIT 5`,
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
      getValuesForRecord(dealId),
    ]);

  return {
    deal_name: deal.name,
    account_name: account?.name ?? null,
    deal_value: deal.value,
    currency: deal.currency,
    stage: deal.stage,
    contacts: contactsResult.rows.map((row) => ({
      name: `${row.first_name} ${row.last_name}`,
      title: row.title,
    })),
    notes: notesResult.rows
      .map((row) => row.body_text)
      .filter((text): text is string => Boolean(text)),
    recent_activity_summary: activitiesResult.rows,
    open_tasks_count: parseInt(openTasksResult.rows[0]?.count ?? '0', 10),
    custom_fields: customFields
      .filter((field) => field.definition.entity_type === 'deal' && !field.definition.pii_excluded)
      .map((field) => ({ name: field.definition.name, value: field.value })),
  };
}

function buildSystemPrompt(focusNotes?: string): string {
  const base =
    "You are a CRM sales assistant drafting a first-pass proposal document from a deal's context. " +
    'Given the deal facts, account name, contacts, linked notes, recent activity, and custom fields, ' +
    'draft: an executive summary tailored to the account and use case; a problem statement derived ' +
    'from the notes and context; a proposed solution (clearly marking placeholders like ' +
    '[rep to fill in] where specifics are not present in the given context — never invent product ' +
    'details not implied by the data); pricing line items that sum to approximately the deal value; ' +
    'next steps derived from the current stage and open tasks; and who the proposal is prepared for ' +
    '(contact name and title). Call the draft_proposal tool exactly once.';
  if (!focusNotes) return base;
  return `${base} The rep has asked you to focus this draft on: ${focusNotes}`;
}

/**
 * Generates an on-demand AI proposal draft for a deal. Returns null when the
 * deal does not exist. Not persisted — the rep must explicitly export or
 * dismiss, per the ticket's AC. Pass focusNotes to regenerate with a
 * different emphasis (e.g. "focus more on ROI").
 *
 * Ownership (deal.owner_id === caller, or admin) is enforced by the caller —
 * this service does not re-check it, matching dealHealthService/
 * stageAdvancementService. Any new call site (NLI tool, scheduled job) must
 * duplicate the controller's ownership check before calling this.
 */
export async function generateProposalDraft(
  dealId: string,
  userId: string,
  userName: string,
  focusNotes?: string,
): Promise<GenerateProposalDraftResponse | null> {
  const context = await gatherProposalContext(dealId);
  if (!context) return null;

  // IS_E2E must short-circuit before the ai_configuration.enabled check —
  // reset-e2e-data.ts always sets enabled=false in the E2E database, so
  // checking it first would 503 every E2E run before reaching the stub.
  if (IS_E2E) {
    return buildE2eStubResponse(context.deal_value, context.currency);
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
  const { sanitised, strippedFields } = await applyPiiFilter(context, 'deal');
  if (strippedFields.length > 0) {
    logger.info(
      { dealId, strippedFields },
      'Proposal draft: fields stripped from AI payload (MINCRM-445)',
    );
  }

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropicClient.messages.create({
      model: row.model,
      max_tokens: 2048,
      system: buildSystemPrompt(focusNotes),
      tools: [PROPOSAL_TOOL],
      tool_choice: { type: 'tool', name: PROPOSAL_TOOL_NAME },
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

  // High-token operation — cost logged against the rep's budget. (MINCRM-458)
  recordTokenUsage(
    userId,
    response.usage.input_tokens,
    response.usage.output_tokens,
    'proposal_draft',
  );

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === 'tool_use' && block.name === PROPOSAL_TOOL_NAME,
  );
  if (!toolUseBlock) {
    throw Object.assign(new Error('AI provider did not return a proposal draft'), {
      statusCode: 502,
    });
  }

  const input = toolUseBlock.input as {
    executive_summary: string;
    problem_statement: string;
    proposed_solution: string;
    pricing_line_items: ProposalPricingLineItem[];
    next_steps: string;
    prepared_for: string;
  };

  const draft: ProposalDraft = {
    executive_summary: input.executive_summary,
    problem_statement: input.problem_statement,
    proposed_solution: input.proposed_solution,
    pricing_line_items: input.pricing_line_items,
    pricing_currency: context.currency,
    next_steps: input.next_steps,
    prepared_for: input.prepared_for,
    prepared_by: userName,
  };

  return { draft };
}

/**
 * Strips characters that are unsafe inside an HTTP Content-Disposition
 * filename (quotes, backslashes, and control characters including CR/LF)
 * from a user-controlled deal name. Deal names are free text with no
 * character restrictions at the schema level (shared/schemas/dealSchema.ts),
 * so this must run on every use of a deal name in a response header.
 */
function sanitizeForFilename(name: string): string {
  return name.replace(/["\\\x00-\x1f]/g, '').trim() || 'proposal';
}

/** Returns the safe filename (no extension) to use when exporting a deal's proposal draft. */
export function buildProposalDraftFilenameBase(dealName: string): string {
  return `proposal-${sanitizeForFilename(dealName)}`;
}

/** Builds the DOCX document for a proposal draft, ready for Packer.toBuffer(). */
export function buildProposalDraftDocxDocument(draft: ProposalDraft, dealName: string): Document {
  return new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: `Proposal: ${dealName}`, heading: HeadingLevel.TITLE }),
          new Paragraph({ text: `Prepared for: ${draft.prepared_for}` }),
          new Paragraph({ text: `Prepared by: ${draft.prepared_by}` }),
          new Paragraph({ text: 'Executive Summary', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: draft.executive_summary }),
          new Paragraph({ text: 'Problem Statement', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: draft.problem_statement }),
          new Paragraph({ text: 'Proposed Solution', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: draft.proposed_solution }),
          new Paragraph({ text: 'Proposed Investment', heading: HeadingLevel.HEADING_1 }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: 'Description' })] }),
                  new TableCell({ children: [new Paragraph({ text: 'Amount' })] }),
                ],
              }),
              ...draft.pricing_line_items.map(
                (item) =>
                  new TableRow({
                    children: [
                      new TableCell({ children: [new Paragraph({ text: item.description })] }),
                      new TableCell({
                        children: [
                          new Paragraph({
                            text: `${draft.pricing_currency} ${item.amount.toFixed(2)}`,
                          }),
                        ],
                      }),
                    ],
                  }),
              ),
            ],
          }),
          new Paragraph({ text: 'Next Steps', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: draft.next_steps }),
        ],
      },
    ],
  });
}

/** Generates the DOCX file bytes for an (possibly rep-edited) proposal draft. */
export async function exportProposalDraftDocx(
  draft: ProposalDraft,
  dealName: string,
): Promise<Buffer> {
  const document = buildProposalDraftDocxDocument(draft, dealName);
  return Packer.toBuffer(document);
}
