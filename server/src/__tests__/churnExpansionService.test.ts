/**
 * Integration tests for churnExpansionService. (MINCRM-469)
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
import { createDeal } from '../services/dealService.js';
import { createActivity } from '../services/activityService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import { getNotificationFeed } from '../services/notificationFeedService.js';
import {
  detectChurnExpansionSignals,
  getAccountChurnExpansionSignal,
  listChurnExpansionSignals,
} from '../services/churnExpansionService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';

const FILE_PREFIX = 'churn-exp-svc';

let ownerId: string;
let defaultPipelineId: string;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM account_churn_expansion_signals
     WHERE account_id IN (SELECT id FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)',
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
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
}

beforeAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Churn Expansion Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  ownerId = owner.id;
  defaultPipelineId = await getDefaultPipelineId();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanup();
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration
     SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2,
         model = 'claude-sonnet-4-20250514', churn_expansion_confidence_threshold = 0.70`,
    [ciphertext, keyVersion],
  );
  // This file calls the real createActivity(), which fires scoreActivitySentiment
  // fire-and-forget after every insert. With ai_configuration.enabled=true above, that
  // background hook would otherwise call the same mocked Anthropic client and pollute
  // mockCreate's call count/args for this file's own assertions. (MINCRM-472)
  await pool.query(
    `UPDATE feature_flags SET enabled = false WHERE flag_key = 'ai_sentiment_tracking'`,
  );
  invalidateFeatureFlagCache();
});

afterAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

/** Creates a closed-won account with a deal and an activity, matching the "closed-won accounts with activity history" scope. */
async function createClosedWonAccountWithActivity(): Promise<string> {
  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
    [`Test Account ${Date.now()}-${Math.random()}`, ownerId],
  );
  const accountId = accountResult.rows[0].id;

  const deal = await createDeal(
    {
      name: 'Closed Won Deal',
      stage: 'Prospecting',
      pipeline_id: defaultPipelineId,
      owner_id: ownerId,
      account_id: accountId,
    },
    { id: ownerId, name: 'Churn Expansion Owner' },
  );
  await pool.query(`UPDATE deals SET stage = 'Closed Won' WHERE id = $1`, [deal.id]);

  await createActivity(
    {
      type: 'Call',
      subject: 'Check-in call',
      notes: 'Routine check-in.',
      account_id: accountId,
      owner_id: ownerId,
    },
    { id: ownerId, name: 'Churn Expansion Owner' },
  );

  return accountId;
}

describe('detectChurnExpansionSignals', () => {
  it('does not call the AI when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);
    await createClosedWonAccountWithActivity();

    await detectChurnExpansionSignals();

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('inserts a churn_risk signal when detected above the confidence threshold', async () => {
    const accountId = await createClosedWonAccountWithActivity();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 50, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'report_churn_expansion_signal',
          input: {
            signal_detected: true,
            signal_type: 'churn_risk',
            confidence: 0.9,
            contributing_factors: ['No activity logged in 45 days'],
          },
        },
      ],
    });

    await detectChurnExpansionSignals();

    const result = await getAccountChurnExpansionSignal(accountId);
    expect(result.signal).not.toBeNull();
    expect(result.signal?.signal_type).toBe('churn_risk');
    expect(result.signal?.confidence).toBe(0.9);
  });

  it('suppresses a signal below the configured confidence threshold', async () => {
    const accountId = await createClosedWonAccountWithActivity();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 50, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'report_churn_expansion_signal',
          input: {
            signal_detected: true,
            signal_type: 'churn_risk',
            confidence: 0.5,
            contributing_factors: ['Weak signal'],
          },
        },
      ],
    });

    await detectChurnExpansionSignals();

    const result = await getAccountChurnExpansionSignal(accountId);
    expect(result.signal).toBeNull();
  });

  it('sends an in-app notification for a high-confidence churn signal', async () => {
    await createClosedWonAccountWithActivity();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 50, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'report_churn_expansion_signal',
          input: {
            signal_detected: true,
            signal_type: 'churn_risk',
            confidence: 0.9,
            contributing_factors: ['No activity logged in 45 days'],
          },
        },
      ],
    });

    await detectChurnExpansionSignals();

    const feed = await getNotificationFeed(ownerId);
    expect(feed.notifications.some((n) => n.type === 'churn_risk_detected')).toBe(true);
  });

  it('does not send a notification for a below-notification-threshold churn signal', async () => {
    await createClosedWonAccountWithActivity();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 50, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'report_churn_expansion_signal',
          input: {
            signal_detected: true,
            signal_type: 'churn_risk',
            confidence: 0.75,
            contributing_factors: ['Mild signal'],
          },
        },
      ],
    });

    await detectChurnExpansionSignals();

    const feed = await getNotificationFeed(ownerId);
    expect(feed.notifications.some((n) => n.type === 'churn_risk_detected')).toBe(false);
  });

  it('clears an active signal when the next run finds no signal', async () => {
    const accountId = await createClosedWonAccountWithActivity();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 50, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'report_churn_expansion_signal',
          input: {
            signal_detected: true,
            signal_type: 'churn_risk',
            confidence: 0.9,
            contributing_factors: ['No activity in 45 days'],
          },
        },
      ],
    });
    await detectChurnExpansionSignals();
    expect((await getAccountChurnExpansionSignal(accountId)).signal).not.toBeNull();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 50, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'report_churn_expansion_signal',
          input: { signal_detected: false },
        },
      ],
    });
    await detectChurnExpansionSignals();

    const result = await getAccountChurnExpansionSignal(accountId);
    expect(result.signal).toBeNull();
  });
});

describe('listChurnExpansionSignals', () => {
  it('separates at-risk and expansion accounts', async () => {
    const churnAccountId = await createClosedWonAccountWithActivity();
    const expansionAccountId = await createClosedWonAccountWithActivity();

    mockCreate.mockResolvedValueOnce({
      usage: { input_tokens: 50, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'report_churn_expansion_signal',
          input: {
            signal_detected: true,
            signal_type: 'churn_risk',
            confidence: 0.9,
            contributing_factors: ['No activity in 45 days'],
          },
        },
      ],
    });
    mockCreate.mockResolvedValueOnce({
      usage: { input_tokens: 50, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'report_churn_expansion_signal',
          input: {
            signal_detected: true,
            signal_type: 'expansion',
            confidence: 0.8,
            contributing_factors: ['New team mentioned'],
          },
        },
      ],
    });

    await detectChurnExpansionSignals();

    const result = await listChurnExpansionSignals(null);
    expect(result.at_risk.some((a) => a.account_id === churnAccountId)).toBe(true);
    expect(result.expansion.some((a) => a.account_id === expansionAccountId)).toBe(true);
  });
});
