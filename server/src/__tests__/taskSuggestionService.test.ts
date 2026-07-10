/**
 * Integration tests for taskSuggestionService. (MINCRM-438)
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
import { createContact } from '../services/contactService.js';
import { createActivity } from '../services/activityService.js';
import { generateTaskSuggestions } from '../services/taskSuggestionService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';

const FILE_PREFIX = 'task-suggestion-svc';

let ownerId: string;
let contactId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Task Suggestion Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  ownerId = owner.id;

  const contact = await createContact(
    {
      first_name: 'Task',
      last_name: 'Suggestee',
      email: `${FILE_PREFIX}-contact@example.com`,
      owner_id: ownerId,
    },
    { id: ownerId, name: 'Task Suggestion Owner' },
  );
  contactId = contact.id;
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2, model = 'claude-sonnet-4-20250514'`,
    [ciphertext, keyVersion],
  );
  // This file calls the real createActivity() with a contact_id set, which fires both
  // analyzeContactSignals and scoreActivitySentiment fire-and-forget after every insert.
  // With ai_configuration.enabled=true above, those background hooks would otherwise call
  // the same mocked Anthropic client and pollute mockCreate's call count/args for this
  // file's own assertions. (MINCRM-465, MINCRM-472)
  await pool.query(
    `UPDATE feature_flags SET enabled = false
     WHERE flag_key IN ('ai_sentiment_tracking', 'ai_champion_blocker_detection')`,
  );
  invalidateFeatureFlagCache();
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
  // Restore the flags disabled in beforeEach — feature_flags is a shared global table and
  // this file runs serially alongside every other test file, so leaving them disabled would
  // break unrelated later suites (e.g. championBlockerService/-Controller, sentimentService).
  await pool.query(
    `UPDATE feature_flags SET enabled = true
     WHERE flag_key IN ('ai_sentiment_tracking', 'ai_champion_blocker_detection')`,
  );
  invalidateFeatureFlagCache();
});

describe('generateTaskSuggestions', () => {
  it('returns null when the activity does not exist', async () => {
    const result = await generateTaskSuggestions('00000000-0000-0000-0000-000000000000', ownerId);
    expect(result).toBeNull();
  });

  it('gathers activity context, calls Claude via a forced tool call, and returns suggestions', async () => {
    const activity = await createActivity(
      {
        type: 'Call',
        subject: 'Discovery call',
        notes: 'Discussed renewal pricing.',
        contact_id: contactId,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Task Suggestion Owner' },
    );

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 60, output_tokens: 25 },
      content: [
        {
          type: 'tool_use',
          name: 'report_task_suggestions',
          input: {
            suggestions: [
              {
                description: 'Send revised proposal',
                suggested_due_date: '2026-07-11',
                linked_entity: 'contact',
              },
            ],
          },
        },
      ],
    });

    const result = await generateTaskSuggestions(activity.id, ownerId);

    expect(result).not.toBeNull();
    expect(result?.suggestions).toEqual([
      {
        description: 'Send revised proposal',
        suggested_due_date: '2026-07-11',
        linked_entity: 'contact',
      },
    ]);
    // createActivity's fire-and-forget champion/blocker analysis (contact-linked + notes)
    // also calls the mocked Anthropic client, so this asserts our call specifically rather
    // than the total call count across both features.
    const taskSuggestionCall = mockCreate.mock.calls.find(
      ([args]) => args.tool_choice?.name === 'report_task_suggestions',
    );
    expect(taskSuggestionCall).toBeDefined();
  });

  it('throws a 503 when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);

    const activity = await createActivity(
      {
        type: 'Meeting',
        subject: 'Kickoff',
        contact_id: contactId,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Task Suggestion Owner' },
    );

    await expect(generateTaskSuggestions(activity.id, ownerId)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('throws a 502 when Claude does not return the expected tool call', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = true`);

    const activity = await createActivity(
      {
        type: 'Email',
        subject: 'Intro email',
        contact_id: contactId,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Task Suggestion Owner' },
    );

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'I could not suggest tasks.' }],
    });

    await expect(generateTaskSuggestions(activity.id, ownerId)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
