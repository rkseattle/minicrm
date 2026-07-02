/**
 * Integration tests for proposalDraftService. (MINCRM-473)
 *
 * Runs against a real PostgreSQL test database. The Anthropic SDK is mocked
 * so no real API calls are made.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import { vi } from 'vitest';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  class AuthenticationError extends Error {}
  class APIConnectionError extends Error {}
  class APIError extends Error {}
  return {
    default: Object.assign(MockAnthropic, { AuthenticationError, APIConnectionError, APIError }),
  };
});

import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createDeal } from '../services/dealService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import { generateProposalDraft } from '../services/proposalDraftService.js';
import { encryptVersioned } from '../services/cryptoService.js';

const FILE_PREFIX = 'proposal-draft-svc';

let ownerId: string;
let defaultPipelineId: string;
let accountId: string;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM notes WHERE entity_type = 'deal' AND entity_id IN
       (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
}

beforeAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Proposal Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  ownerId = owner.id;
  defaultPipelineId = await getDefaultPipelineId();

  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
    [`Proposal Test Account`, ownerId],
  );
  accountId = accountResult.rows[0].id;
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration
     SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2,
         model = 'claude-sonnet-4-20250514'`,
    [ciphertext, keyVersion],
  );
});

afterAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

async function createTestDeal(): Promise<string> {
  const deal = await createDeal(
    {
      name: `Proposal Deal ${Date.now()}-${Math.random()}`,
      stage: 'Proposal',
      pipeline_id: defaultPipelineId,
      owner_id: ownerId,
      account_id: accountId,
      value: 25000,
    },
    { id: ownerId, name: 'Proposal Owner' },
  );
  return deal.id;
}

describe('generateProposalDraft', () => {
  it('returns null for a non-existent deal', async () => {
    const result = await generateProposalDraft(
      '00000000-0000-0000-0000-000000000000',
      ownerId,
      'Proposal Owner',
    );
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('throws when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);
    const dealId = await createTestDeal();

    await expect(generateProposalDraft(dealId, ownerId, 'Proposal Owner')).rejects.toThrow(
      'AI features are not enabled',
    );
  });

  it('generates a draft with the deal value reflected and the rep as prepared_by', async () => {
    const dealId = await createTestDeal();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [
        {
          type: 'tool_use',
          name: 'draft_proposal',
          input: {
            executive_summary: 'Tailored summary.',
            problem_statement: 'Problem derived from notes.',
            proposed_solution: 'Solution — [rep to fill in specifics].',
            pricing_line_items: [{ description: 'Core package', amount: 25000 }],
            next_steps: 'Schedule a follow-up call.',
            prepared_for: 'Jane Doe, VP Sales',
          },
        },
      ],
    });

    const result = await generateProposalDraft(dealId, ownerId, 'Proposal Owner');

    expect(result).not.toBeNull();
    expect(result?.draft.executive_summary).toBe('Tailored summary.');
    expect(result?.draft.pricing_line_items).toEqual([
      { description: 'Core package', amount: 25000 },
    ]);
    expect(result?.draft.pricing_currency).toBe('USD');
    expect(result?.draft.prepared_by).toBe('Proposal Owner');
  });

  it('passes focus notes into the system prompt for regeneration', async () => {
    const dealId = await createTestDeal();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [
        {
          type: 'tool_use',
          name: 'draft_proposal',
          input: {
            executive_summary: 'ROI-focused summary.',
            problem_statement: 'Problem.',
            proposed_solution: 'Solution.',
            pricing_line_items: [{ description: 'Core package', amount: 25000 }],
            next_steps: 'Next steps.',
            prepared_for: 'Jane Doe',
          },
        },
      ],
    });

    await generateProposalDraft(dealId, ownerId, 'Proposal Owner', 'Focus more on ROI');

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toContain('Focus more on ROI');
  });

  it('records token usage against the requesting user with the proposal_draft feature tag', async () => {
    const dealId = await createTestDeal();
    mockCreate.mockResolvedValue({
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [
        {
          type: 'tool_use',
          name: 'draft_proposal',
          input: {
            executive_summary: 'Summary.',
            problem_statement: 'Problem.',
            proposed_solution: 'Solution.',
            pricing_line_items: [{ description: 'Core package', amount: 25000 }],
            next_steps: 'Next steps.',
            prepared_for: 'Jane Doe',
          },
        },
      ],
    });

    await generateProposalDraft(dealId, ownerId, 'Proposal Owner');

    // recordTokenUsage is fire-and-forget (not awaited by the service) — poll briefly.
    let usageRow;
    for (let attempt = 0; attempt < 10 && !usageRow; attempt++) {
      const result = await pool.query<{ feature: string }>(
        `SELECT feature FROM ai_token_usage_daily
         WHERE user_id = $1 AND usage_date = CURRENT_DATE AND feature = 'proposal_draft'`,
        [ownerId],
      );
      usageRow = result.rows[0];
      if (!usageRow) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(usageRow).toBeDefined();
  });
});
