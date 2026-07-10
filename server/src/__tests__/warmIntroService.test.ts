/**
 * Integration tests for warmIntroService. (MINCRM-468)
 *
 * Runs against a real PostgreSQL test database for all contact/account/deal/
 * activity/note data. The Anthropic SDK is mocked so no real API calls are made.
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
import { createAccount } from '../services/accountService.js';
import { createDeal, linkContactToDeal } from '../services/dealService.js';
import { createActivity } from '../services/activityService.js';
import { createNote } from '../services/noteService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import { findWarmIntroPaths } from '../services/warmIntroService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';

const FILE_PREFIX = 'warm-intro-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Warm Intro Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let defaultPipelineId: string;

function makeNoteDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM notes WHERE entity_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
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

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;
  defaultPipelineId = await getDefaultPipelineId();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanup();
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
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
  await pool.query(
    `UPDATE feature_flags SET enabled = true
     WHERE flag_key IN ('ai_sentiment_tracking', 'ai_champion_blocker_detection')`,
  );
  invalidateFeatureFlagCache();
});

async function createTestContact(accountId?: string): Promise<string> {
  const contact = await createContact(
    {
      first_name: 'Jane',
      last_name: `Doe-${Date.now()}-${Math.random()}`,
      email: `jane-${Date.now()}-${Math.random()}@example.com`,
      owner_id: ownerId,
      account_id: accountId,
    },
    { id: ownerId, name: OWNER_USER.name },
  );
  return contact.id;
}

async function createTestAccount(): Promise<string> {
  const account = await createAccount(
    { name: `Acme-${Date.now()}-${Math.random()}`, owner_id: ownerId },
    { id: ownerId, name: OWNER_USER.name },
  );
  return account.id;
}

function mockIntroMessageResponse(message: string): void {
  mockCreate.mockResolvedValue({
    usage: { input_tokens: 20, output_tokens: 10 },
    content: [{ type: 'tool_use', name: 'report_intro_message', input: { message } }],
  });
}

describe('findWarmIntroPaths', () => {
  it('returns null when the target contact does not exist', async () => {
    const result = await findWarmIntroPaths('00000000-0000-0000-0000-000000000000', ownerId, 'rep');
    expect(result).toBeNull();
  });

  it('returns an empty paths array when no candidate exists', async () => {
    const targetId = await createTestContact();
    const result = await findWarmIntroPaths(targetId, ownerId, 'rep');
    expect(result).toEqual({ target_contact_id: targetId, paths: [] });
  });

  it('finds a path via a shared account, ranked with a generated message', async () => {
    const accountId = await createTestAccount();
    const targetId = await createTestContact(accountId);
    const knownId = await createTestContact(accountId);
    // The rep must have actually engaged with the known contact for a hop to exist.
    await createActivity(
      { type: 'Call', subject: 'Intro call', contact_id: knownId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockIntroMessageResponse('Would you be open to an introduction?');

    const result = await findWarmIntroPaths(targetId, ownerId, 'rep');

    expect(result?.paths).toHaveLength(1);
    expect(result?.paths[0].links).toHaveLength(2);
    expect(result?.paths[0].links[0].contact_id).toBe(knownId);
    expect(result?.paths[0].links[1].contact_id).toBe(targetId);
    expect(result?.paths[0].suggested_introduction_message).toBe(
      'Would you be open to an introduction?',
    );
  });

  it('finds a path via a shared deal when accounts differ', async () => {
    const targetId = await createTestContact();
    const knownId = await createTestContact();
    const deal = await createDeal(
      {
        name: 'Shared Deal',
        stage: 'Prospecting',
        pipeline_id: defaultPipelineId,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );
    await linkContactToDeal(deal.id, targetId);
    await linkContactToDeal(deal.id, knownId);
    await createActivity(
      { type: 'Call', subject: 'Call', contact_id: knownId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockIntroMessageResponse('Intro message.');

    const result = await findWarmIntroPaths(targetId, ownerId, 'rep');
    expect(result?.paths).toHaveLength(1);
    expect(result?.paths[0].links[0].contact_id).toBe(knownId);
  });

  it('finds a path via account hierarchy (parent/child accounts)', async () => {
    const parentAccountId = await createTestAccount();
    const childAccount = await createAccount(
      { name: `Child-${Date.now()}`, owner_id: ownerId, parent_account_id: parentAccountId },
      { id: ownerId, name: OWNER_USER.name },
    );
    const targetId = await createTestContact(parentAccountId);
    const knownId = await createTestContact(childAccount.id);
    await createActivity(
      { type: 'Call', subject: 'Call', contact_id: knownId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockIntroMessageResponse('Intro message.');

    const result = await findWarmIntroPaths(targetId, ownerId, 'rep');
    expect(result?.paths).toHaveLength(1);
    expect(result?.paths[0].links[0].contact_id).toBe(knownId);
  });

  it('does not treat an unengaged same-account contact as a valid path', async () => {
    const accountId = await createTestAccount();
    const targetId = await createTestContact(accountId);
    // Known contact shares the account, but the rep has never logged activity with them.
    await createTestContact(accountId);

    const result = await findWarmIntroPaths(targetId, ownerId, 'rep');
    expect(result?.paths).toEqual([]);
  });

  it('falls back to a generic message template when the AI call fails', async () => {
    const accountId = await createTestAccount();
    const targetId = await createTestContact(accountId);
    const knownId = await createTestContact(accountId);
    await createActivity(
      { type: 'Call', subject: 'Call', contact_id: knownId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockCreate.mockRejectedValue(new Error('provider unavailable'));

    const result = await findWarmIntroPaths(targetId, ownerId, 'rep');
    expect(result?.paths).toHaveLength(1);
    expect(result?.paths[0].suggested_introduction_message).toContain(
      result?.paths[0].links[1].first_name ?? '',
    );
  });

  it('finds a path via a best-effort notes mention', async () => {
    const targetId = await createTestContact();
    const knownId = await createTestContact();
    await createActivity(
      { type: 'Call', subject: 'Call', contact_id: knownId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );
    const target = await pool.query('SELECT first_name, last_name FROM contacts WHERE id = $1', [
      targetId,
    ]);
    const targetFullName = `${target.rows[0].first_name} ${target.rows[0].last_name}`;
    await createNote(
      'contact',
      knownId,
      {
        body: makeNoteDoc(`Mentioned knowing ${targetFullName} from a previous company.`),
        visibility: 'team',
        tags: [],
      },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockIntroMessageResponse('Intro message.');

    const result = await findWarmIntroPaths(targetId, ownerId, 'rep');
    expect(result?.paths.length).toBeGreaterThanOrEqual(1);
    expect(result?.paths.some((p) => p.links[0].contact_id === knownId)).toBe(true);
  });
});
