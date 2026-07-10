/**
 * Integration tests for sentimentService. (MINCRM-472)
 *
 * Runs against a real PostgreSQL test database for all contact/account/activity data.
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
import { createContact } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import {
  scoreActivitySentiment,
  getContactSentimentTrend,
  getAccountSentimentTrend,
  flagSentimentScoreInaccurate,
} from '../services/sentimentService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';

/** Direct SQL write bypasses isFeatureEnabled's in-memory cache — must invalidate
 * explicitly, otherwise a warm cache from another test file's earlier reads (the
 * serial project runs files sequentially in one process) hides this write. */
async function setSentimentFlagEnabled(enabled: boolean): Promise<void> {
  await pool.query(
    `UPDATE feature_flags SET enabled = $1 WHERE flag_key = 'ai_sentiment_tracking'`,
    [enabled],
  );
  invalidateFeatureFlagCache();
}

const FILE_PREFIX = 'sentiment-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Sentiment Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM activity_sentiment_scores
     WHERE activity_id IN (SELECT id FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
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

/** Inserts a bare activity row directly (bypasses createActivity's own fire-and-forget
 * scoreActivitySentiment call, which would otherwise double-trigger scoring alongside
 * this test file's explicit calls). */
async function insertTestActivity(
  contactId: string | null,
  accountId: string | null,
  subject: string,
  notes: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO activities (type, subject, notes, contact_id, account_id, owner_id)
     VALUES ('Call', $1, $2, $3, $4, $5) RETURNING id`,
    [subject, notes, contactId, accountId, ownerId],
  );
  return result.rows[0].id;
}

function mockSentimentResponse(
  sentiment: 'positive' | 'neutral' | 'negative',
  confidence = 0.8,
): void {
  mockCreate.mockResolvedValue({
    usage: { input_tokens: 20, output_tokens: 10 },
    content: [
      {
        type: 'tool_use',
        name: 'report_activity_sentiment',
        input: { sentiment, confidence },
      },
    ],
  });
}

beforeAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;
});

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanup();
  await setSentimentFlagEnabled(true);
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2, model = 'claude-sonnet-4-20250514'`,
    [ciphertext, keyVersion],
  );
});

afterAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
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

describe('scoreActivitySentiment', () => {
  it('no-ops when there is no note or subject text', async () => {
    await scoreActivitySentiment({
      activityId: '00000000-0000-0000-0000-000000000001',
      notes: null,
      subject: '',
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not call the AI provider when the feature flag is disabled', async () => {
    await setSentimentFlagEnabled(false);
    const contactId = await createTestContact();
    const activityId = await insertTestActivity(
      contactId,
      null,
      'Call',
      'Great conversation today.',
    );

    await scoreActivitySentiment({
      activityId,
      notes: 'Great conversation today.',
      subject: 'Call',
    });

    expect(mockCreate).not.toHaveBeenCalled();
    const trend = await getContactSentimentTrend(contactId);
    expect(trend.points).toHaveLength(0);
  });

  it('scores and persists a positive sentiment', async () => {
    const contactId = await createTestContact();
    const activityId = await insertTestActivity(
      contactId,
      null,
      'Call',
      'Really excited about moving forward together.',
    );
    mockSentimentResponse('positive', 0.9);

    await scoreActivitySentiment({
      activityId,
      notes: 'Really excited about moving forward together.',
      subject: 'Call',
    });

    const trend = await getContactSentimentTrend(contactId);
    expect(trend.points).toHaveLength(1);
    expect(trend.points[0].sentiment).toBe('positive');
    expect(trend.points[0].flagged_inaccurate).toBe(false);
  });
});

describe('getContactSentimentTrend', () => {
  it('reports insufficient data with fewer than 2 scored interactions', async () => {
    const contactId = await createTestContact();
    const activityId = await insertTestActivity(contactId, null, 'Call', 'Fine, I guess.');
    mockSentimentResponse('neutral');
    await scoreActivitySentiment({ activityId, notes: 'Fine, I guess.', subject: 'Call' });

    const trend = await getContactSentimentTrend(contactId);
    expect(trend.has_sufficient_data).toBe(false);
    expect(trend.trend).toBeNull();
  });

  it('excludes flagged-inaccurate scores from the trend calculation', async () => {
    const contactId = await createTestContact();

    const activity1 = await insertTestActivity(contactId, null, 'Call', 'This is going terribly.');
    mockSentimentResponse('negative');
    await scoreActivitySentiment({
      activityId: activity1,
      notes: 'This is going terribly.',
      subject: 'Call',
    });

    const activity2 = await insertTestActivity(
      contactId,
      null,
      'Call',
      'Things are looking great.',
    );
    mockSentimentResponse('positive');
    await scoreActivitySentiment({
      activityId: activity2,
      notes: 'Things are looking great.',
      subject: 'Call',
    });

    let trend = await getContactSentimentTrend(contactId);
    expect(trend.has_sufficient_data).toBe(true);

    const flagged = await flagSentimentScoreInaccurate(activity1, {
      id: ownerId,
      name: OWNER_USER.name,
    });
    expect(flagged).toBe(true);

    trend = await getContactSentimentTrend(contactId);
    // Only the unflagged positive score remains — one point is below MIN_SCORES_FOR_TREND.
    expect(trend.has_sufficient_data).toBe(false);
    expect(trend.points.find((p) => p.activity_id === activity1)?.flagged_inaccurate).toBe(true);
  });

  it('returns false when flagging a non-existent sentiment score', async () => {
    const contactId = await createTestContact();
    const activityId = await insertTestActivity(
      contactId,
      null,
      'Call',
      'no score exists for this one',
    );
    // Deliberately not scored — no activity_sentiment_scores row exists.
    const flagged = await flagSentimentScoreInaccurate(activityId, {
      id: ownerId,
      name: OWNER_USER.name,
    });
    expect(flagged).toBe(false);
  });
});

describe('getAccountSentimentTrend', () => {
  it('aggregates sentiment across all contacts at the account', async () => {
    const accountId = await createTestAccount();
    const contact1 = await createTestContact(accountId);
    const contact2 = await createTestContact(accountId);

    const activity1 = await insertTestActivity(contact1, null, 'Call', 'Great news on renewal.');
    mockSentimentResponse('positive');
    await scoreActivitySentiment({
      activityId: activity1,
      notes: 'Great news on renewal.',
      subject: 'Call',
    });

    const activity2 = await insertTestActivity(contact2, null, 'Call', 'Neutral status update.');
    mockSentimentResponse('neutral');
    await scoreActivitySentiment({
      activityId: activity2,
      notes: 'Neutral status update.',
      subject: 'Call',
    });

    const trend = await getAccountSentimentTrend(accountId);
    expect(trend.points).toHaveLength(2);
    expect(trend.has_sufficient_data).toBe(true);
  });
});
