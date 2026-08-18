/**
 * Integration tests for duplicateExplanationService.
 *
 * The Anthropic SDK is mocked so no real API calls are made and token usage
 * recording is deterministic. No database access is required — this service
 * takes plain candidate objects, not record IDs.
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
import { explainDuplicateMatch } from '../services/duplicateExplanationService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import type { DuplicateMatchCandidate } from '../services/duplicateMatchService.js';

const CANDIDATE_A: DuplicateMatchCandidate = {
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@acme.com',
  phone: '555-1234',
  company_name: 'Acme Corp',
};

const CANDIDATE_B: DuplicateMatchCandidate = {
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@acme.com',
  phone: '555-1234',
  company_name: 'Acme Corp',
};

beforeEach(async () => {
  vi.clearAllMocks();
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2, model = 'claude-sonnet-4-20250514'`,
    [ciphertext, keyVersion],
  );
});

afterAll(async () => {
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

describe('explainDuplicateMatch', () => {
  it('scores the pair internally, calls Claude via a forced tool call, and returns the explanation', async () => {
    mockCreate.mockResolvedValue({
      usage: { input_tokens: 40, output_tokens: 15 },
      content: [
        {
          type: 'tool_use',
          name: 'report_duplicate_explanation',
          input: {
            explanation: 'Same email, name, and company — very likely the same person.',
            inconclusive: false,
          },
        },
      ],
    });

    const result = await explainDuplicateMatch(CANDIDATE_A, CANDIDATE_B, 'user-1');

    expect(result.explanation).toContain('Same email');
    expect(result.inconclusive).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const callArgs = mockCreate.mock.calls[0][0];
    const sentPayload = JSON.parse(callArgs.messages[0].content);
    expect(sentPayload.matched_signals).toContain('exact_email');
    expect(sentPayload.match_score).toBeGreaterThan(0);
  });

  it('throws a 503 when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);

    await expect(explainDuplicateMatch(CANDIDATE_A, CANDIDATE_B, 'user-1')).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('throws a 502 when Claude does not return the expected tool call', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = true`);

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'I could not explain this.' }],
    });

    await expect(explainDuplicateMatch(CANDIDATE_A, CANDIDATE_B, 'user-1')).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
