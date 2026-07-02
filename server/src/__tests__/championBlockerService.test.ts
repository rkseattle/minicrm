/**
 * Integration tests for championBlockerService. (MINCRM-466)
 *
 * Runs against a real PostgreSQL test database for all contact/deal data.
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
import { createDeal, linkContactToDeal } from '../services/dealService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import {
  analyzeContactSignals,
  getContactChampionBlockerStatus,
  dismissContactClassification,
  overrideContactClassification,
  getDealStakeholderMap,
} from '../services/championBlockerService.js';
import { encryptVersioned } from '../services/cryptoService.js';

const FILE_PREFIX = 'champ-block-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Champion Blocker Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let defaultPipelineId: string;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM contact_champion_blocker_signals
     WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
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
}

/** Inserts a bare activity row directly (bypasses createActivity's own fire-and-forget
 * analyzeContactSignals call, which would otherwise double-trigger analysis alongside
 * this test file's explicit calls). */
async function insertTestActivity(
  contactId: string,
  subject: string,
  notes: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO activities (type, subject, notes, contact_id, owner_id) VALUES ('Call', $1, $2, $3, $4) RETURNING id`,
    [subject, notes, contactId, ownerId],
  );
  return result.rows[0].id;
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
});

afterAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

async function createTestContact(): Promise<string> {
  const contact = await createContact(
    {
      first_name: 'Jane',
      last_name: `Doe-${Date.now()}-${Math.random()}`,
      email: `jane-${Date.now()}-${Math.random()}@example.com`,
      owner_id: ownerId,
    },
    { id: ownerId, name: OWNER_USER.name },
  );
  return contact.id;
}

describe('analyzeContactSignals', () => {
  it('no-ops when the activity has no linked contact', async () => {
    await analyzeContactSignals({
      activityId: '00000000-0000-0000-0000-000000000001',
      contactId: null,
      notes: 'Mentioned sharing proposal with VP Finance',
      subject: 'Call',
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('applies a detected champion signal and updates the classification', async () => {
    const contactId = await createTestContact();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 50, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'report_champion_blocker_signal',
          input: {
            signal_detected: true,
            direction: 'champion',
            description: 'Mentioned sharing proposal with VP Finance',
          },
        },
      ],
    });

    const activityId = await insertTestActivity(
      contactId,
      'Call',
      'Mentioned sharing proposal with VP Finance',
    );
    await analyzeContactSignals({
      activityId,
      contactId,
      notes: 'Mentioned sharing proposal with VP Finance',
      subject: 'Call',
    });

    const status = await getContactChampionBlockerStatus(contactId);
    expect(status.status).toBe('likely_champion');
    expect(status.recent_signals).toHaveLength(1);
    expect(status.recent_signals[0].description).toContain('VP Finance');
  });

  it('leaves the contact neutral when no signal is detected', async () => {
    const contactId = await createTestContact();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 30, output_tokens: 10 },
      content: [
        {
          type: 'tool_use',
          name: 'report_champion_blocker_signal',
          input: { signal_detected: false },
        },
      ],
    });

    const activityId = await insertTestActivity(contactId, 'Call', 'Discussed pricing details.');
    await analyzeContactSignals({
      activityId,
      contactId,
      notes: 'Discussed pricing details.',
      subject: 'Call',
    });

    const status = await getContactChampionBlockerStatus(contactId);
    expect(status.status).toBe('neutral');
  });

  it('escalates to champion after two independent champion signals', async () => {
    const contactId = await createTestContact();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 30, output_tokens: 10 },
      content: [
        {
          type: 'tool_use',
          name: 'report_champion_blocker_signal',
          input: { signal_detected: true, direction: 'champion', description: 'Signal one' },
        },
      ],
    });
    const activityId1 = await insertTestActivity(contactId, 'Call', 'Signal one');
    await analyzeContactSignals({
      activityId: activityId1,
      contactId,
      notes: 'Signal one',
      subject: 'Call',
    });

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 30, output_tokens: 10 },
      content: [
        {
          type: 'tool_use',
          name: 'report_champion_blocker_signal',
          input: { signal_detected: true, direction: 'champion', description: 'Signal two' },
        },
      ],
    });
    const activityId2 = await insertTestActivity(contactId, 'Call', 'Signal two');
    await analyzeContactSignals({
      activityId: activityId2,
      contactId,
      notes: 'Signal two',
      subject: 'Call',
    });

    const status = await getContactChampionBlockerStatus(contactId);
    expect(status.status).toBe('champion');
    // Most recent signal first
    expect(status.recent_signals[0].description).toBe('Signal two');
  });
});

describe('dismissContactClassification / overrideContactClassification', () => {
  it('dismissal suppresses the classification without changing the underlying status', async () => {
    const contactId = await createTestContact();
    await overrideContactClassification(contactId, 'champion', null, {
      id: ownerId,
      name: OWNER_USER.name,
    });

    let status = await getContactChampionBlockerStatus(contactId);
    expect(status.dismissed).toBe(false);

    await dismissContactClassification(contactId, { id: ownerId, name: OWNER_USER.name });
    status = await getContactChampionBlockerStatus(contactId);
    expect(status.dismissed).toBe(true);
    // Override status is still reported — dismissal is a separate feedback signal per the ticket.
    expect(status.status).toBe('champion');
  });

  it('override takes precedence over the AI-inferred status', async () => {
    const contactId = await createTestContact();

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 30, output_tokens: 10 },
      content: [
        {
          type: 'tool_use',
          name: 'report_champion_blocker_signal',
          input: { signal_detected: true, direction: 'blocker', description: 'Blocker signal' },
        },
      ],
    });
    const blockerActivityId = await insertTestActivity(contactId, 'Call', 'Blocker signal');
    await analyzeContactSignals({
      activityId: blockerActivityId,
      contactId,
      notes: 'Blocker signal',
      subject: 'Call',
    });

    let status = await getContactChampionBlockerStatus(contactId);
    expect(status.status).toBe('likely_blocker');
    expect(status.is_overridden).toBe(false);

    await overrideContactClassification(contactId, 'neutral', 'Not accurate — this was sarcasm', {
      id: ownerId,
      name: OWNER_USER.name,
    });
    status = await getContactChampionBlockerStatus(contactId);
    expect(status.status).toBe('neutral');
    expect(status.is_overridden).toBe(true);
  });
});

describe('getDealStakeholderMap', () => {
  it('flags single-threaded risk for a high-value deal with exactly one engaged contact', async () => {
    const contactId = await createTestContact();
    const deal = await createDeal(
      {
        name: 'High Value Deal',
        stage: 'Prospecting',
        pipeline_id: defaultPipelineId,
        owner_id: ownerId,
        value: 50000,
      },
      { id: ownerId, name: OWNER_USER.name },
    );
    await linkContactToDeal(deal.id, contactId);

    const map = await getDealStakeholderMap(deal.id);
    expect(map.contacts).toHaveLength(1);
    expect(map.single_threaded_risk).toBe(true);
  });

  it('does not flag single-threaded risk for a low-value deal', async () => {
    const contactId = await createTestContact();
    const deal = await createDeal(
      {
        name: 'Low Value Deal',
        stage: 'Prospecting',
        pipeline_id: defaultPipelineId,
        owner_id: ownerId,
        value: 500,
      },
      { id: ownerId, name: OWNER_USER.name },
    );
    await linkContactToDeal(deal.id, contactId);

    const map = await getDealStakeholderMap(deal.id);
    expect(map.single_threaded_risk).toBe(false);
  });

  it('does not flag single-threaded risk when multiple contacts are engaged', async () => {
    const contactId1 = await createTestContact();
    const contactId2 = await createTestContact();
    const deal = await createDeal(
      {
        name: 'Multi Contact Deal',
        stage: 'Prospecting',
        pipeline_id: defaultPipelineId,
        owner_id: ownerId,
        value: 50000,
      },
      { id: ownerId, name: OWNER_USER.name },
    );
    await linkContactToDeal(deal.id, contactId1);
    await linkContactToDeal(deal.id, contactId2);

    const map = await getDealStakeholderMap(deal.id);
    expect(map.contacts).toHaveLength(2);
    expect(map.single_threaded_risk).toBe(false);
  });
});
