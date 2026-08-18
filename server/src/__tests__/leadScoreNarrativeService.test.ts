/**
 * Integration tests for leadScoreNarrativeService.
 *
 * Runs against a real PostgreSQL test database. The Anthropic SDK is mocked
 * so no real API calls are made and token usage recording is deterministic.
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
import { createLead } from '../services/leadsService.js';
import { generateLeadScoreNarrative } from '../services/leadScoreNarrativeService.js';
import { encryptVersioned } from '../services/cryptoService.js';

const FILE_PREFIX = 'lead-score-narrative-svc';

let ownerId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Lead Score Narrative Owner',
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
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

describe('generateLeadScoreNarrative', () => {
  it('returns null when the lead does not exist', async () => {
    const result = await generateLeadScoreNarrative(
      '00000000-0000-0000-0000-000000000000',
      ownerId,
    );
    expect(result).toBeNull();
  });

  it('scores the lead internally, calls Claude via a forced tool call, and returns the narrative', async () => {
    const lead = await createLead(
      {
        first_name: 'Jane',
        last_name: 'Doe',
        email: `${FILE_PREFIX}-jane@example.com`,
        lead_source: 'Referral',
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Narrative Owner' },
    );

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 45, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'report_lead_score_narrative',
          input: {
            narrative: 'This lead scores well because of a strong referral source.',
            insufficient_data: false,
          },
        },
      ],
    });

    const result = await generateLeadScoreNarrative(lead.id, ownerId);

    expect(result).not.toBeNull();
    expect(result?.narrative).toContain('referral source');
    expect(result?.insufficient_data).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const callArgs = mockCreate.mock.calls[0][0];
    const sentPayload = JSON.parse(callArgs.messages[0].content);
    expect(sentPayload.lead_source).toBe('Referral');
    expect(typeof sentPayload.score).toBe('number');
  });

  it('throws a 503 when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);

    const lead = await createLead(
      {
        first_name: 'Disabled',
        last_name: 'AI',
        email: `${FILE_PREFIX}-disabled@example.com`,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Narrative Owner' },
    );

    await expect(generateLeadScoreNarrative(lead.id, ownerId)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('throws a 502 when Claude does not return the expected tool call', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = true`);

    const lead = await createLead(
      {
        first_name: 'No',
        last_name: 'ToolCall',
        email: `${FILE_PREFIX}-notool@example.com`,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Narrative Owner' },
    );

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'I could not explain this score.' }],
    });

    await expect(generateLeadScoreNarrative(lead.id, ownerId)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
