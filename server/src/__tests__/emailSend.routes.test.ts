/**
 * The per-user hourly send limiter on POST /api/v1/email-messages/send.
 *
 * The Gmail driver is replaced at its constructor, so a send succeeds without leaving the
 * machine: the limiter counts only successful sends, so only those can reach its ceiling.
 */

import 'dotenv/config';

import request from 'supertest';
import { vi } from 'vitest';

import app from '../app.js';
import pool from '../db.js';
import { DEFAULT_EMAIL_SEND_MAX_PER_HOUR, emailSendMaxPerHour } from '../routes/emailMessages.js';
import { upsertOAuthAccount } from '../services/connectedAccountService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';
import type * as EmailMatchingModule from '../services/emailMatchingService.js';
import type * as GmailProviderModule from '../services/mail/gmailProvider.js';
import { createUser } from '../services/userService.js';

import { clearAuditLogFor, makeAuthCookie } from './testUtils.js';

let sentCount = 0;
const matchFailure = vi.hoisted(() => ({ next: null as Error | null }));

// Fails storage after a send that went, which is the one failure that must spend budget.
vi.mock('../services/emailMatchingService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof EmailMatchingModule>();
  return {
    ...actual,
    matchMessagesToRecords: (...args: Parameters<typeof actual.matchMessagesToRecords>) => {
      const failure = matchFailure.next;
      matchFailure.next = null;
      return failure ? Promise.reject(failure) : actual.matchMessagesToRecords(...args);
    },
  };
});

vi.mock('../services/mail/gmailProvider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof GmailProviderModule>();
  return {
    ...actual,
    createGmailProvider: () => ({
      fetchSince: () => Promise.reject(new Error('not under test')),
      send: () => {
        sentCount += 1;
        return Promise.resolve({ providerMessageId: `limit-${String(sentCount)}`, threadId: null });
      },
    }),
  };
});

const FILE_PREFIX = 'emailsendlimit';
const SEND_URL = '/api/v1/email-messages/send';
const CEILING = 3;

const createdUserIds: string[] = [];

/** A user with a connected mailbox, ready to send. */
async function sender(local: string): Promise<{ cookie: string; accountId: string }> {
  const user = await createUser({
    email: `${FILE_PREFIX}-${local}@example.com`,
    name: 'Limit Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  createdUserIds.push(user.id);
  const account = await upsertOAuthAccount(
    {
      userId: user.id,
      provider: 'google',
      emailAddress: `${FILE_PREFIX}-${local}-mailbox@example.com`,
      grantedScopes: [],
      auth: {
        kind: 'oauth',
        access_token: 'still-valid',
        refresh_token: 'refresh',
        expires_at: Date.now() + 24 * 60 * 60 * 1000,
      },
    },
    { id: user.id, name: user.name },
  );
  await pool.query(
    `UPDATE connected_accounts SET sync_next_attempt_at = NOW() + interval '1 day'
      WHERE id = $1`,
    [account.id],
  );
  return {
    cookie: makeAuthCookie({ id: user.id, email: user.email, name: user.name, role: user.role }),
    accountId: account.id,
  };
}

async function sendStatuses(
  from: { cookie: string; accountId: string },
  count: number,
  payload: Record<string, unknown> | null = null,
): Promise<number[]> {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < count; attempt += 1) {
    const res = await request(app)
      .post(SEND_URL)
      .set('Cookie', from.cookie)
      .send(
        payload ?? {
          connected_account_id: from.accountId,
          to: ['someone@example.net'],
          subject: `Hello ${String(attempt)}`,
          body_html: '<p>Hi</p>',
        },
      );
    statuses.push(res.status);
  }
  return statuses;
}

beforeAll(async () => {
  await pool.query(`DELETE FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'email_sync'`);
  invalidateFeatureFlagCache();
});

afterEach(() => {
  delete process.env.TEST_RATE_LIMIT;
  delete process.env.EMAIL_SEND_MAX_PER_HOUR;
});

afterAll(async () => {
  for (const id of createdUserIds) await clearAuditLogFor(id);
  await pool.query('DELETE FROM connected_accounts WHERE user_id = ANY($1::uuid[])', [
    createdUserIds,
  ]);
  await pool.query(`DELETE FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
  await pool.end();
});

describe('email send limiter', () => {
  it('refuses the send past the ceiling with 429 RATE_LIMITED', async () => {
    process.env.TEST_RATE_LIMIT = 'true';
    process.env.EMAIL_SEND_MAX_PER_HOUR = String(CEILING);
    const from = await sender('ceiling');

    const statuses = await sendStatuses(from, CEILING);
    const blocked = await request(app)
      .post(SEND_URL)
      .set('Cookie', from.cookie)
      .send({
        connected_account_id: from.accountId,
        to: ['someone@example.net'],
        subject: 'One too many',
        body_html: '<p>Hi</p>',
      });

    expect(statuses).toEqual(Array(CEILING).fill(201));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('does not spend the budget on requests that fail', async () => {
    process.env.TEST_RATE_LIMIT = 'true';
    process.env.EMAIL_SEND_MAX_PER_HOUR = String(CEILING);
    const from = await sender('failures');

    const failures = await sendStatuses(from, CEILING + 2, {});
    const [status] = await sendStatuses(from, 1);

    expect(failures.every((code) => code === 400)).toBe(true);
    expect(status).toBe(201);
  });

  it('spends budget on a send that went out but could not be stored', async () => {
    process.env.TEST_RATE_LIMIT = 'true';
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';
    const from = await sender('unrecorded');
    matchFailure.next = new Error('storage down');

    const statuses = await sendStatuses(from, 2);

    expect(statuses).toEqual([500, 429]);
  });

  it('counts each user separately', async () => {
    process.env.TEST_RATE_LIMIT = 'true';
    process.env.EMAIL_SEND_MAX_PER_HOUR = String(CEILING);
    await sendStatuses(await sender('first'), CEILING + 1);

    const [status] = await sendStatuses(await sender('second'), 1);

    expect(status).toBe(201);
  });

  it('is bypassed under the test environment unless TEST_RATE_LIMIT is set', async () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '1';

    const statuses = await sendStatuses(await sender('bypass'), 3);

    expect(statuses).toEqual([201, 201, 201]);
  });
});

describe('emailSendMaxPerHour', () => {
  it('reads a positive integer override', () => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = '25';

    expect(emailSendMaxPerHour()).toBe(25);
  });

  it.each(['', '0', '-5', '2.5', 'many'])('falls back to the default for %j', (value) => {
    process.env.EMAIL_SEND_MAX_PER_HOUR = value;

    expect(emailSendMaxPerHour()).toBe(DEFAULT_EMAIL_SEND_MAX_PER_HOUR);
  });

  it('uses the default when unset', () => {
    expect(emailSendMaxPerHour()).toBe(DEFAULT_EMAIL_SEND_MAX_PER_HOUR);
  });
});
