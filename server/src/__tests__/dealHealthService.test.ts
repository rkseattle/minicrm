/**
 * Integration tests for dealHealthService. (MINCRM-442)
 *
 * Runs against a real PostgreSQL test database for all deal/activity data.
 * The Anthropic SDK is mocked so no real API calls are made and token usage
 * recording is deterministic.
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
  // Static error classes referenced via instanceof checks in the service under test.
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
import { createActivity } from '../services/activityService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import { generateDealHealthCheck } from '../services/dealHealthService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';

const FILE_PREFIX = 'deal-health-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Deal Health Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let defaultPipelineId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;
  defaultPipelineId = await getDefaultPipelineId();
});

beforeEach(async () => {
  vi.clearAllMocks();
  // Enable AI with a real encrypted key (via the same encryptVersioned the app uses) so
  // decryptVersioned succeeds and the service proceeds past its guard checks.
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2, model = 'claude-sonnet-4-20250514'`,
    [ciphertext, keyVersion],
  );
  // This file calls the real createActivity(), which fires scoreActivitySentiment
  // fire-and-forget after every insert. With ai_configuration.enabled=true above, that
  // background hook would otherwise call the same mocked Anthropic client and pollute
  // mockCreate's call count/args for this file's own generateDealHealthCheck assertions.
  // (MINCRM-472)
  await pool.query(
    `UPDATE feature_flags SET enabled = false WHERE flag_key = 'ai_sentiment_tracking'`,
  );
  invalidateFeatureFlagCache();
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

describe('generateDealHealthCheck', () => {
  it('returns null when the deal does not exist', async () => {
    const result = await generateDealHealthCheck('00000000-0000-0000-0000-000000000000', ownerId);
    expect(result).toBeNull();
  });

  it('gathers deal context, calls Claude via a forced tool call, and returns the structured assessment', async () => {
    const deal = await createDeal(
      {
        name: 'Acme Renewal',
        stage: 'Prospecting',
        value: 25000,
        close_date: '2026-12-31',
        pipeline_id: defaultPipelineId,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );

    await createActivity(
      { type: 'Call', subject: 'Discovery call', deal_id: deal.id, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 120, output_tokens: 40 },
      content: [
        {
          type: 'tool_use',
          name: 'report_deal_health',
          input: {
            status: 'at_risk',
            narrative: 'No activity in 14 days and the close date has no confirmed next step.',
            next_actions: ['Schedule a follow-up call.'],
          },
        },
      ],
    });

    const result = await generateDealHealthCheck(deal.id, ownerId);

    expect(result).not.toBeNull();
    expect(result?.status).toBe('at_risk');
    expect(result?.narrative).toContain('No activity');
    expect(result?.next_actions).toEqual(['Schedule a follow-up call.']);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // The prompt payload must never include the raw deal id/owner id as those aren't part of
    // the documented context shape — asserts we're sending the curated context, not the full row.
    const callArgs = mockCreate.mock.calls[0][0];
    const sentPayload = JSON.parse(callArgs.messages[0].content);
    expect(sentPayload.name).toBe('Acme Renewal');
    expect(sentPayload).not.toHaveProperty('owner_id');
    expect(sentPayload).not.toHaveProperty('id');
  });

  it('throws a 503 when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);

    const deal = await createDeal(
      {
        name: 'Disabled AI Deal',
        stage: 'Prospecting',
        pipeline_id: defaultPipelineId,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );

    await expect(generateDealHealthCheck(deal.id, ownerId)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('throws a 502 when Claude does not return the expected tool call', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = true`);

    const deal = await createDeal(
      {
        name: 'No Tool Call Deal',
        stage: 'Prospecting',
        pipeline_id: defaultPipelineId,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'I could not assess this deal.' }],
    });

    await expect(generateDealHealthCheck(deal.id, ownerId)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
