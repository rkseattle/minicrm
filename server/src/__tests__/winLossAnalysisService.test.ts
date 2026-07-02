/**
 * Integration tests for winLossAnalysisService. (MINCRM-464)
 *
 * Runs against a real PostgreSQL test database for all deal/activity data.
 * The Anthropic SDK is mocked so no real API calls are made.
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
import { analyzeWinLossPatterns, getWinLossInsights } from '../services/winLossAnalysisService.js';
import { encryptVersioned } from '../services/cryptoService.js';

const FILE_PREFIX = 'win-loss-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Win Loss Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let defaultPipelineId: string;

async function cleanupDeals(): Promise<void> {
  await pool.query('DELETE FROM deal_win_loss_insights');
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
}

beforeAll(async () => {
  await cleanupDeals();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;
  defaultPipelineId = await getDefaultPipelineId();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanupDeals();
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration
     SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2,
         model = 'claude-sonnet-4-20250514', win_loss_min_closed_deals = 3, win_loss_min_sample_size = 2`,
    [ciphertext, keyVersion],
  );
});

afterAll(async () => {
  await cleanupDeals();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(
    `UPDATE ai_configuration SET enabled = false, api_key_encrypted = '', win_loss_min_closed_deals = 20, win_loss_min_sample_size = 5`,
  );
});

/** Creates a closed deal directly, bypassing createDeal's stage-name resolution guard for terminal stages. */
async function createClosedDeal(
  stage: 'Closed Won' | 'Closed Lost',
  lossReason?: string,
): Promise<string> {
  const deal = await createDeal(
    {
      name: `Closed Deal ${Date.now()}-${Math.random()}`,
      stage: 'Prospecting',
      pipeline_id: defaultPipelineId,
      owner_id: ownerId,
    },
    { id: ownerId, name: OWNER_USER.name },
  );
  await pool.query(`UPDATE deals SET stage = $1, loss_reason = $2 WHERE id = $3`, [
    stage,
    lossReason ?? null,
    deal.id,
  ]);
  return deal.id;
}

describe('analyzeWinLossPatterns', () => {
  it('no-ops without calling the AI when below the minimum closed-deal threshold', async () => {
    await createClosedDeal('Closed Won');
    await createClosedDeal('Closed Lost');
    // min_closed_deals is 3 in this suite; only 2 exist.

    await analyzeWinLossPatterns();

    expect(mockCreate).not.toHaveBeenCalled();
    const result = await getWinLossInsights();
    expect(result.insights).toEqual([]);
  });

  it('narrates significant signals via a forced tool call and caches the results', async () => {
    for (let i = 0; i < 3; i++) await createClosedDeal('Closed Won');
    for (let i = 0; i < 2; i++) await createClosedDeal('Closed Lost', 'Price too high');

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 200, output_tokens: 80 },
      content: [
        {
          type: 'tool_use',
          name: 'report_win_loss_insights',
          input: {
            patterns: [
              {
                signal_type: 'fast_stage_velocity',
                observation: 'Deals that close quickly win more often (based on 5 deals).',
              },
            ],
            loss_reason_trends: [
              { observation: 'Price objections account for all recent losses.' },
            ],
          },
        },
      ],
    });

    await analyzeWinLossPatterns();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const result = await getWinLossInsights();
    expect(result.has_sufficient_data).toBe(true);
    expect(result.closed_deals_count).toBe(5);
    expect(result.insights.some((i) => i.signal_type === 'fast_stage_velocity')).toBe(true);
    expect(result.loss_reason_trends).toHaveLength(1);
    expect(result.loss_reason_trends[0].observation).toContain('Price objections');
  });

  it('replaces prior cached results rather than appending on each run', async () => {
    for (let i = 0; i < 3; i++) await createClosedDeal('Closed Won');
    for (let i = 0; i < 2; i++) await createClosedDeal('Closed Lost');

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 100, output_tokens: 40 },
      content: [
        {
          type: 'tool_use',
          name: 'report_win_loss_insights',
          input: {
            patterns: [
              { signal_type: 'fast_stage_velocity', observation: 'First run observation.' },
            ],
            loss_reason_trends: [],
          },
        },
      ],
    });
    await analyzeWinLossPatterns();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 100, output_tokens: 40 },
      content: [
        {
          type: 'tool_use',
          name: 'report_win_loss_insights',
          input: {
            patterns: [
              { signal_type: 'fast_stage_velocity', observation: 'Second run observation.' },
            ],
            loss_reason_trends: [],
          },
        },
      ],
    });
    await analyzeWinLossPatterns();

    const result = await getWinLossInsights();
    const matching = result.insights.filter((i) => i.signal_type === 'fast_stage_velocity');
    expect(matching).toHaveLength(1);
    expect(matching[0].observation).toBe('Second run observation.');
  });

  it('does not call the AI when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);
    for (let i = 0; i < 3; i++) await createClosedDeal('Closed Won');
    for (let i = 0; i < 2; i++) await createClosedDeal('Closed Lost');

    await analyzeWinLossPatterns();

    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('getWinLossInsights', () => {
  it('reports has_sufficient_data based on the configured threshold, independent of cached rows', async () => {
    await createClosedDeal('Closed Won');
    const result = await getWinLossInsights();
    expect(result.has_sufficient_data).toBe(false);
    expect(result.min_closed_deals_required).toBe(3);
    expect(result.closed_deals_count).toBe(1);
  });
});
