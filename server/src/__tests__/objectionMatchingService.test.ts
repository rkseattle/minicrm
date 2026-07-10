/**
 * Integration tests for objectionMatchingService. (MINCRM-471)
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
import {
  classifyActivityObjection,
  findObjectionPrecedents,
} from '../services/objectionMatchingService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';

const FILE_PREFIX = 'objection-svc';

let ownerId: string;
let defaultPipelineId: string;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM activity_objection_signals
     WHERE activity_id IN (SELECT id FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))`,
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
}

beforeAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Objection Owner',
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
         model = 'claude-sonnet-4-20250514'`,
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
  // Restore the flag disabled in beforeEach — feature_flags is a shared global table and
  // this file runs serially alongside every other test file, so leaving it disabled would
  // break unrelated later suites (e.g. championBlockerService/-Controller). (MINCRM-472)
  await pool.query(
    `UPDATE feature_flags SET enabled = true WHERE flag_key = 'ai_sentiment_tracking'`,
  );
  invalidateFeatureFlagCache();
});

/** Creates a scratch deal so test activities can satisfy activities_has_parent. */
async function createScratchDeal(): Promise<string> {
  const deal = await createDeal(
    {
      name: `Scratch Deal ${Date.now()}-${Math.random()}`,
      stage: 'Prospecting',
      pipeline_id: defaultPipelineId,
      owner_id: ownerId,
    },
    { id: ownerId, name: 'Objection Owner' },
  );
  return deal.id;
}

async function createActivityWithNotes(notes: string): Promise<string> {
  const dealId = await createScratchDeal();
  const activity = await createActivity(
    { type: 'Call', subject: 'Sales call', notes, deal_id: dealId, owner_id: ownerId },
    { id: ownerId, name: 'Objection Owner' },
  );
  return activity.id;
}

describe('classifyActivityObjection', () => {
  it('returns null when the activity has no notes', async () => {
    const dealId = await createScratchDeal();
    const activity = await createActivity(
      { type: 'Call', subject: 'Sales call', deal_id: dealId, owner_id: ownerId },
      { id: ownerId, name: 'Objection Owner' },
    );

    const result = await classifyActivityObjection(activity.id, ownerId);

    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('throws when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);
    const activityId = await createActivityWithNotes('Too expensive for our budget.');

    await expect(classifyActivityObjection(activityId, ownerId)).rejects.toThrow(
      'AI features are not enabled',
    );
  });

  it('returns the classified category and persists it', async () => {
    const activityId = await createActivityWithNotes('Too expensive for our budget.');
    mockCreate.mockResolvedValue({
      usage: { input_tokens: 20, output_tokens: 10 },
      content: [
        {
          type: 'tool_use',
          name: 'report_objection_category',
          input: { objection_detected: true, category: 'Price' },
        },
      ],
    });

    const result = await classifyActivityObjection(activityId, ownerId);

    expect(result).toEqual({ activity_id: activityId, category: 'Price' });
    const row = await pool.query(
      'SELECT category FROM activity_objection_signals WHERE activity_id = $1',
      [activityId],
    );
    expect(row.rows[0].category).toBe('Price');
  });

  it('returns null when no objection is detected', async () => {
    const activityId = await createActivityWithNotes('Had a great call, very positive.');
    mockCreate.mockResolvedValue({
      usage: { input_tokens: 20, output_tokens: 10 },
      content: [
        {
          type: 'tool_use',
          name: 'report_objection_category',
          input: { objection_detected: false },
        },
      ],
    });

    const result = await classifyActivityObjection(activityId, ownerId);

    expect(result).toBeNull();
  });

  it('returns the cached classification on a second call without calling the AI again', async () => {
    const activityId = await createActivityWithNotes('Too expensive for our budget.');
    mockCreate.mockResolvedValue({
      usage: { input_tokens: 20, output_tokens: 10 },
      content: [
        {
          type: 'tool_use',
          name: 'report_objection_category',
          input: { objection_detected: true, category: 'Price' },
        },
      ],
    });

    await classifyActivityObjection(activityId, ownerId);
    mockCreate.mockClear();
    const second = await classifyActivityObjection(activityId, ownerId);

    expect(second).toEqual({ activity_id: activityId, category: 'Price' });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('findObjectionPrecedents', () => {
  it('reports insufficient data below the closed-won deal minimum', async () => {
    const result = await findObjectionPrecedents('Price');

    expect(result.has_sufficient_data).toBe(false);
    expect(result.precedents).toEqual([]);
    expect(result.min_closed_won_deals_required).toBe(10);
  });

  it('returns precedents once the closed-won deal minimum is met', async () => {
    for (let i = 0; i < 10; i++) {
      const deal = await createDeal(
        {
          name: `Won Deal ${i}`,
          stage: 'Prospecting',
          pipeline_id: defaultPipelineId,
          owner_id: ownerId,
        },
        { id: ownerId, name: 'Objection Owner' },
      );
      await pool.query(`UPDATE deals SET stage = 'Closed Won', close_date = now() WHERE id = $1`, [
        deal.id,
      ]);

      const activity = await createActivity(
        {
          type: 'Call',
          subject: 'Objection call',
          notes: 'Too expensive for our budget.',
          deal_id: deal.id,
          owner_id: ownerId,
        },
        { id: ownerId, name: 'Objection Owner' },
      );

      if (i === 0) {
        await pool.query(
          `INSERT INTO activity_objection_signals (activity_id, category) VALUES ($1, $2)`,
          [activity.id, 'Price'],
        );
      }
    }

    const result = await findObjectionPrecedents('Price');

    expect(result.has_sufficient_data).toBe(true);
    expect(result.closed_won_deals_count).toBeGreaterThanOrEqual(10);
    expect(result.precedents.length).toBe(1);
    expect(result.precedents[0].objection_quote).toBe('Too expensive for our budget.');
  });
});
