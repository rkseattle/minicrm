/**
 * Unit tests for framework/fakes/mail-provider-emulator.ts, driven over real HTTP on an
 * ephemeral port. No app, database, or provider is involved.
 */

import { test, expect } from '@framework/fixtures';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createMailProviderEmulator,
  MAX_BODY_BYTES,
} from '@framework/fakes/mail-provider-emulator';

const TOKEN = 'token-rep';
const ADDRESS = 'rep@example.test';
const GMAIL = '/gmail/v1/users/me';
const GRAPH = '/v1.0/me';
const PAGE_OF_ONE = 'odata.maxpagesize=1';

type Json = Record<string, unknown>;

let server: Server;
let base: string;

function rfc822(subject: string, extraHeaders: string[] = []): string {
  const headers = [
    'From: buyer@customer.test',
    `To: ${ADDRESS}`,
    `Subject: ${subject}`,
    `Message-ID: <${subject.replace(/\s/g, '-')}@customer.test>`,
    ...extraHeaders,
  ];
  return `${headers.join('\r\n')}\r\n\r\nBody of ${subject}`;
}

/** Reads a response field as the type the test expects of it. */
function field<T>(body: Json, key: string): T {
  // Safe: each caller asserts on the value, so a wrong type fails the test, not the cast.
  return body[key] as T;
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; raw?: string; token?: string | null; prefer?: string } = {},
): Promise<{ status: number; json: Json; text: string }> {
  const headers: Record<string, string> = {};
  const token = options.token === undefined ? TOKEN : options.token;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.prefer) headers['Prefer'] = options.prefer;
  let body: string | undefined;
  if (options.raw !== undefined) {
    body = options.raw;
    headers['Content-Type'] = 'text/plain';
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${base}${path}`, { method, headers, body });
  const text = await response.text();
  // Parsed only when the emulator says it is JSON, so a malformed JSON body throws here.
  const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
  const parsed: unknown = isJson ? JSON.parse(text) : {};
  const json: Json = parsed && typeof parsed === 'object' ? { ...parsed } : {};
  return { status: response.status, json, text };
}

async function seed(subject: string, extra: Json = {}): Promise<{ id: string; threadId: string }> {
  const { json } = await call('POST', `/__admin/mailboxes/${TOKEN}/messages`, {
    body: { raw: rfc822(subject), ...extra },
  });
  return { id: field<string>(json, 'id'), threadId: field<string>(json, 'threadId') };
}

async function seedRaw(raw: string): Promise<{ id: string; threadId: string }> {
  const { json } = await call('POST', `/__admin/mailboxes/${TOKEN}/messages`, { body: { raw } });
  return { id: field<string>(json, 'id'), threadId: field<string>(json, 'threadId') };
}

function ids(body: Json, key: string): string[] {
  return field<Array<{ id: string }>>(body, key).map((entry) => entry.id);
}

function pathOf(link: unknown): string {
  const url = new URL(String(link));
  return `${url.pathname}${url.search}`;
}

test.beforeAll(async () => {
  server = createMailProviderEmulator();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  // Safe: a server listening on a TCP port reports an AddressInfo, never a pipe name.
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async () => {
  await call('POST', '/__admin/reset');
  await call('POST', '/__admin/mailboxes', { body: { token: TOKEN, address: ADDRESS } });
});

test.describe('mail provider emulator — admin', () => {
  test('answers health without a token, and 404 for an unknown prefix', async () => {
    expect((await call('GET', '/health', { token: null })).status).toBe(200);
    expect((await call('GET', '/elsewhere', { token: null })).status).toBe(404);
  });

  test('refuses a mailbox without a token or address, and a body that is not an object', async () => {
    expect((await call('POST', '/__admin/mailboxes', { body: { token: 'x' } })).status).toBe(400);
    expect((await call('POST', '/__admin/mailboxes', { raw: '{not json' })).status).toBe(400);
    expect((await call('POST', '/__admin/mailboxes', { body: [1] })).status).toBe(400);
  });

  test('refuses a seed with no raw, an unknown folder, or an unparseable date', async () => {
    const seedUrl = `/__admin/mailboxes/${TOKEN}/messages`;
    for (const body of [
      {},
      { raw: rfc822('x'), folder: 'archive' },
      { raw: rfc822('x'), receivedAt: 'garbage' },
    ]) {
      expect((await call('POST', seedUrl, { body })).status).toBe(400);
    }
    expect((await call('GET', `/__admin/mailboxes/${TOKEN}/messages`)).json['messages']).toEqual(
      [],
    );
  });

  test('answers 404 for an unknown mailbox, a malformed name, and an unknown route', async () => {
    expect(
      (await call('POST', '/__admin/mailboxes/nobody/messages', { body: { raw: 'x' } })).status,
    ).toBe(404);
    expect((await call('POST', '/__admin/mailboxes/%E0%A4%A/expire-cursors')).status).toBe(404);
    expect((await call('GET', '/__admin/nowhere')).status).toBe(404);
  });

  test('accepts a body at the size limit and refuses one a byte over', async () => {
    const seedUrl = `/__admin/mailboxes/${TOKEN}/messages`;
    // At the limit the body is read and then refused as not JSON; over it, it is never read.
    const atLimit = await call('POST', seedUrl, { raw: 'x'.repeat(MAX_BODY_BYTES) });
    const overLimit = await call('POST', seedUrl, { raw: 'x'.repeat(MAX_BODY_BYTES + 1) });
    expect(atLimit.status).toBe(400);
    expect(overLimit.status).toBe(413);
  });

  test('lists what was seeded, and reset forgets the mailbox', async () => {
    const { id } = await seed('first');
    const listed = await call('GET', `/__admin/mailboxes/${TOKEN}/messages`);
    expect(ids(listed.json, 'messages')).toEqual([id]);

    await call('POST', '/__admin/reset');
    expect((await call('GET', `${GMAIL}/profile`)).status).toBe(401);
  });

  test('runs under plain node, so a container needs no build step', () => {
    const file = pathToFileURL(join(__dirname, '../../framework/fakes/mail-provider-emulator.ts'));
    const probe = `import(${JSON.stringify(file.href)}).then((m) => process.stdout.write(typeof m.createMailProviderEmulator))`;

    const out = execFileSync(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '-e', probe],
      // Without NODE_OPTIONS, where Playwright's loader lives, or a coverage dump of a bare load.
      { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_V8_COVERAGE: '' } },
    );

    // Non-erasable syntax (an enum, a parameter property) would throw here, not in a spec.
    expect(out).toBe('function');
  });

  test('deletes one mailbox and leaves the others', async () => {
    await call('POST', '/__admin/mailboxes', { body: { token: 'other', address: 'o@x.test' } });

    expect((await call('DELETE', `/__admin/mailboxes/${TOKEN}`)).status).toBe(200);

    expect((await call('GET', `${GMAIL}/profile`)).status).toBe(401);
    expect((await call('GET', `${GMAIL}/profile`, { token: 'other' })).status).toBe(200);
    expect((await call('DELETE', `/__admin/mailboxes/${TOKEN}`)).status).toBe(404);
  });

  test('refuses to re-register a token under a different address', async () => {
    const res = await call('POST', '/__admin/mailboxes', {
      body: { token: TOKEN, address: 'someone-else@example.test' },
    });

    expect(res.status).toBe(409);
    expect((await call('GET', `${GMAIL}/profile`)).json['emailAddress']).toBe(ADDRESS);
  });

  test('files a seed into the thread it names, and refuses one that is not hex', async () => {
    const parent = await seed('anchor');

    const named = await seed('joins', { threadId: parent.threadId });
    const bad = await call('POST', `/__admin/mailboxes/${TOKEN}/messages`, {
      body: { raw: rfc822('bad'), threadId: 'thread-1' },
    });

    expect(named.threadId).toBe(parent.threadId);
    expect(bad.status).toBe(400);
  });

  test('re-registering a mailbox keeps its messages', async () => {
    await seed('kept');
    await call('POST', '/__admin/mailboxes', { body: { token: TOKEN, address: ADDRESS } });
    const listed = await call('GET', `/__admin/mailboxes/${TOKEN}/messages`);
    expect(field<unknown[]>(listed.json, 'messages')).toHaveLength(1);
  });

  test('threads a seeded reply by In-Reply-To, by References, and by a folded header', async () => {
    const parent = await seed('question');
    const byInReplyTo = await seedRaw(rfc822('r1', ['In-Reply-To: <question@customer.test>']));
    const byReferences = await seedRaw(
      rfc822('r2', ['References: <unknown@x.test> <question@customer.test>']),
    );
    const folded = await seedRaw(rfc822('r3', ['In-Reply-To:', ' <question@customer.test>']));
    const unrelated = await seed('topic');

    for (const reply of [byInReplyTo, byReferences, folded]) {
      expect(reply.threadId).toBe(parent.threadId);
    }
    expect(unrelated.threadId).toMatch(/^[0-9a-f]+$/);
    expect(unrelated.threadId).not.toBe(parent.threadId);
  });

  test('mints lowercase hex ids, the form Gmail ids take', async () => {
    const { id, threadId } = await seed('hex');
    expect(id).toMatch(/^[0-9a-f]+$/);
    expect(threadId).toMatch(/^[0-9a-f]+$/);
  });
});

test.describe('mail provider emulator — Gmail', () => {
  test('refuses an unknown token, and a missing one, with 401', async () => {
    expect((await call('GET', `${GMAIL}/profile`, { token: 'stranger' })).status).toBe(401);
    expect((await call('GET', `${GMAIL}/profile`, { token: null })).status).toBe(401);
  });

  test('profile reports the address and a historyId that advances per message', async () => {
    const before = (await call('GET', `${GMAIL}/profile`)).json;
    await seed('one');
    const after = (await call('GET', `${GMAIL}/profile`)).json;
    expect(before['emailAddress']).toBe(ADDRESS);
    expect(Number(after['historyId'])).toBe(Number(before['historyId']) + 1);
  });

  test('lists newest first, one page at a time, honouring after:', async () => {
    await seed('old', { receivedAt: '2020-01-01T00:00:00Z' });
    const a = await seed('a');
    const b = await seed('b');
    const query = 'maxResults=1&q=after%3A1600000000';

    const first = (await call('GET', `${GMAIL}/messages?${query}`)).json;
    const second = (
      await call('GET', `${GMAIL}/messages?${query}&pageToken=${String(first['nextPageToken'])}`)
    ).json;

    expect(first['resultSizeEstimate']).toBe(2);
    expect(ids(first, 'messages')).toEqual([b.id]);
    expect(ids(second, 'messages')).toEqual([a.id]);
    expect(second['nextPageToken']).toBeUndefined();
  });

  test('orders the list by date, not by when a message was seeded', async () => {
    const recent = await seed('recent', { receivedAt: '2026-06-01T00:00:00Z' });
    const backdated = await seed('backdated', { receivedAt: '2026-01-01T00:00:00Z' });

    const listed = (await call('GET', `${GMAIL}/messages`)).json;

    expect(ids(listed, 'messages')).toEqual([recent.id, backdated.id]);
  });

  test('treats an unreadable or negative page request as the first page', async () => {
    const only = await seed('only');
    for (const query of ['pageToken=-5', 'pageToken=nonsense', 'maxResults=-1', 'maxResults=0']) {
      const res = (await call('GET', `${GMAIL}/messages?${query}`)).json;
      expect(ids(res, 'messages')).toEqual([only.id]);
    }
  });

  test('returns a message as base64url RAW with its label, and 404 for an unknown id', async () => {
    const inbound = await seed('raw me');
    const outbound = await seed('sent copy', { folder: 'sent' });

    const message = (await call('GET', `${GMAIL}/messages/${inbound.id}?format=RAW`)).json;
    const sent = (await call('GET', `${GMAIL}/messages/${outbound.id}`)).json;

    expect(Buffer.from(field<string>(message, 'raw'), 'base64url').toString()).toContain(
      'Subject: raw me',
    );
    expect(message['labelIds']).toEqual(['INBOX']);
    expect(sent['labelIds']).toEqual(['SENT']);
    expect((await call('GET', `${GMAIL}/messages/missing`)).status).toBe(404);
    expect((await call('GET', `${GMAIL}/messages/%E0%A4%A`)).status).toBe(404);
  });

  test('history lists, in order, only what was added after startHistoryId', async () => {
    const anchor = String((await call('GET', `${GMAIL}/profile`)).json['historyId']);
    const first = await seed('later 1');
    const second = await seed('later 2');

    const pageOne = (await call('GET', `${GMAIL}/history?startHistoryId=${anchor}&maxResults=1`))
      .json;
    const pageTwo = (
      await call(
        'GET',
        `${GMAIL}/history?startHistoryId=${anchor}&maxResults=1&pageToken=${String(pageOne['nextPageToken'])}`,
      )
    ).json;

    const added = (body: Json): string[] =>
      field<Array<{ messagesAdded: Array<{ message: { id: string } }> }>>(body, 'history').map(
        (entry) => entry.messagesAdded[0]?.message.id ?? '',
      );
    expect(added(pageOne)).toEqual([first.id]);
    expect(added(pageTwo)).toEqual([second.id]);
  });

  test('history 404s from before an expiry, still answers from after it, and 400s a bad id', async () => {
    const anchor = String((await call('GET', `${GMAIL}/profile`)).json['historyId']);
    await call('POST', `/__admin/mailboxes/${TOKEN}/expire-cursors`);
    const fresh = String((await call('GET', `${GMAIL}/profile`)).json['historyId']);
    const later = await seed('after expiry');

    expect((await call('GET', `${GMAIL}/history?startHistoryId=${anchor}`)).status).toBe(404);
    const since = (await call('GET', `${GMAIL}/history?startHistoryId=${fresh}`)).json;
    expect(field<unknown[]>(since, 'history')).toHaveLength(1);
    expect(JSON.stringify(since)).toContain(later.id);
    for (const bad of ['abc', '']) {
      expect((await call('GET', `${GMAIL}/history?startHistoryId=${bad}`)).status).toBe(400);
    }
  });

  test('send files a copy only into the thread it names, never by its headers', async () => {
    const parent = await seed('question');
    const encode = (raw: string): string => Buffer.from(raw).toString('base64url');

    const named = await call('POST', `${GMAIL}/messages/send`, {
      body: { raw: encode(rfc822('reply one')), threadId: parent.threadId },
    });
    const headersOnly = await call('POST', `${GMAIL}/messages/send`, {
      body: { raw: encode(rfc822('reply two', ['In-Reply-To: <question@customer.test>'])) },
    });

    expect(named.json['threadId']).toBe(parent.threadId);
    expect(named.json['labelIds']).toEqual(['SENT']);
    expect(headersOnly.status).toBe(200);
    expect(headersOnly.json['threadId']).toMatch(/^[0-9a-f]+$/);
    expect(headersOnly.json['threadId']).not.toBe(parent.threadId);
    expect((await call('POST', `${GMAIL}/messages/send`, { body: {} })).status).toBe(400);
  });

  test('send answers 404 for a thread the mailbox does not hold, as Gmail does', async () => {
    const res = await call('POST', `${GMAIL}/messages/send`, {
      body: { raw: Buffer.from(rfc822('orphan')).toString('base64url'), threadId: 'abc123' },
    });

    expect(res.status).toBe(404);
  });

  test('answers 404 for an unknown Gmail route', async () => {
    expect((await call('GET', `${GMAIL}/labels`)).status).toBe(404);
  });
});

test.describe('mail provider emulator — Graph', () => {
  test('refuses an unknown token with 401', async () => {
    expect((await call('GET', `${GRAPH}/mailFolders/inbox`, { token: 'stranger' })).status).toBe(
      401,
    );
  });

  test('resolves inbox and sentitems, and 404s any other folder', async () => {
    expect((await call('GET', `${GRAPH}/mailFolders/inbox`)).json['id']).toBe('inbox');
    expect((await call('GET', `${GRAPH}/mailFolders/sentitems`)).status).toBe(200);
    expect((await call('GET', `${GRAPH}/mailFolders/archive`)).status).toBe(404);
    expect((await call('GET', `${GRAPH}/mailFolders/%E0%A4%A`)).status).toBe(404);
    expect((await call('GET', `${GRAPH}/mailFolders/archive/messages/delta`)).status).toBe(404);
  });

  test('delta pages oldest first with nextLink, ends with a deltaLink, then returns only new mail', async () => {
    const g1 = await seed('g1');
    const g2 = await seed('g2');

    const first = (
      await call('GET', `${GRAPH}/mailFolders/inbox/messages/delta`, { prefer: PAGE_OF_ONE })
    ).json;
    expect(new URL(String(first['@odata.nextLink'])).origin).toBe(base);
    const second = (await call('GET', pathOf(first['@odata.nextLink']), { prefer: PAGE_OF_ONE }))
      .json;
    const delta = pathOf(second['@odata.deltaLink']);

    expect(ids(first, 'value')).toEqual([g1.id]);
    expect(ids(second, 'value')).toEqual([g2.id]);
    expect(ids((await call('GET', delta)).json, 'value')).toEqual([]);

    const g3 = await seed('g3');
    const fresh = (await call('GET', delta)).json;
    expect(ids(fresh, 'value')).toEqual([g3.id]);
    expect(field<Array<{ conversationId: string }>>(fresh, 'value')[0]?.conversationId).toBe(
      g3.threadId,
    );
  });

  test('a page size of zero still makes progress', async () => {
    const only = await seed('only');

    const page = (
      await call('GET', `${GRAPH}/mailFolders/inbox/messages/delta`, {
        prefer: 'odata.maxpagesize=0',
      })
    ).json;

    expect(ids(page, 'value')).toEqual([only.id]);
    expect(page['@odata.deltaLink']).toBeTruthy();
  });

  test('seeded sent mail appears in sentitems, not the inbox', async () => {
    const sent = await seed('outbound', { folder: 'sent' });

    const inbox = (await call('GET', `${GRAPH}/mailFolders/inbox/messages/delta`)).json;
    const sentItems = (await call('GET', `${GRAPH}/mailFolders/sentitems/messages/delta`)).json;

    expect(ids(inbox, 'value')).toEqual([]);
    expect(ids(sentItems, 'value')).toEqual([sent.id]);
  });

  test('a delta link minted before expire-cursors answers 410 syncStateNotFound', async () => {
    const page = (await call('GET', `${GRAPH}/mailFolders/inbox/messages/delta`)).json;
    await call('POST', `/__admin/mailboxes/${TOKEN}/expire-cursors`);

    const expired = await call('GET', pathOf(page['@odata.deltaLink']));

    expect(expired.status).toBe(410);
    expect(field<{ code: string }>(expired.json, 'error').code).toBe('syncStateNotFound');
  });

  test('serves the MIME source of a message or a draft, and 404s an unknown one', async () => {
    const { id } = await seed('mime');
    const draft = await call('POST', `${GRAPH}/messages`, {
      raw: Buffer.from(rfc822('draft body')).toString('base64'),
    });

    expect((await call('GET', `${GRAPH}/messages/${id}/$value`)).text).toContain('Subject: mime');
    expect(
      (await call('GET', `${GRAPH}/messages/${field<string>(draft.json, 'id')}/$value`)).text,
    ).toContain('Subject: draft body');
    expect((await call('GET', `${GRAPH}/messages/missing/$value`)).status).toBe(404);
  });

  test('refuses a draft body that is not base64 MIME', async () => {
    for (const raw of [
      '',
      '!!!not base64!!!',
      Buffer.from('no header separator').toString('base64'),
    ]) {
      expect((await call('POST', `${GRAPH}/messages`, { raw })).status).toBe(400);
    }
  });

  test('draft then send threads the reply by its headers and shows it only once sent', async () => {
    const parent = await seed('question');
    const mime = rfc822('re question', ['In-Reply-To: <question@customer.test>']);

    const draft = await call('POST', `${GRAPH}/messages`, {
      raw: Buffer.from(mime).toString('base64'),
    });
    const draftId = field<string>(draft.json, 'id');
    const sentBefore = (await call('GET', `${GRAPH}/mailFolders/sentitems/messages/delta`)).json;
    const sendStatus = (await call('POST', `${GRAPH}/messages/${draftId}/send`)).status;
    const sentAfter = (await call('GET', `${GRAPH}/mailFolders/sentitems/messages/delta`)).json;

    expect(draft.status).toBe(201);
    expect(draft.json['conversationId']).toBe(parent.threadId);
    expect(ids(sentBefore, 'value')).toEqual([]);
    expect(sendStatus).toBe(202);
    expect(ids(sentAfter, 'value')).toEqual([draftId]);
    expect((await call('POST', `${GRAPH}/messages/${draftId}/send`)).status).toBe(404);
  });

  test('answers 404 for an unknown Graph route', async () => {
    expect((await call('GET', `${GRAPH}/calendar`)).status).toBe(404);
  });
});
