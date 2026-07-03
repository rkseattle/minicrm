/**
 * Integration tests for aiSessionService.sendMessage — the agentic Claude
 * tool-use loop. (MINCRM-422, MINCRM-425)
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
import { createSession, sendMessage } from '../services/aiSessionService.js';
import { encryptVersioned } from '../services/cryptoService.js';

const FILE_PREFIX = 'ai-session-svc';
const ACTOR = { id: '', name: 'AI Session Owner' };

let userId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'AI Session Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  userId = owner.id;
  ACTOR.id = userId;
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
  await pool.query(
    `DELETE FROM ai_messages WHERE session_id IN
       (SELECT id FROM ai_sessions WHERE user_id = $1)`,
    [userId],
  );
  await pool.query('DELETE FROM ai_sessions WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

describe('sendMessage — requestMutationConfirmation with no accompanying text', () => {
  it('returns the pending action instead of throwing an AI_PROVIDER_ERROR', async () => {
    const session = await createSession(userId, ACTOR);

    // Claude commonly calls requestMutationConfirmation with no surrounding text block —
    // this must not be mistaken for "AI provider returned no text content". (MINCRM-425)
    mockCreate.mockResolvedValue({
      usage: { input_tokens: 50, output_tokens: 20 },
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_confirm_1',
          name: 'requestMutationConfirmation',
          input: {
            operation: 'create',
            entity_type: 'contact',
            fields: { first_name: 'Jane', last_name: 'Doe' },
            is_bulk: false,
            summary: 'Create a new contact named Jane Doe',
          },
        },
      ],
    });

    const reply = await sendMessage(
      session.id,
      userId,
      'Add a contact named Jane Doe',
      ACTOR,
      'rep',
    );

    expect(reply.content).toBe('');
    expect(reply.pending_action).not.toBeNull();
    expect(reply.pending_action).toMatchObject({
      operation: 'create',
      entityType: 'contact',
      summary: 'Create a new contact named Jane Doe',
    });
  });

  it('still throws AI_PROVIDER_ERROR when there is neither text nor a pending action', async () => {
    const session = await createSession(userId, ACTOR);

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 10, output_tokens: 0 },
      stop_reason: 'end_turn',
      content: [],
    });

    await expect(sendMessage(session.id, userId, 'Hello', ACTOR, 'rep')).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
