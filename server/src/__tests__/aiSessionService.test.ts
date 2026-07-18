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
import type * as AiE2eStubModule from '@minicrm/shared/schemas/aiE2eStub.js';

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

describe('sendMessage — E2E stub scenarios (MINCRM-435)', () => {
  // IS_E2E is captured at module load time, so the module must be re-imported
  // with process.env.E2E set beforehand for these tests to exercise the E2E
  // branch. mockCreate must never be called here — a call would mean the stub
  // branch was skipped and the real (mocked-Anthropic) path ran instead.
  let e2eSendMessage: typeof sendMessage;
  let e2eCreateSession: typeof createSession;
  let stubConstants: typeof AiE2eStubModule;

  beforeAll(async () => {
    vi.resetModules();
    process.env.E2E = 'true';
    const e2eModule = await import('../services/aiSessionService.js');
    e2eSendMessage = e2eModule.sendMessage;
    e2eCreateSession = e2eModule.createSession;
    stubConstants = await import('@minicrm/shared/schemas/aiE2eStub.js');
  });

  afterAll(() => {
    delete process.env.E2E;
    vi.resetModules();
  });

  it('returns the default stub response for a non-prefixed message', async () => {
    const session = await e2eCreateSession(userId, ACTOR);
    const reply = await e2eSendMessage(session.id, userId, 'Hello there', ACTOR, 'rep');

    expect(reply.content).toBe(stubConstants.E2E_STUB_RESPONSE);
    expect(reply.pending_action).toBeNull();
    expect(reply.tool_results).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns tool_results for the READ_QUERY scenario', async () => {
    const session = await e2eCreateSession(userId, ACTOR);
    const reply = await e2eSendMessage(
      session.id,
      userId,
      stubConstants.e2eStubMessage('READ_QUERY'),
      ACTOR,
      'rep',
    );

    expect(reply.tool_results).toEqual([
      {
        toolName: 'searchContacts',
        input: { query: 'stub' },
        output: { data: [stubConstants.E2E_STUB_READ_QUERY_CONTACT], total: 1 },
      },
    ]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns a non-bulk pending_action for MUTATION_CREATE', async () => {
    const session = await e2eCreateSession(userId, ACTOR);
    const reply = await e2eSendMessage(
      session.id,
      userId,
      stubConstants.e2eStubMessage('MUTATION_CREATE'),
      ACTOR,
      'rep',
    );

    expect(reply.pending_action).toMatchObject({
      operation: 'create',
      entityType: 'contact',
      isBulk: false,
    });
  });

  it('returns a bulk pending_action with count and sample for MUTATION_BULK', async () => {
    const session = await e2eCreateSession(userId, ACTOR);
    const reply = await e2eSendMessage(
      session.id,
      userId,
      stubConstants.e2eStubMessage('MUTATION_BULK'),
      ACTOR,
      'rep',
    );

    expect(reply.pending_action).toMatchObject({
      operation: 'update',
      isBulk: true,
      bulkCount: stubConstants.E2E_STUB_BULK_COUNT,
    });
    expect(reply.pending_action?.bulkSample).toHaveLength(3);
  });

  it('returns an isBulkDelete pending_action for MUTATION_BULK_DELETE', async () => {
    const session = await e2eCreateSession(userId, ACTOR);
    const reply = await e2eSendMessage(
      session.id,
      userId,
      stubConstants.e2eStubMessage('MUTATION_BULK_DELETE'),
      ACTOR,
      'rep',
    );

    expect(reply.pending_action).toMatchObject({
      operation: 'delete',
      isBulk: true,
      isBulkDelete: true,
      bulkCount: stubConstants.E2E_STUB_BULK_DELETE_COUNT,
    });
  });

  it('throws a statusCode 403 for RBAC_DENIED', async () => {
    const session = await e2eCreateSession(userId, ACTOR);

    await expect(
      e2eSendMessage(session.id, userId, stubConstants.e2eStubMessage('RBAC_DENIED'), ACTOR, 'rep'),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: stubConstants.E2E_STUB_RBAC_DENIED_MESSAGE,
    });
  });

  it('returns a context_proposal for CONTEXT_PROPOSAL, then suppresses it on repeat in the same session', async () => {
    const session = await e2eCreateSession(userId, ACTOR);

    const first = await e2eSendMessage(
      session.id,
      userId,
      stubConstants.e2eStubMessage('CONTEXT_PROPOSAL'),
      ACTOR,
      'rep',
    );
    expect(first.context_proposal).toMatchObject(stubConstants.E2E_STUB_CONTEXT_PROPOSAL);
    expect(first.content).not.toContain('%%CONTEXT_PROPOSAL%%');

    const second = await e2eSendMessage(
      session.id,
      userId,
      stubConstants.e2eStubMessage('CONTEXT_PROPOSAL'),
      ACTOR,
      'rep',
    );
    expect(second.context_proposal).toBeNull();
    expect(second.content).toBe(stubConstants.E2E_STUB_RESPONSE);
  });
});
