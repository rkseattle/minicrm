/**
 * Gmail provider behavior, driven by a fake fetch.
 *
 * Injected rather than vi.mock'd, following createImapProvider's client factory: the seam
 * is the transport, and Google publishes no sandbox to reach instead — every real call
 * touches a real mailbox.
 *
 * The fake is the load-bearing risk here, exactly as the IMAP fake is: it agrees with our
 * reading of the API rather than with the API itself. Holding it to Google's published
 * Discovery Document is what closes that gap, and it is a later phase of this work.
 */

import { describe, it, expect } from 'vitest';

import type { OAuthAuthPayload } from '../services/connectedAccountService.js';
import {
  createGmailProvider,
  INSUFFICIENT_SCOPE,
  parseCursor,
  serializeCursor,
  type FetchLike,
} from '../services/mail/gmailProvider.js';

const ACCOUNT_ADDRESS = 'rep@example.com';
const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const SINCE = new Date('2026-06-01T00:00:00Z');

const AUTH: OAuthAuthPayload = {
  kind: 'oauth',
  access_token: 'access-token-value',
  refresh_token: 'refresh-token-value',
  expires_at: Date.now() + 60 * 60 * 1000,
};

/** One canned response, keyed by the path fragment the driver asks for. */
interface Route {
  match: string;
  status?: number;
  body?: unknown;
}

/** Records every request the driver makes and answers from a route table. */
function fakeFetch(routes: Route[]): { fn: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fn: FetchLike = (url) => {
    urls.push(url);
    const route = routes.find((candidate) => url.includes(candidate.match));
    const status = route?.status ?? (route ? 200 : 500);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(route?.body ?? {}),
    });
  };
  return { fn, urls };
}

/** A minimal RFC 2822 document, base64url-encoded the way Gmail returns one. */
function rawMessage(options: { from: string; subject?: string; body?: string }): string {
  const document = [
    `From: ${options.from}`,
    'To: rep@example.com',
    `Subject: ${options.subject ?? 'A subject'}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    options.body ?? 'Hello there.',
    '',
  ].join('\r\n');
  return Buffer.from(document, 'utf8').toString('base64url');
}

/** A body whose encoding uses the `-` and `_` that distinguish base64url. */
const ALPHABET_SENSITIVE_BODY = 'café ~ olé ÿþ';

describe('parseCursor', () => {
  it('treats an absent cursor as never-synced', () => {
    expect(parseCursor(null)).toBeNull();
  });

  it('treats a cursor that will not parse as never-synced', () => {
    // A bounded re-backfill is the cost of forgetting where a mailbox stopped; refusing
    // to sync at all would be unbounded.
    expect(parseCursor('{not json')).toBeNull();
  });

  it('rejects a cursor whose phase is not one this driver writes', () => {
    expect(parseCursor(JSON.stringify({ phase: 'other', historyId: '9', pageToken: null }))).toBe(
      null,
    );
  });

  it('rejects a cursor with no history position', () => {
    expect(parseCursor(JSON.stringify({ phase: 'incremental', pageToken: null }))).toBeNull();
  });

  it('round-trips a backfill cursor', () => {
    const cursor = { phase: 'backfill' as const, historyId: '4242', pageToken: 'page-2' };
    expect(parseCursor(serializeCursor(cursor))).toEqual(cursor);
  });
});

describe('createGmailProvider — scope check', () => {
  it('refuses a mailbox that did not grant read access, before any request', async () => {
    const fetcher = fakeFetch([]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, ['openid', 'email'], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toMatchObject({
      code: INSUFFICIENT_SCOPE,
    });
    // The point of checking first: an under-scoped mailbox costs nothing per tick, and
    // spends no refresh token proving what its scopes already say.
    expect(fetcher.urls).toHaveLength(0);
  });

  it('refuses an account whose credentials are not OAuth', async () => {
    const fetcher = fakeFetch([]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    await expect(
      provider.fetchSince(
        { kind: 'imap', host: 'h', port: 993, username: 'u', password: 'p', secure: true },
        null,
        SINCE,
      ),
    ).rejects.toThrow();
    expect(fetcher.urls).toHaveLength(0);
  });
});

describe('createGmailProvider — backfill', () => {
  it('anchors on the profile history id and pages with the listing token', async () => {
    const fetcher = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS, historyId: '5000' } },
      {
        match: '/messages?',
        body: { messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'page-2' },
      },
      {
        match: '/messages/m1',
        body: { id: 'm1', threadId: 't1', raw: rawMessage({ from: 'a@b.c' }) },
      },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.hasMore).toBe(true);
    expect(parseCursor(page.cursor)).toEqual({
      phase: 'backfill',
      historyId: '5000',
      pageToken: 'page-2',
    });
    expect(page.messages).toHaveLength(1);
  });

  it('keeps the anchored history id across pages and flips phase when the listing ends', async () => {
    // The anchor must not move mid-backfill: it is read before the window and becomes the
    // incremental resume point, so re-reading it per page would skip whatever arrived
    // while the earlier pages were being fetched.
    const fetcher = fakeFetch([
      { match: '/profile', body: { historyId: '9999' } },
      { match: '/messages?', body: { messages: [] } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(
      AUTH,
      serializeCursor({ phase: 'backfill', historyId: '5000', pageToken: 'page-2' }),
      SINCE,
    );

    expect(page.hasMore).toBe(false);
    expect(parseCursor(page.cursor)).toEqual({
      phase: 'incremental',
      historyId: '5000',
      pageToken: null,
    });
    // The profile is read only to anchor a fresh backfill, never to re-anchor one.
    expect(fetcher.urls.some((url) => url.includes('/profile'))).toBe(false);
  });

  it('asks Gmail to exclude drafts and chats', async () => {
    // IMAP syncs INBOX and Sent only. Without this a half-written draft lands as real
    // correspondence, and the same mailbox reads differently per driver.
    const fetcher = fakeFetch([
      { match: '/profile', body: { historyId: '1' } },
      { match: '/messages?', body: { messages: [] } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    await provider.fetchSince(AUTH, null, SINCE);

    const listing = fetcher.urls.find((url) => url.includes('/messages?'));
    expect(listing).toContain('-in%3Adrafts');
    expect(listing).toContain('-in%3Achats');
    expect(listing).toContain(`after%3A${String(Math.floor(SINCE.getTime() / 1000))}`);
  });

  it('stores no cursor when the mailbox reports no history position', async () => {
    // Without an anchor there is nothing an incremental sync could resume from, so the
    // window is re-read rather than a cursor stored that cannot serve one.
    const fetcher = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS } },
      { match: '/messages?', body: { messages: [] } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.cursor).toBeNull();
    expect(page.cursorInvalid).toBe(false);
  });
});

describe('createGmailProvider — incremental', () => {
  it('advances the cursor only when history is read to its end', async () => {
    const fetcher = fakeFetch([
      {
        match: '/history',
        body: {
          historyId: '6000',
          history: [{ id: '1', messagesAdded: [{ message: { id: 'm9', threadId: 't9' } }] }],
        },
      },
      { match: '/messages/m9', body: { id: 'm9', raw: rawMessage({ from: 'x@y.z' }) } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(
      AUTH,
      serializeCursor({ phase: 'incremental', historyId: '5000', pageToken: null }),
      SINCE,
    );

    expect(page.hasMore).toBe(false);
    expect(parseCursor(page.cursor)?.historyId).toBe('6000');
  });

  it('leaves the cursor unadvanced when more history remains', async () => {
    // The engine calls fetchSince once per tick here and never loops on hasMore, so
    // advancing past records this page did not deliver would skip that mail permanently.
    const fetcher = fakeFetch([
      {
        match: '/history',
        body: {
          historyId: '6000',
          nextPageToken: 'more',
          history: [{ id: '1', messagesAdded: [{ message: { id: 'm9', threadId: 't9' } }] }],
        },
      },
      { match: '/messages/m9', body: { id: 'm9', raw: rawMessage({ from: 'x@y.z' }) } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(
      AUTH,
      serializeCursor({ phase: 'incremental', historyId: '5000', pageToken: null }),
      SINCE,
    );

    expect(page.hasMore).toBe(true);
    expect(parseCursor(page.cursor)?.historyId).toBe('5000');
  });

  it('reports an expired history position as an invalid cursor', async () => {
    // Google documents 404 here as the signal that the position aged out. The engine
    // answers with a bounded re-backfill rather than resyncing everything.
    const fetcher = fakeFetch([{ match: '/history', status: 404 }]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(
      AUTH,
      serializeCursor({ phase: 'incremental', historyId: '1', pageToken: null }),
      SINCE,
    );

    expect(page.cursorInvalid).toBe(true);
    expect(page.cursor).toBeNull();
    expect(page.messages).toEqual([]);
  });

  it('drops history records for labels the backfill query excludes', async () => {
    const fetcher = fakeFetch([
      {
        match: '/history',
        body: {
          historyId: '6000',
          history: [
            {
              id: '1',
              messagesAdded: [
                { message: { id: 'spam', threadId: 't', labelIds: ['SPAM'] } },
                { message: { id: 'draft', threadId: 't', labelIds: ['DRAFT'] } },
              ],
            },
          ],
        },
      },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(
      AUTH,
      serializeCursor({ phase: 'incremental', historyId: '5000', pageToken: null }),
      SINCE,
    );

    expect(page.messages).toEqual([]);
    expect(fetcher.urls.some((url) => url.includes('/messages/spam'))).toBe(false);
  });
});

describe('createGmailProvider — messages that cannot be fully stored', () => {
  it('keeps an oversized message as headers rather than dropping it', async () => {
    // The cursor advances past this message in the same transaction that stores the page,
    // so returning nothing loses it permanently. IMAP keeps the row and nulls the body.
    const huge = 'x'.repeat(2_200_000);
    const fetcher = fakeFetch([
      { match: '/profile', body: { historyId: '1' } },
      { match: '/messages?', body: { messages: [{ id: 'big', threadId: 't1' }] } },
      {
        match: '/messages/big',
        body: { id: 'big', threadId: 't1', raw: rawMessage({ from: 'a@b.c', body: huge }) },
      },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].fromAddress).toBe('a@b.c');
    expect(page.messages[0].subject).toBe('A subject');
    expect(page.messages[0].bodyText).toBeNull();
    expect(page.messages[0].snippet).toBeNull();
  });

  it('keeps a listed page when the mailbox reports no history position', async () => {
    // No anchor means no cursor, but the messages this page already listed are still
    // worth storing: the ingest is idempotent and the window may have moved by the time
    // it is re-read.
    const fetcher = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS } },
      { match: '/messages?', body: { messages: [{ id: 'm1', threadId: 't1' }] } },
      { match: '/messages/m1', body: { id: 'm1', raw: rawMessage({ from: 'a@b.c' }) } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.cursor).toBeNull();
    expect(page.messages).toHaveLength(1);
  });
});

describe('createGmailProvider — incremental paging', () => {
  it('carries the history page token so a second tick reads page two', async () => {
    // Without this the same startHistoryId is requested every tick and page two is never
    // reached — a mailbox with more than one page of change silently stops ingesting.
    const firstFetcher = fakeFetch([
      {
        match: '/history',
        body: {
          historyId: '6000',
          nextPageToken: 'hist-2',
          history: [{ id: '1', messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }] }],
        },
      },
      { match: '/messages/m1', body: { id: 'm1', raw: rawMessage({ from: 'a@b.c' }) } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], firstFetcher.fn);

    const first = await provider.fetchSince(
      AUTH,
      serializeCursor({ phase: 'incremental', historyId: '5000', pageToken: null }),
      SINCE,
    );

    expect(first.hasMore).toBe(true);
    expect(parseCursor(first.cursor)).toEqual({
      phase: 'incremental',
      historyId: '5000',
      pageToken: 'hist-2',
    });

    const secondFetcher = fakeFetch([
      {
        match: '/history',
        body: {
          historyId: '6000',
          history: [{ id: '2', messagesAdded: [{ message: { id: 'm2', threadId: 't2' } }] }],
        },
      },
      { match: '/messages/m2', body: { id: 'm2', raw: rawMessage({ from: 'c@d.e' }) } },
    ]);
    const next = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], secondFetcher.fn);

    const second = await next.fetchSince(AUTH, first.cursor, SINCE);

    // The second tick asks for the page the first one stopped at, and only then does the
    // position move.
    expect(secondFetcher.urls.some((url) => url.includes('pageToken=hist-2'))).toBe(true);
    expect(second.hasMore).toBe(false);
    expect(parseCursor(second.cursor)).toEqual({
      phase: 'incremental',
      historyId: '6000',
      pageToken: null,
    });
  });
});

describe('createGmailProvider — truncation', () => {
  it('delivers every message a history page reported, however many that is', async () => {
    // maxResults bounds history RECORDS, not the messages inside them, so one record set
    // can exceed a page. Gmail offers no way to resume inside a page, so trimming here
    // could only lose the remainder — the cursor advances past it in the same transaction.
    const many = Array.from({ length: 250 }, (_, index) => ({
      message: { id: `m${String(index)}`, threadId: 't1' },
    }));
    const routes: Route[] = [
      {
        match: '/history',
        body: { historyId: '6000', history: [{ id: '1', messagesAdded: many }] },
      },
    ];
    for (let index = 0; index < 250; index += 1) {
      routes.push({
        match: `/messages/m${String(index)}`,
        body: { id: `m${String(index)}`, raw: rawMessage({ from: 'a@b.c' }) },
      });
    }
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fakeFetch(routes).fn);

    const page = await provider.fetchSince(
      AUTH,
      serializeCursor({ phase: 'incremental', historyId: '5000', pageToken: null }),
      SINCE,
    );

    expect(page.messages).toHaveLength(250);
    expect(new Set(page.messages.map((message) => message.providerMessageId)).size).toBe(250);
    // Nothing was left behind, so the position may move.
    expect(page.hasMore).toBe(false);
    expect(parseCursor(page.cursor)?.historyId).toBe('6000');
  });

  it('keeps paging a window whose history position could not be read', async () => {
    // No anchor means no incremental phase to flip to, but the listing still has pages.
    // Reporting the backfill finished would close the job and re-read page one forever.
    const fetcher = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS } },
      {
        match: '/messages?',
        body: { messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'page-2' },
      },
      { match: '/messages/m1', body: { id: 'm1', raw: rawMessage({ from: 'a@b.c' }) } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(parseCursor(page.cursor)?.phase).toBe('backfill');
    expect(parseCursor(page.cursor)?.pageToken).toBe('page-2');
  });

  it('re-attempts the anchor on the next page and flips phase once it answers', async () => {
    const fetcher = fakeFetch([
      { match: '/profile', body: { historyId: '7777' } },
      { match: '/messages?', body: { messages: [] } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(
      AUTH,
      serializeCursor({ phase: 'backfill', historyId: 'unanchored', pageToken: 'page-2' }),
      SINCE,
    );

    expect(fetcher.urls.some((url) => url.includes('/profile'))).toBe(true);
    expect(parseCursor(page.cursor)).toEqual({
      phase: 'incremental',
      historyId: '7777',
      pageToken: null,
    });
  });
});

describe('createGmailProvider — failures', () => {
  it('treats a quota refusal as transient, not as a bad credential', async () => {
    // Telling a rep to reconnect a mailbox does nothing for a quota that resets in a
    // minute, and status_detail is rendered to them verbatim.
    const fetcher = fakeFetch([
      {
        match: '/profile',
        status: 403,
        body: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } },
      },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
  });

  it('treats a 429 as transient', async () => {
    const fetcher = fakeFetch([{ match: '/profile', status: 429, body: {} }]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
  });

  it('still treats a 403 with no quota reason as a credential failure', async () => {
    const fetcher = fakeFetch([
      { match: '/profile', status: 403, body: { error: { errors: [{ reason: 'forbidden' }] } } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_EXPIRED',
    });
  });

  it('maps a rejected token to the credential-expired code', async () => {
    const fetcher = fakeFetch([{ match: '/profile', status: 401 }]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_EXPIRED',
    });
  });

  it('maps a server failure to the unreachable code', async () => {
    const fetcher = fakeFetch([{ match: '/profile', status: 503 }]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
  });

  it('never puts the provider’s own words in an error a user will read', async () => {
    const fetcher = fakeFetch([
      { match: '/profile', status: 500, body: { error: { message: 'internal detail leaked' } } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(/Could not reach Gmail/);
  });

  it('decodes a document whose encoding uses the base64url alphabet', async () => {
    // Node's base64 decoder accepts this alphabet too, so this does not discriminate
    // between the two labels; it asserts that a body carrying non-ASCII characters
    // survives the decode and reaches the column intact.
    const fetcher = fakeFetch([
      { match: '/profile', body: { historyId: '1' } },
      { match: '/messages?', body: { messages: [{ id: 'm1', threadId: 't1' }] } },
      {
        match: '/messages/m1',
        body: {
          id: 'm1',
          threadId: 't1',
          raw: rawMessage({ from: 'a@b.c', body: ALPHABET_SENSITIVE_BODY }),
        },
      },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages[0].bodyText).toContain(ALPHABET_SENSITIVE_BODY);
  });

  it('skips a message that vanished between listing and fetching', async () => {
    // A page is worth more than the one message that went missing from it: failing here
    // would discard every message beside it and re-read them all next tick.
    const fetcher = fakeFetch([
      { match: '/profile', body: { historyId: '1' } },
      {
        match: '/messages?',
        body: {
          messages: [
            { id: 'gone', threadId: 't1' },
            { id: 'kept', threadId: 't2' },
          ],
        },
      },
      { match: '/messages/gone', status: 404 },
      { match: '/messages/kept', body: { id: 'kept', raw: rawMessage({ from: 'a@b.c' }) } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].providerMessageId).toBe('kept');
  });
});
