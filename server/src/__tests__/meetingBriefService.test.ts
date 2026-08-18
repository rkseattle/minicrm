/**
 * Integration tests for meetingBriefService.
 *
 * Runs against a real PostgreSQL test database for all contact/account/deal/
 * activity data. The Anthropic SDK is mocked so no real API calls are made.
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
import { createDeal } from '../services/dealService.js';
import { createActivity } from '../services/activityService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import { generateMeetingBrief, getMeetingBrief } from '../services/meetingBriefService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';

const FILE_PREFIX = 'meeting-brief-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Meeting Brief Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let defaultPipelineId: string;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM activity_meeting_briefs
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
  // web_search_enabled defaults to false — most tests don't exercise the news hook.
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2, model = 'claude-sonnet-4-20250514', web_search_enabled = false`,
    [ciphertext, keyVersion],
  );
  // This file calls the real createActivity() with a contact_id set (required for a brief),
  // which fires both analyzeContactSignals and scoreActivitySentiment fire-and-forget after
  // every insert. With ai_configuration.enabled=true above, those background hooks would
  // otherwise call the same mocked Anthropic client and pollute mockCreate's call count/args
  // for this file's own assertions.
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
  // Restore the flags disabled in beforeEach — feature_flags is a shared global table and
  // this file runs serially alongside every other test file, so leaving them disabled would
  // break unrelated later suites (e.g. championBlockerService/-Controller, sentimentService).
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
      title: 'VP Sales',
    },
    { id: ownerId, name: OWNER_USER.name },
  );
  return contact.id;
}

function mockBriefResponse(overrides: Partial<Record<string, unknown>> = {}): void {
  mockCreate.mockResolvedValue({
    usage: { input_tokens: 100, output_tokens: 50 },
    content: [
      {
        type: 'tool_use',
        name: 'report_meeting_brief',
        input: {
          account_summary: 'Mid-size company, growing engagement over the last quarter.',
          recent_activity_summary: ['Discussed renewal pricing.'],
          suggested_talking_points: [
            'Confirm budget owner.',
            'Review contract terms.',
            'Set next steps.',
          ],
          next_steps: [],
          ...overrides,
        },
      },
    ],
  });
}

describe('generateMeetingBrief', () => {
  it('returns null when the activity does not exist', async () => {
    const result = await generateMeetingBrief(
      '00000000-0000-0000-0000-000000000000',
      ownerId,
      OWNER_USER.role,
    );
    expect(result).toBeNull();
  });

  it('returns null when the activity has no linked contact', async () => {
    const account = await createAccount(
      { name: `Acme-${Date.now()}`, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );
    const activity = await createActivity(
      { type: 'Call', subject: 'Internal sync', account_id: account.id, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );

    const result = await generateMeetingBrief(activity.id, ownerId, OWNER_USER.role);
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('gathers context, calls Claude via a forced tool call, and returns + persists the structured brief', async () => {
    const contactId = await createTestContact();
    const deal = await createDeal(
      {
        name: 'Acme Renewal',
        stage: 'Proposal',
        value: 25000,
        pipeline_id: defaultPipelineId,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );
    await pool.query('INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2)', [
      deal.id,
      contactId,
    ]);
    const activity = await createActivity(
      { type: 'Call', subject: 'Upcoming renewal call', contact_id: contactId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockBriefResponse({ next_steps: [{ deal_id: deal.id, next_step: 'Send updated proposal.' }] });

    const result = await generateMeetingBrief(activity.id, ownerId, OWNER_USER.role);

    expect(result).not.toBeNull();
    expect(result?.brief.contact_snapshot.title).toBe('VP Sales');
    expect(result?.brief.account_summary).toContain('growing engagement');
    expect(result?.brief.open_opportunities).toHaveLength(1);
    expect(result?.brief.open_opportunities[0].next_step).toBe('Send updated proposal.');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const persisted = await getMeetingBrief(activity.id);
    expect(persisted?.brief.account_summary).toBe(result?.brief.account_summary);
  });

  // ── AI follow-up timing suggestion integration ────────────────────

  it('includes the follow-up timing suggestion when the flag is enabled and a suggestion exists', async () => {
    const contactId = await createTestContact();
    const activity = await createActivity(
      { type: 'Call', subject: 'Upcoming call', contact_id: contactId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );
    // 5 Tuesdays at 14:00 UTC — enough Inbound interactions for a cached suggestion.
    const tuesdays = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03'];
    for (const date of tuesdays) {
      await pool.query(
        `INSERT INTO activities (type, subject, direction, contact_id, owner_id, created_at)
         VALUES ('Call', 'Sync', 'Inbound', $1, $2, ($3::date + time '14:00')::timestamptz)`,
        [contactId, ownerId, date],
      );
    }

    mockBriefResponse();
    const result = await generateMeetingBrief(activity.id, ownerId, OWNER_USER.role);

    expect(result?.brief.followup_timing).toBeDefined();
    expect(result?.brief.followup_timing?.day_of_week).toBe(2);
  });

  it('omits the follow-up timing suggestion when ai_followup_timing_suggestions is disabled', async () => {
    await pool.query(
      `UPDATE feature_flags SET enabled = false WHERE flag_key = 'ai_followup_timing_suggestions'`,
    );
    invalidateFeatureFlagCache();
    try {
      const contactId = await createTestContact();
      const activity = await createActivity(
        { type: 'Call', subject: 'Upcoming call', contact_id: contactId, owner_id: ownerId },
        { id: ownerId, name: OWNER_USER.name },
      );
      const tuesdays = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03'];
      for (const date of tuesdays) {
        await pool.query(
          `INSERT INTO activities (type, subject, direction, contact_id, owner_id, created_at)
           VALUES ('Call', 'Sync', 'Inbound', $1, $2, ($3::date + time '14:00')::timestamptz)`,
          [contactId, ownerId, date],
        );
      }

      mockBriefResponse();
      const result = await generateMeetingBrief(activity.id, ownerId, OWNER_USER.role);

      expect(result?.brief.followup_timing).toBeUndefined();
    } finally {
      await pool.query(
        `UPDATE feature_flags SET enabled = true WHERE flag_key = 'ai_followup_timing_suggestions'`,
      );
      invalidateFeatureFlagCache();
    }
  });

  it('overwrites the prior brief on regenerate rather than appending', async () => {
    const contactId = await createTestContact();
    const activity = await createActivity(
      { type: 'Meeting', subject: 'Kickoff', contact_id: contactId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockBriefResponse({ account_summary: 'First version.' });
    await generateMeetingBrief(activity.id, ownerId, OWNER_USER.role);

    mockBriefResponse({ account_summary: 'Second version.' });
    await generateMeetingBrief(activity.id, ownerId, OWNER_USER.role);

    const rows = await pool.query(
      'SELECT COUNT(*) AS count FROM activity_meeting_briefs WHERE activity_id = $1',
      [activity.id],
    );
    expect(Number(rows.rows[0].count)).toBe(1);

    const persisted = await getMeetingBrief(activity.id);
    expect(persisted?.brief.account_summary).toBe('Second version.');
  });

  it('throws a 503 when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);
    const contactId = await createTestContact();
    const activity = await createActivity(
      { type: 'Call', subject: 'Call', contact_id: contactId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );

    await expect(generateMeetingBrief(activity.id, ownerId, OWNER_USER.role)).rejects.toMatchObject(
      {
        statusCode: 503,
      },
    );
  });

  it('does not attempt a news search when web_search_enabled is false', async () => {
    const contactId = await createTestContact();
    const activity = await createActivity(
      { type: 'Call', subject: 'Call', contact_id: contactId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockBriefResponse();
    const result = await generateMeetingBrief(activity.id, ownerId, OWNER_USER.role);

    expect(result?.brief.news_hook).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('includes a news hook when web_search_enabled is true and results are found', async () => {
    const account = await createAccount(
      { name: `Acme-${Date.now()}`, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );
    const contactId = await createTestContact(account.id);
    const activity = await createActivity(
      { type: 'Call', subject: 'Call', contact_id: contactId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );
    await pool.query(`UPDATE ai_configuration SET web_search_enabled = true`);

    mockCreate
      .mockResolvedValueOnce({
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [
          {
            type: 'tool_use',
            name: 'report_meeting_brief',
            input: {
              account_summary: 'Summary.',
              recent_activity_summary: [],
              suggested_talking_points: ['Point one.', 'Point two.', 'Point three.'],
              next_steps: [],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        usage: { input_tokens: 30, output_tokens: 10 },
        content: [
          {
            type: 'web_search_tool_result',
            content: [
              {
                type: 'web_search_result',
                title: 'Acme raises Series B',
                url: 'https://news.example.com/acme-series-b',
                page_age: '2 days ago',
                encrypted_content: 'stub',
              },
            ],
          },
        ],
      });

    const result = await generateMeetingBrief(activity.id, ownerId, OWNER_USER.role);

    expect(result?.brief.news_hook).toHaveLength(1);
    expect(result?.brief.news_hook?.[0].title).toBe('Acme raises Series B');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('omits the news hook (does not fail the brief) when the search errors', async () => {
    const account = await createAccount(
      { name: `Acme-${Date.now()}`, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );
    const contactId = await createTestContact(account.id);
    const activity = await createActivity(
      { type: 'Call', subject: 'Call', contact_id: contactId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );
    await pool.query(`UPDATE ai_configuration SET web_search_enabled = true`);

    mockCreate
      .mockResolvedValueOnce({
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [
          {
            type: 'tool_use',
            name: 'report_meeting_brief',
            input: {
              account_summary: 'Summary.',
              recent_activity_summary: [],
              suggested_talking_points: ['Point one.', 'Point two.', 'Point three.'],
              next_steps: [],
            },
          },
        ],
      })
      .mockRejectedValueOnce(new Error('search unavailable'));

    const result = await generateMeetingBrief(activity.id, ownerId, OWNER_USER.role);

    expect(result).not.toBeNull();
    expect(result?.brief.news_hook).toBeUndefined();
  });
});

describe('getMeetingBrief', () => {
  it('returns null when no brief has been generated', async () => {
    const contactId = await createTestContact();
    const activity = await createActivity(
      { type: 'Call', subject: 'Call', contact_id: contactId, owner_id: ownerId },
      { id: ownerId, name: OWNER_USER.name },
    );

    const result = await getMeetingBrief(activity.id);
    expect(result).toBeNull();
  });
});
