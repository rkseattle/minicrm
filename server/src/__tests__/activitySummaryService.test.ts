/**
 * Integration tests for activitySummaryService.
 *
 * Runs against a real PostgreSQL test database. The Anthropic SDK is mocked so
 * no real API calls are made and token usage recording is deterministic.
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
import { summarizeActivityText } from '../services/activitySummaryService.js';
import { encryptVersioned } from '../services/cryptoService.js';

const FILE_PREFIX = 'activity-summary-svc';

let ownerId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Activity Summary Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  ownerId = owner.id;
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2, model = 'claude-sonnet-4-20250514'`,
    [ciphertext, keyVersion],
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

describe('summarizeActivityText', () => {
  it('calls Claude via a forced tool call and returns the structured summary', async () => {
    mockCreate.mockResolvedValue({
      usage: { input_tokens: 80, output_tokens: 30 },
      content: [
        {
          type: 'tool_use',
          name: 'report_activity_summary',
          input: {
            summary: 'Discussed renewal pricing and agreed to send a revised proposal.',
            action_items: ['Send revised proposal.'],
            suggested_follow_up_tasks: [
              { description: 'Follow up on proposal', suggested_due_date: '2026-07-11' },
            ],
          },
        },
      ],
    });

    const result = await summarizeActivityText(
      'Call transcript: customer asked for revised pricing on the renewal...',
      ownerId,
    );

    expect(result.summary).toContain('renewal pricing');
    expect(result.action_items).toEqual(['Send revised proposal.']);
    expect(result.suggested_follow_up_tasks).toEqual([
      { description: 'Follow up on proposal', suggested_due_date: '2026-07-11' },
    ]);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.tool_choice).toEqual({ type: 'tool', name: 'report_activity_summary' });
  });

  it('throws a 503 when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);

    await expect(summarizeActivityText('Some call notes', ownerId)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('throws a 502 when Claude does not return the expected tool call', async () => {
    mockCreate.mockResolvedValue({
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'I could not summarize this.' }],
    });

    await expect(summarizeActivityText('Some call notes', ownerId)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
