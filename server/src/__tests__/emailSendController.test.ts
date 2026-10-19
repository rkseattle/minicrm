/**
 * HTTP contract tests for POST /api/v1/email-messages/send.
 *
 * The Gmail driver is replaced at its constructor so a request runs the real controller,
 * service, and database while nothing leaves the machine.
 */

import 'dotenv/config';

import { sendEmailSchema } from '@minicrm/shared/schemas/emailMessageSchema.js';

import { randomUUID } from 'node:crypto';

import { requestHashOf } from '../services/emailSendService.js';

import request from 'supertest';
import { vi } from 'vitest';

import app from '../app.js';
import pool from '../db.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';
import { createImapAccount, upsertOAuthAccount } from '../services/connectedAccountService.js';
import {
  sendFailure,
  SEND_AUTH_EXPIRED,
  SEND_NOT_SENT,
  SEND_RATE_LIMITED,
  SEND_SCOPE_MISSING,
  type SendFailureCode,
} from '../services/mail/sendOutcome.js';
import type * as EmailMatchingModule from '../services/emailMatchingService.js';
import type * as GmailProviderModule from '../services/mail/gmailProvider.js';
import { createUser } from '../services/userService.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

import { clearAuditLogFor, makeAuthCookie } from './testUtils.js';

const sendMock = vi.hoisted(() => vi.fn());
const matchFailure = vi.hoisted(() => ({ next: null as Error | null }));

// Lets one test fail the storage transaction after a successful send, which no request
// shape can do: the controller refuses every record that would fail a foreign key.
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
      send: sendMock,
    }),
  };
});

const FILE_PREFIX = 'emailsendctl';
const SEND_URL = '/api/v1/email-messages/send';

let repId: string;
let repCookie: string;
let otherId: string;
let otherCookie: string;
let gmailAccountId: string;
let imapAccountId: string;
let contactId: string;
let ownContactId: string;
let noActivityCookie: string;
let noActivityAccountId: string;
let noActivityRoleId: string;

async function deleteFixtures(): Promise<void> {
  await pool.query(`DELETE FROM contacts WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connected_account_id: gmailAccountId,
    to: ['someone@example.net'],
    subject: 'Hello',
    body_html: '<p>Typed.</p>',
    ...overrides,
  };
}

beforeAll(async () => {
  await deleteFixtures();
  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Send Ctl Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
  const other = await createUser({
    email: `${FILE_PREFIX}-other@example.com`,
    name: 'Send Ctl Other',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherId = other.id;
  otherCookie = makeAuthCookie({
    id: other.id,
    email: other.email,
    name: other.name,
    role: other.role,
  });

  const actor = { id: rep.id, name: rep.name };
  gmailAccountId = (
    await upsertOAuthAccount(
      {
        userId: repId,
        provider: 'google',
        emailAddress: `${FILE_PREFIX}-mailbox@example.com`,
        grantedScopes: [],
        auth: {
          kind: 'oauth',
          access_token: 'still-valid',
          refresh_token: 'refresh',
          expires_at: Date.now() + 24 * 60 * 60 * 1000,
        },
      },
      actor,
    )
  ).id;
  imapAccountId = (
    await createImapAccount(
      repId,
      {
        email_address: `${FILE_PREFIX}-imap@example.com`,
        host: 'imap.example.com',
        port: 993,
        username: `${FILE_PREFIX}-imap@example.com`,
        password: 'a-very-secret-password',
        secure: true,
      },
      actor,
    )
  ).id;
  // Out of the scheduler's reach: another suite's tick must not try to sync these.
  await pool.query(
    `UPDATE connected_accounts SET sync_next_attempt_at = NOW() + interval '1 day'
      WHERE user_id = $1`,
    [repId],
  );

  const contact = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Ctl', 'Contact', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-contact@example.com`, otherId],
  );
  contactId = contact.rows[0]!.id;
  const own = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Own', 'Contact', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-own@example.com`, repId],
  );
  ownContactId = own.rows[0]!.id;

  // A custom role that may send and edit contacts but not log activities.
  const limited = await createUser({
    email: `${FILE_PREFIX}-limited@example.com`,
    name: 'Send Ctl Limited',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  noActivityCookie = makeAuthCookie({
    id: limited.id,
    email: limited.email,
    name: limited.name,
    role: limited.role,
  });
  const role = await pool.query<{ id: string }>(
    `INSERT INTO custom_roles (name, description, is_builtin)
     VALUES ($1, 'send without activities', false) RETURNING id`,
    [`${FILE_PREFIX}-no-activities`],
  );
  noActivityRoleId = role.rows[0]!.id;
  await pool.query(
    `INSERT INTO role_capabilities (role_id, capability)
     SELECT $1, unnest($2::text[])`,
    [
      noActivityRoleId,
      [Capability.ConnectedAccountsManage, Capability.ContactsEdit, Capability.ContactsView],
    ],
  );
  await pool.query('INSERT INTO user_custom_roles (user_id, role_id) VALUES ($1, $2)', [
    limited.id,
    noActivityRoleId,
  ]);
  noActivityAccountId = (
    await upsertOAuthAccount(
      {
        userId: limited.id,
        provider: 'google',
        emailAddress: `${FILE_PREFIX}-limited-mailbox@example.com`,
        grantedScopes: [],
        auth: {
          kind: 'oauth',
          access_token: 'still-valid',
          refresh_token: 'refresh',
          expires_at: Date.now() + 24 * 60 * 60 * 1000,
        },
      },
      { id: limited.id, name: limited.name },
    )
  ).id;
  await pool.query(
    `UPDATE connected_accounts SET sync_next_attempt_at = NOW() + interval '1 day'
      WHERE id = $1`,
    [noActivityAccountId],
  );
});

beforeEach(async () => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({
    providerMessageId: `ctl-${String(Date.now())}-${Math.random()}`,
    threadId: null,
  });
  await pool.query('DELETE FROM email_messages WHERE connected_account_id = $1', [gmailAccountId]);
  await pool.query(
    `UPDATE connected_accounts SET status = 'active', status_detail = NULL
                     WHERE id = $1`,
    [gmailAccountId],
  );
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'email_sync'`);
  invalidateFeatureFlagCache();
});

afterAll(async () => {
  await pool.query(
    `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'contact'`,
  );
  await pool.query('DELETE FROM activities WHERE owner_id = $1', [repId]);
  await clearAuditLogFor(repId);
  await pool.query('DELETE FROM connected_accounts WHERE user_id = $1', [repId]);
  await pool.query('DELETE FROM connected_accounts WHERE id = $1', [noActivityAccountId]);
  await pool.query('DELETE FROM custom_roles WHERE id = $1', [noActivityRoleId]);
  await deleteFixtures();
  await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
  await pool.end();
});

describe('POST /api/v1/email-messages/send — boundaries', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post(SEND_URL).set('Idempotency-Key', randomUUID()).send(body());

    expect(res.status).toBe(401);
  });

  it('returns 403 when email sync is disabled', async () => {
    await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
    invalidateFeatureFlagCache();

    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(body());

    expect(res.status).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each([
    ['no recipient', { to: [] }],
    ['a malformed recipient', { to: ['not-an-address'] }],
    ['no subject', { subject: undefined }],
    ['a template alongside typed text', { template_id: '00000000-0000-4000-8000-000000000001' }],
    ['a record type with no id', { record_type: 'contact' }],
  ])('returns 400 VALIDATION_ERROR for %s', async (_label, overrides) => {
    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(body(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("answers another user's mailbox as absent", async () => {
    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', otherCookie)
      .send(body());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EMAIL_ACCOUNT_NOT_FOUND');
  });

  it('returns 404 for a record that does not exist', async () => {
    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(body({ record_type: 'contact', record_id: '00000000-0000-4000-8000-000000000002' }));

    expect(res.status).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 403 when sending from a record would log an activity the caller may not create', async () => {
    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', noActivityCookie)
      .send(
        body({
          connected_account_id: noActivityAccountId,
          record_type: 'contact',
          record_id: ownContactId,
        }),
      );

    expect(res.status).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 403 for a record the caller cannot see, without sending', async () => {
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'contact'`,
    );
    try {
      const res = await request(app)
        .post(SEND_URL)
        .set('Idempotency-Key', randomUUID())
        .set('Cookie', repCookie)
        .send(body({ record_type: 'contact', record_id: contactId }));

      expect(res.status).toBe(403);
      expect(sendMock).not.toHaveBeenCalled();
    } finally {
      await pool.query(
        `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'contact'`,
      );
    }
  });
});

describe('POST /api/v1/email-messages/send — outcomes', () => {
  it('returns 201 with the stored message', async () => {
    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(body());

    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({
      connected_account_id: gmailAccountId,
      direction: 'outbound',
      subject: 'Hello',
    });
    expect(res.body.unresolved_merge_tags).toEqual([]);
  });

  it('returns 409 PROVIDER_SEND_UNSUPPORTED for an IMAP mailbox', async () => {
    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(body({ connected_account_id: imapAccountId }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROVIDER_SEND_UNSUPPORTED');
  });

  it('returns 502 SEND_FAILED when the provider refuses', async () => {
    sendMock.mockRejectedValue(sendFailure(SEND_NOT_SENT, 'Gmail'));

    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(body());

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('SEND_FAILED');
  });

  it('returns 409 PROVIDER_AUTH_EXPIRED, never 401, when the mailbox credential is refused', async () => {
    sendMock.mockRejectedValue(sendFailure(SEND_AUTH_EXPIRED, 'Gmail'));

    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(body());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROVIDER_AUTH_EXPIRED');
  });

  it.each<[SendFailureCode, number, string]>([
    [SEND_SCOPE_MISSING, 409, 'RECONNECT_REQUIRED'],
    [SEND_RATE_LIMITED, 429, 'RATE_LIMITED'],
  ])('maps the driver code %s to %i %s', async (driverCode, status, code) => {
    sendMock.mockRejectedValue(sendFailure(driverCode, 'Gmail'));

    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(body());

    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  });

  it('returns 404 TEMPLATE_NOT_FOUND for a template that does not exist', async () => {
    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(
        body({
          subject: undefined,
          body_html: undefined,
          template_id: '00000000-0000-4000-8000-000000000003',
          record_type: 'contact',
          record_id: ownContactId,
        }),
      );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('returns 404 EMAIL_MESSAGE_NOT_FOUND for a reply to an unknown message', async () => {
    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(body({ in_reply_to_message_id: '00000000-0000-4000-8000-000000000004' }));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EMAIL_MESSAGE_NOT_FOUND');
  });

  it('returns 500 SENT_NOT_RECORDED when storage fails after the provider accepted', async () => {
    matchFailure.next = new Error('storage down');

    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(body());

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('SENT_NOT_RECORDED');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('lets an unclassified failure reach the error handler as a 500', async () => {
    sendMock.mockRejectedValue(new Error('driver bug'));

    const res = await request(app)
      .post(SEND_URL)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', repCookie)
      .send(body());

    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/email-messages/send — idempotency', () => {
  it('requires an Idempotency-Key', async () => {
    const res = await request(app).post(SEND_URL).set('Cookie', repCookie).send(body());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses a key that is not a UUID', async () => {
    const res = await request(app)
      .post(SEND_URL)
      .set('Cookie', repCookie)
      .set('Idempotency-Key', 'not-a-uuid')
      .send(body());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('answers a repeat as the first send did, even after its record was deleted', async () => {
    const created = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Re', 'Play', $1, $2) RETURNING id`,
      [`${FILE_PREFIX}-replay@example.com`, repId],
    );
    const recordId = created.rows[0]!.id; // Safe: an INSERT … RETURNING returns its one row.
    const key = randomUUID();
    const payload = body({ record_type: 'contact', record_id: recordId });
    const send = () =>
      request(app)
        .post(SEND_URL)
        .set('Cookie', repCookie)
        .set('Idempotency-Key', key)
        .send(payload);

    const first = await send();
    await pool.query('DELETE FROM activities WHERE contact_id = $1', [recordId]);
    await pool.query('DELETE FROM contacts WHERE id = $1', [recordId]);
    const repeat = await send();

    expect(first.status).toBe(201);
    expect(repeat.status).toBe(201);
    expect(repeat.body.message.id).toBe(first.body.message.id);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pending', 'SEND_IN_PROGRESS'],
    ['sent', 'SEND_ALREADY_SENT'],
    ['unconfirmed', 'SEND_UNCONFIRMED'],
  ])('answers a repeat of a %s send with 409 %s, sending nothing', async (status, code) => {
    const key = randomUUID();
    await pool.query(
      `INSERT INTO email_send_intents
         (idempotency_key, request_hash, user_id, actor_name, connected_account_id,
          rfc_message_id, status)
       VALUES ($1, $2, $3, 'Send Ctl Rep', $4, $5, $6)`,
      [
        key,
        requestHashOf(sendEmailSchema.parse(body())),
        repId,
        gmailAccountId,
        `${key}@x`,
        status,
      ],
    );

    const res = await request(app)
      .post(SEND_URL)
      .set('Cookie', repCookie)
      .set('Idempotency-Key', key)
      .send(body());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(code);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses a key reused for a different message with 422', async () => {
    const key = randomUUID();
    await request(app)
      .post(SEND_URL)
      .set('Cookie', repCookie)
      .set('Idempotency-Key', key)
      .send(body());

    const res = await request(app)
      .post(SEND_URL)
      .set('Cookie', repCookie)
      .set('Idempotency-Key', key)
      .send(body({ subject: 'Something else' }));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
