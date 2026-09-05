/**
 * Gmail provider behavior, driven by a fake fetch.
 *
 * Injected rather than vi.mock'd, following createImapProvider's client factory: the seam
 * is the transport, and Google publishes no sandbox to reach instead — every real call
 * touches a real mailbox.
 *
 * The fake is the load-bearing risk here, exactly as the IMAP fake is: it agrees with our
 * reading of the API rather than with the API itself. Every success body it returns is
 * validated against Google's published Discovery Document, which is what closes that gap.
 */

import { describe, it, expect } from 'vitest';

import type { OAuthAuthPayload } from '../services/connectedAccountService.js';
import { assertMatchesGmailSchema } from './gmailSchema.js';
import {
  createGmailProvider,
  INSUFFICIENT_SCOPE,
  parseCursor,
  serializeCursor,
  testGmailAccess,
  UNANCHORED,
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
  /**
   * Skips schema validation, for the handful of tests asserting what the driver does when
   * Google breaks its own contract. Every other route is validated, so this has to be
   * asked for by name rather than reached by omitting a field.
   */
  contractViolation?: true;
}

/**
 * Which Discovery schema a success body must satisfy, derived from the URL rather than
 * declared per route — a route added later cannot opt out of validation by omitting it.
 * Order matters: `/messages/<id>` is a Message, bare `/messages` is a list of them.
 */
function schemaForUrl(url: string): string | null {
  const path = url.split('?')[0];
  if (path.endsWith('/profile')) return 'Profile';
  if (path.includes('/history')) return 'ListHistoryResponse';
  if (/\/messages\/[^/]+$/.test(path)) return 'Message';
  if (path.endsWith('/messages')) return 'ListMessagesResponse';
  return null;
}

/** Records every request the driver makes and answers from a route table. */
function fakeFetch(routes: Route[]): { fn: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fn: FetchLike = (url) => {
    urls.push(url);
    // A boundary, not a bare substring: '/messages/m1' otherwise also answers for m15,
    // m123 and m199, and the driver builds providerMessageId from the id it asked for
    // rather than the body it got, so serving the wrong message goes unnoticed. A fragment
    // ending in its own delimiter ('/messages?') already carries the boundary.
    const route = routes.find((candidate) => {
      const at = url.indexOf(candidate.match);
      if (at === -1) return false;
      if (/[?&/]$/.test(candidate.match)) return true;
      const next = url[at + candidate.match.length];
      return next === undefined || next === '?' || next === '&' || next === '/';
    });
    const status = route?.status ?? (route ? 200 : 500);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => {
        const body = route?.body ?? {};
        // Only success bodies are Discovery-shaped; an error body is Google's error
        // envelope, which the document does not describe.
        const schema =
          status >= 200 && status < 300 && !route?.contractViolation ? schemaForUrl(url) : null;
        if (schema) assertMatchesGmailSchema(schema, body);
        return Promise.resolve(body);
      },
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

describe('the fake itself', () => {
  it('does not serve one message id from another that shares its prefix', async () => {
    // Not hypothetical: the driver builds providerMessageId from the id it requested, not
    // from the body it received, so a route collision serves the wrong message silently.
    const fetcher = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS, historyId: '1' } },
      { match: '/messages?', body: { messages: [{ id: 'm12', threadId: 't1' }] } },
      {
        match: '/messages/m1',
        body: { id: 'm1', threadId: 't1', raw: rawMessage({ from: 'a@b.c' }) },
      },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    // m12 has no route of its own, so it must 500 rather than quietly receive m1's body.
    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow();
  });

  it('surfaces a schema violation instead of the driver reporting an unreachable mailbox', async () => {
    const fetcher = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS, historyId: '1' } },
      { match: '/messages?', body: { messages: [{ id: 'm1', threadId: 't1' }] } },
      {
        match: '/messages/m1',
        body: { id: 'm1', invented: true, raw: rawMessage({ from: 'a@b.c' }) },
      },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(/does not match Message/);
  });
});

describe('createGmailProvider — a mailbox that cannot be anchored', () => {
  it('keeps a cursor when the listing ends with no history position, rather than re-reading the window every tick', async () => {
    // A null cursor is indistinguishable from never-synced, and the engine re-backfills
    // the whole window on one — so a profile that never answers would re-read 90 days
    // forever, with each successful page resetting the failure ceiling.
    const fetcher = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS } },
      { match: '/messages?', body: { messages: [] } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const first = await provider.fetchSince(AUTH, null, SINCE);
    expect(first.cursor).not.toBeNull();
    expect(parseCursor(first.cursor)).toMatchObject({
      phase: 'backfill',
      historyId: UNANCHORED,
      pageToken: null,
    });

    const second = await provider.fetchSince(AUTH, first.cursor, SINCE);
    expect(parseCursor(second.cursor)).toMatchObject({ historyId: UNANCHORED });
  });

  it('anchors as soon as the profile answers, without re-reading what it already read', async () => {
    const anchored = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS, historyId: '900' } },
      { match: '/messages?', body: { messages: [] } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], anchored.fn);

    const page = await provider.fetchSince(
      AUTH,
      serializeCursor({
        phase: 'backfill',
        historyId: UNANCHORED,
        pageToken: null,
        afterSeconds: 1_700_000_000,
      }),
      SINCE,
    );

    expect(parseCursor(page.cursor)).toEqual({
      phase: 'incremental',
      historyId: '900',
      pageToken: null,
      afterSeconds: null,
    });
  });
});

describe('createGmailProvider — a resumed backfill page', () => {
  it('reuses the window its page token was issued against', async () => {
    // The engine recomputes `since` from the clock every tick, and Google treats a
    // pageToken as valid only for the request that produced it.
    const fetcher = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS, historyId: '500' } },
      { match: '/messages?', body: { messages: [], nextPageToken: 'PAGE2' } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const first = await provider.fetchSince(AUTH, null, new Date(1_700_000_000_000));
    await provider.fetchSince(AUTH, first.cursor, new Date(1_700_086_400_000));

    const listings = fetcher.urls.filter((url) => url.includes('/messages?'));
    const windowOf = (url: string): string | null =>
      new URL(url).searchParams.get('q')?.match(/after:(\d+)/)?.[1] ?? null;

    expect(windowOf(listings[1])).toBe(windowOf(listings[0]));
    expect(new URL(listings[1]).searchParams.get('pageToken')).toBe('PAGE2');
  });

  it('discards a stored page token that lost the window it belongs to', () => {
    expect(
      parseCursor(JSON.stringify({ phase: 'backfill', historyId: '5', pageToken: 'PAGE2' })),
    ).toBeNull();
  });
});

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
    const cursor = {
      phase: 'backfill' as const,
      historyId: '4242',
      pageToken: 'page-2',
      afterSeconds: 1_700_000_000,
    };
    expect(parseCursor(serializeCursor(cursor))).toEqual(cursor);
  });
});

describe('createGmailProvider — scope check', () => {
  it('refuses a mailbox that did not grant read access, at construction', () => {
    // Thrown when the provider is built, not when it fetches: the engine constructs the
    // driver before it decrypts and refreshes credentials, so an under-scoped mailbox
    // costs nothing per tick — no locked row, no round trip to Google.
    const fetcher = fakeFetch([]);

    expect(() => createGmailProvider(ACCOUNT_ADDRESS, ['openid', 'email'], fetcher.fn)).toThrow(
      expect.objectContaining({ code: INSUFFICIENT_SCOPE }) as Error,
    );
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
      afterSeconds: Math.floor(SINCE.getTime() / 1000),
      pageToken: 'page-2',
    });
    expect(page.messages).toHaveLength(1);
  });

  it('keeps the anchored history id across pages and flips phase when the listing ends', async () => {
    // The anchor must not move mid-backfill: it is read before the window and becomes the
    // incremental resume point, so re-reading it per page would skip whatever arrived
    // while the earlier pages were being fetched.
    const fetcher = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS, historyId: '9999' } },
      { match: '/messages?', body: { messages: [] } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(
      AUTH,
      serializeCursor({
        phase: 'backfill',
        historyId: '5000',
        pageToken: 'page-2',
        afterSeconds: 1_700_000_000,
      }),
      SINCE,
    );

    expect(page.hasMore).toBe(false);
    expect(parseCursor(page.cursor)).toEqual({
      phase: 'incremental',
      historyId: '5000',
      afterSeconds: null,
      pageToken: null,
    });
    // The profile is read only to anchor a fresh backfill, never to re-anchor one.
    expect(fetcher.urls.some((url) => url.includes('/profile'))).toBe(false);
  });

  it('carries the filter onto every page, not just the first', async () => {
    // A page token positions within a result set the other parameters define. Dropping the
    // filter on page two would let it enumerate the whole mailbox — drafts, chats, and
    // everything outside the window — and commitPage would store all of it.
    const fetcher = fakeFetch([{ match: '/messages?', body: { messages: [] } }]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    await provider.fetchSince(
      AUTH,
      serializeCursor({
        phase: 'backfill',
        historyId: '5000',
        pageToken: 'page-2',
        afterSeconds: 1_700_000_000,
      }),
      SINCE,
    );

    const listing = fetcher.urls.find((url) => url.includes('/messages?'));
    expect(listing).toContain('pageToken=page-2');
    expect(listing).toContain('-in%3Adrafts');
    expect(listing).toContain('-in%3Achats');
  });

  it('asks Gmail to exclude drafts and chats', async () => {
    // IMAP syncs INBOX and Sent only. Without this a half-written draft lands as real
    // correspondence, and the same mailbox reads differently per driver.
    const fetcher = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS, historyId: '1' } },
      { match: '/messages?', body: { messages: [] } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    await provider.fetchSince(AUTH, null, SINCE);

    const listing = fetcher.urls.find((url) => url.includes('/messages?'));
    expect(listing).toContain('-in%3Adrafts');
    expect(listing).toContain('-in%3Achats');
    expect(listing).toContain(`after%3A${String(Math.floor(SINCE.getTime() / 1000))}`);
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
      serializeCursor({
        phase: 'incremental',
        historyId: '5000',
        pageToken: null,
        afterSeconds: null,
      }),
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
      serializeCursor({
        phase: 'incremental',
        historyId: '5000',
        pageToken: null,
        afterSeconds: null,
      }),
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
      serializeCursor({
        phase: 'incremental',
        historyId: '1',
        pageToken: null,
        afterSeconds: null,
      }),
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
      serializeCursor({
        phase: 'incremental',
        historyId: '5000',
        pageToken: null,
        afterSeconds: null,
      }),
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
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS, historyId: '1' } },
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
    // The messages this page already listed are worth storing whether or not the anchor
    // arrived: the ingest is idempotent and the window may have moved by a re-read.
    const fetcher = fakeFetch([
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS } },
      { match: '/messages?', body: { messages: [{ id: 'm1', threadId: 't1' }] } },
      { match: '/messages/m1', body: { id: 'm1', raw: rawMessage({ from: 'a@b.c' }) } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(parseCursor(page.cursor)).toMatchObject({ historyId: UNANCHORED });
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
      serializeCursor({
        phase: 'incremental',
        historyId: '5000',
        pageToken: null,
        afterSeconds: null,
      }),
      SINCE,
    );

    expect(first.hasMore).toBe(true);
    expect(parseCursor(first.cursor)).toEqual({
      phase: 'incremental',
      historyId: '5000',
      afterSeconds: null,
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
      afterSeconds: null,
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
      serializeCursor({
        phase: 'incremental',
        historyId: '5000',
        pageToken: null,
        afterSeconds: null,
      }),
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
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS, historyId: '7777' } },
      { match: '/messages?', body: { messages: [] } },
    ]);
    const provider = createGmailProvider(ACCOUNT_ADDRESS, [READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(
      AUTH,
      serializeCursor({
        phase: 'backfill',
        historyId: UNANCHORED,
        pageToken: 'page-2',
        afterSeconds: 1_700_000_000,
      }),
      SINCE,
    );

    expect(fetcher.urls.some((url) => url.includes('/profile'))).toBe(true);
    expect(parseCursor(page.cursor)).toEqual({
      phase: 'incremental',
      historyId: '7777',
      afterSeconds: null,
      pageToken: null,
    });
  });
});

describe('createGmailProvider — failures', () => {
  it('treats a quota refusal as transient, not as a bad credential', async () => {
    // Telling a rep to reconnect a mailbox does nothing for a quota that resets in a
    // minute, and the code recorded here is what the panel shows them.
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
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS, historyId: '1' } },
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
      { match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS, historyId: '1' } },
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

describe('testGmailAccess', () => {
  it('accepts a mailbox the profile call can read', async () => {
    const fetcher = fakeFetch([{ match: '/profile', body: { emailAddress: ACCOUNT_ADDRESS } }]);

    expect(await testGmailAccess('token', [READ_SCOPE], fetcher.fn)).toEqual({ ok: true });
  });

  it('refuses a grant that cannot read mail, before any request', async () => {
    const fetcher = fakeFetch([]);

    const result = await testGmailAccess('token', ['openid'], fetcher.fn);

    expect(result).toMatchObject({ ok: false, code: INSUFFICIENT_SCOPE });
    expect(fetcher.urls).toHaveLength(0);
  });

  it('refuses a mailbox the provider says is gone', async () => {
    // gmailRequest hands a 404 back rather than throwing, because on the sync paths it
    // means an expired cursor. Reporting that as healthy here would clear the failure
    // count and put a deleted mailbox back on the schedule to fail eight more times.
    const fetcher = fakeFetch([{ match: '/profile', status: 404 }]);

    expect(await testGmailAccess('token', [READ_SCOPE], fetcher.fn)).toMatchObject({
      ok: false,
      code: 'PROVIDER_AUTH_EXPIRED',
    });
  });

  it('refuses a profile response carrying no mailbox', async () => {
    // A profile always names the mailbox it describes, so this is Google breaking its own
    // contract — the point of the test is that the driver survives it.
    const fetcher = fakeFetch([{ match: '/profile', body: {}, contractViolation: true }]);

    expect(await testGmailAccess('token', [READ_SCOPE], fetcher.fn)).toMatchObject({
      ok: false,
      code: 'PROVIDER_AUTH_EXPIRED',
    });
  });

  it('reports a rejected token as a credential failure', async () => {
    const fetcher = fakeFetch([{ match: '/profile', status: 401 }]);

    expect(await testGmailAccess('token', [READ_SCOPE], fetcher.fn)).toMatchObject({
      ok: false,
      code: 'PROVIDER_AUTH_EXPIRED',
    });
  });

  it('reports a server failure as unreachable, not as a bad credential', async () => {
    const fetcher = fakeFetch([{ match: '/profile', status: 503 }]);

    expect(await testGmailAccess('token', [READ_SCOPE], fetcher.fn)).toMatchObject({
      ok: false,
      code: 'CONNECTION_FAILED',
    });
  });
});
