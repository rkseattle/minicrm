/**
 * Microsoft Graph provider behavior, driven by a fake fetch.
 *
 * Injected rather than vi.mock'd, following createImapProvider's client factory: the seam
 * is the transport, and Microsoft publishes no sandbox to reach instead.
 *
 * The fake is the load-bearing risk here, as it is for the other two drivers: it agrees
 * with our reading of the API rather than with the API itself. Every JSON success body it
 * returns is validated against a written schema, which bounds how far it can drift from
 * itself as cases are added.
 */

import { describe, it, expect } from 'vitest';

import type { OAuthAuthPayload } from '../services/connectedAccountService.js';
import { GRAPH_MAIL_READ_SCOPE } from '../services/oauthProviderService.js';
import {
  createGraphProvider,
  INSUFFICIENT_SCOPE,
  parseCursor,
  serializeCursor,
  testGraphAccess,
  type FetchLike,
} from '../services/mail/graphProvider.js';
import { assertMatchesGraphSchema } from './graphSchema.js';

const ACCOUNT_ADDRESS = 'rep@example.com';
const SINCE = new Date('2026-06-01T00:00:00Z');
const RECENT = '2026-08-01T09:00:00Z';

const AUTH: OAuthAuthPayload = {
  kind: 'oauth',
  access_token: 'access-token-value',
  refresh_token: 'refresh-token-value',
  expires_at: Date.now() + 60 * 60 * 1000,
};

const GRAPH = 'https://graph.microsoft.com/v1.0/me';
const INBOX_DELTA = `${GRAPH}/mailFolders/inbox-id/messages/delta`;
const SENT_DELTA = `${GRAPH}/mailFolders/sent-id/messages/delta`;

/** One canned response, keyed by the URL fragment the driver asks for. */
interface Route {
  match: string;
  status?: number;
  body?: unknown;
  /** Raw MIME, for the `$value` route. Served as bytes, never as JSON. */
  source?: Buffer;
  /**
   * Skips schema validation, for the handful of tests asserting what the driver does when
   * Graph breaks its own contract. Every other route is validated, so this has to be
   * asked for by name rather than reached by omitting a field.
   */
  contractViolation?: true;
}

/**
 * Which schema a success body must satisfy, derived from the URL rather than declared per
 * route — a route added later cannot opt out of validation by omitting it. `$value` is
 * exempt because it returns a MIME document, not JSON.
 */
function schemaForUrl(url: string): string | null {
  const path = url.split('?')[0];
  if (path.endsWith('/$value')) return null;
  if (path.includes('/messages/delta')) return 'DeltaResponse';
  if (path.includes('/mailFolders/')) return 'MailFolder';
  return null;
}

/** Records every request the driver makes and answers from a route table. */
function fakeFetch(routes: Route[]): { fn: FetchLike; urls: string[]; headers: HeadersInit[] } {
  const urls: string[] = [];
  const headers: HeadersInit[] = [];
  const fn: FetchLike = (url, init) => {
    urls.push(url);
    if (init.headers) headers.push(init.headers);
    // A boundary, not a bare substring: '/messages/m1' otherwise also answers for m15,
    // and the driver builds providerMessageId from the id it asked for rather than the
    // body it got, so serving the wrong message goes unnoticed.
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
      headers: { get: () => null },
      json: () => {
        const body = route?.body ?? {};
        const schema =
          status >= 200 && status < 300 && !route?.contractViolation ? schemaForUrl(url) : null;
        if (schema) assertMatchesGraphSchema(schema, body);
        return Promise.resolve(body);
      },
      arrayBuffer: () => {
        const source = route?.source ?? Buffer.alloc(0);
        // A fresh ArrayBuffer, not a view onto Node's pooled one: Buffer.buffer is
        // ArrayBufferLike, which is wider than what a real Response returns.
        const copy = new ArrayBuffer(source.byteLength);
        new Uint8Array(copy).set(source);
        return Promise.resolve(copy);
      },
    });
  };
  return { fn, urls, headers };
}

/** A minimal RFC 2822 document, as `$value` returns one. */
function rawMessage(options: {
  from: string;
  subject?: string;
  body?: string;
  charset?: string;
  encoding?: BufferEncoding;
}): Buffer {
  const charset = options.charset ?? 'utf-8';
  const document = [
    `From: ${options.from}`,
    'To: rep@example.com',
    `Subject: ${options.subject ?? 'A subject'}`,
    `Content-Type: text/plain; charset="${charset}"`,
    '',
    options.body ?? 'Hello there.',
    '',
  ].join('\r\n');
  return Buffer.from(document, options.encoding ?? 'utf8');
}

/** The folder-resolution pair every opening round performs. */
const FOLDER_ROUTES: Route[] = [
  { match: '/mailFolders/inbox', body: { id: 'inbox-id', displayName: 'Inbox' } },
  { match: '/mailFolders/sentitems', body: { id: 'sent-id', displayName: 'Sent Items' } },
];

/** A delta page that ends its round, so a folder contributes nothing further. */
function emptyRound(deltaLink: string): Route['body'] {
  return { value: [], '@odata.deltaLink': deltaLink };
}

describe('the fake itself', () => {
  it('does not serve one message id from another that shares its prefix', async () => {
    // The driver builds providerMessageId from the id it requested, not from the body it
    // received, so a route collision serves the wrong message silently.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm12', conversationId: 'c1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      { match: '/messages/m1/$value', source: rawMessage({ from: 'wrong@example.com' }) },
      { match: '/messages/m12/$value', source: rawMessage({ from: 'right@example.com' }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].fromAddress).toBe('right@example.com');
  });

  it('rejects a delta body carrying a field Graph does not define', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', conversationid: 'wrong-case' }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(/does not match/);
  });
});

describe('parseCursor', () => {
  it('round-trips a link per folder', () => {
    const cursor = serializeCursor(
      new Map([
        ['inbox', `${INBOX_DELTA}?$deltatoken=a`],
        ['sentitems', `${SENT_DELTA}?$deltatoken=b`],
      ] as const),
    );
    expect(parseCursor(cursor).get('inbox')).toBe(`${INBOX_DELTA}?$deltatoken=a`);
    expect(parseCursor(cursor).get('sentitems')).toBe(`${SENT_DELTA}?$deltatoken=b`);
  });

  it('treats an unparseable cursor as absent rather than throwing', () => {
    expect(parseCursor('not json').size).toBe(0);
    expect(parseCursor('[]').size).toBe(0);
    expect(parseCursor(null).size).toBe(0);
  });

  it('drops a link pointing anywhere but Graph', () => {
    // The driver replays a stored link with a bearer token attached, so a tampered row
    // must not be able to redirect that token.
    const cursor = JSON.stringify({ inbox: 'https://evil.example.com/steal' });
    expect(parseCursor(cursor).size).toBe(0);
  });

  it('drops a folder it does not sync', () => {
    const cursor = JSON.stringify({ drafts: `${GRAPH}/mailFolders/x/messages/delta` });
    expect(parseCursor(cursor).size).toBe(0);
  });
});

describe('createGraphProvider — scope check', () => {
  it('refuses a mailbox that granted no mail permission', () => {
    const fetcher = fakeFetch([]);
    expect(() => createGraphProvider(ACCOUNT_ADDRESS, ['openid', 'email'], fetcher.fn)).toThrow(
      expect.objectContaining({ code: INSUFFICIENT_SCOPE }),
    );
    expect(fetcher.urls).toHaveLength(0);
  });

  it('accepts the bare scope Microsoft may return instead of the full URI', () => {
    // Requested as a resource URI, but the token response may echo the short form — an
    // equality check would park a correctly-granted mailbox.
    expect(() =>
      createGraphProvider(ACCOUNT_ADDRESS, ['Mail.Read'], fakeFetch([]).fn),
    ).not.toThrow();
  });

  it('accepts Mail.ReadWrite, which supersedes Mail.Read', () => {
    expect(() =>
      createGraphProvider(
        ACCOUNT_ADDRESS,
        ['https://graph.microsoft.com/Mail.ReadWrite'],
        fakeFetch([]).fn,
      ),
    ).not.toThrow();
  });

  it('refuses Mail.ReadBasic, which cannot read a body', () => {
    // Reading headers and storing no body is the silent failure the check exists to make
    // loud.
    expect(() =>
      createGraphProvider(ACCOUNT_ADDRESS, ['Mail.ReadBasic'], fakeFetch([]).fn),
    ).toThrow(expect.objectContaining({ code: INSUFFICIENT_SCOPE }));
  });
});

describe('createGraphProvider — an opening round', () => {
  it('resolves both folders and stores the link each round returned', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', conversationId: 'c1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      {
        match: SENT_DELTA,
        body: {
          value: [{ id: 'm2', conversationId: 'c2', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${SENT_DELTA}?$deltatoken=s1`,
        },
      },
      { match: '/messages/m1/$value', source: rawMessage({ from: 'them@example.com' }) },
      { match: '/messages/m2/$value', source: rawMessage({ from: ACCOUNT_ADDRESS }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(page.cursorInvalid).toBe(false);
    const stored = parseCursor(page.cursor);
    expect(stored.get('inbox')).toBe(`${INBOX_DELTA}?$deltatoken=d1`);
    expect(stored.get('sentitems')).toBe(`${SENT_DELTA}?$deltatoken=s1`);
  });

  it('reads both folders in one call rather than one per tick', async () => {
    // One folder per call would halve the sync rate: the engine calls fetchSince once per
    // tick on the incremental path.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      { match: INBOX_DELTA, body: emptyRound(`${INBOX_DELTA}?$deltatoken=d1`) },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await provider.fetchSince(AUTH, null, SINCE);

    expect(fetcher.urls.some((url) => url.startsWith(INBOX_DELTA))).toBe(true);
    expect(fetcher.urls.some((url) => url.startsWith(SENT_DELTA))).toBe(true);
  });

  it('decides direction from the sender rather than the folder', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', conversationId: 'c1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      // A copy of a sent message filed into the inbox: self-addressed mail, or a rule.
      { match: '/messages/m1/$value', source: rawMessage({ from: ACCOUNT_ADDRESS }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages[0].direction).toBe('outbound');
  });

  it('sends the immutable-id header on every request', async () => {
    // Without it the id changes when a message moves, so a refiled message would be
    // stored a second time under a new provider_message_id.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', conversationId: 'c1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      { match: '/messages/m1/$value', source: rawMessage({ from: 'them@example.com' }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await provider.fetchSince(AUTH, null, SINCE);

    expect(fetcher.headers).not.toHaveLength(0);
    for (const headers of fetcher.headers) {
      expect((headers as Record<string, string>).Prefer).toContain('IdType="ImmutableId"');
    }
  });

  it('bounds the page size it asks for', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      { match: INBOX_DELTA, body: emptyRound(`${INBOX_DELTA}?$deltatoken=d1`) },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await provider.fetchSince(AUTH, null, SINCE);

    const deltaHeaders = fetcher.headers.filter((headers) =>
      String((headers as Record<string, string>).Prefer).includes('maxpagesize'),
    );
    expect(deltaHeaders).not.toHaveLength(0);
  });

  it('asks for no $filter, whose 5,000-message cap truncates silently', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      { match: INBOX_DELTA, body: emptyRound(`${INBOX_DELTA}?$deltatoken=d1`) },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await provider.fetchSince(AUTH, null, SINCE);

    expect(fetcher.urls.some((url) => url.includes('$filter'))).toBe(false);
  });
});

describe('createGraphProvider — paging', () => {
  it('reports hasMore while a folder still holds a nextLink', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: { value: [], '@odata.nextLink': `${INBOX_DELTA}?$skiptoken=p2` },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.hasMore).toBe(true);
    expect(parseCursor(page.cursor).get('inbox')).toBe(`${INBOX_DELTA}?$skiptoken=p2`);
  });

  it('resumes a stored link without resolving folders again', async () => {
    const fetcher = fakeFetch([
      {
        match: `${INBOX_DELTA}?$skiptoken=p2`,
        body: emptyRound(`${INBOX_DELTA}?$deltatoken=d2`),
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s2`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);
    const cursor = serializeCursor(
      new Map([
        ['inbox', `${INBOX_DELTA}?$skiptoken=p2`],
        ['sentitems', `${SENT_DELTA}?$deltatoken=s1`],
      ] as const),
    );

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    // The resolve endpoint, not the delta URL that embeds the resolved id.
    expect(fetcher.urls.some((url) => url.endsWith('/mailFolders/inbox'))).toBe(false);
    expect(parseCursor(page.cursor).get('inbox')).toBe(`${INBOX_DELTA}?$deltatoken=d2`);
  });

  it('re-delivers nothing when a resumed round reports no changes', async () => {
    // Idempotent re-sync: the same link replayed against an unchanged mailbox stores no
    // second copy, because there is nothing new to store.
    const fetcher = fakeFetch([
      { match: `${INBOX_DELTA}?$deltatoken=d1`, body: emptyRound(`${INBOX_DELTA}?$deltatoken=d2`) },
      { match: `${SENT_DELTA}?$deltatoken=s1`, body: emptyRound(`${SENT_DELTA}?$deltatoken=s2`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);
    const cursor = serializeCursor(
      new Map([
        ['inbox', `${INBOX_DELTA}?$deltatoken=d1`],
        ['sentitems', `${SENT_DELTA}?$deltatoken=s1`],
      ] as const),
    );

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    expect(page.messages).toHaveLength(0);
    expect(page.cursorInvalid).toBe(false);
    expect(parseCursor(page.cursor).get('inbox')).toBe(`${INBOX_DELTA}?$deltatoken=d2`);
  });
});

describe('createGraphProvider — the backfill window', () => {
  it('ignores the window once a cursor exists', async () => {
    // The seam makes the cursor authoritative once one exists. A message the rep files
    // into the inbox today is new to this mailbox however old the message itself is, and
    // dropping it would lose it for good — the delta link advances in the same commit.
    const fetcher = fakeFetch([
      {
        match: `${INBOX_DELTA}?$deltatoken=d1`,
        body: {
          value: [{ id: 'old', conversationId: 'c1', receivedDateTime: '2019-01-01T00:00:00Z' }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d2`,
        },
      },
      { match: `${SENT_DELTA}?$deltatoken=s1`, body: emptyRound(`${SENT_DELTA}?$deltatoken=s2`) },
      { match: '/messages/old/$value', source: rawMessage({ from: 'them@example.com' }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);
    const cursor = serializeCursor(
      new Map([
        ['inbox', `${INBOX_DELTA}?$deltatoken=d1`],
        ['sentitems', `${SENT_DELTA}?$deltatoken=s1`],
      ] as const),
    );

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].providerMessageId).toBe('old');
  });

  it('applies the window on an opening round', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'old', conversationId: 'c1', receivedDateTime: '2019-01-01T00:00:00Z' }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(0);
  });
});

describe('createGraphProvider — folder resolution', () => {
  it('syncs the folder it can resolve when the other is absent', async () => {
    const fetcher = fakeFetch([
      { match: '/mailFolders/inbox', status: 404 },
      { match: '/mailFolders/sentitems', body: { id: 'sent-id' } },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(parseCursor(page.cursor).has('inbox')).toBe(false);
    expect(parseCursor(page.cursor).get('sentitems')).toBe(`${SENT_DELTA}?$deltatoken=s1`);
  });

  it('fails rather than reporting success when a folder answers with no id', async () => {
    // Read as an absent folder this would report the tick a success, so commitPage would
    // clear the failure count on every run — a mailbox syncing nothing forever, never
    // retired and never surfaced to the user.
    const fetcher = fakeFetch([
      { match: '/mailFolders/inbox', body: {}, contractViolation: true },
      { match: '/mailFolders/sentitems', body: {}, contractViolation: true },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
  });
});

describe('createGraphProvider — a paginated opening round', () => {
  it('keeps applying the window to page two', async () => {
    // The engine feeds each page's cursor straight back in, so a resumed $skiptoken is a
    // position inside the opening round — not an incremental sync. Treating it as one
    // would let page two ingest the mailbox's whole history.
    const fetcher = fakeFetch([
      {
        match: `${INBOX_DELTA}?$skiptoken=p2`,
        body: {
          value: [{ id: 'old', conversationId: 'c1', receivedDateTime: '2019-01-01T00:00:00Z' }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      { match: '/mailFolders/sentitems', body: { id: 'sent-id' } },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);
    const cursor = serializeCursor(new Map([['inbox', `${INBOX_DELTA}?$skiptoken=p2`]] as const));

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    expect(page.messages).toHaveLength(0);
    expect(fetcher.urls.some((url) => url.includes('$value'))).toBe(false);
  });
});

describe('createGraphProvider — a discarded page', () => {
  it('fetches no body when the other folder invalidated the cursor', async () => {
    // The seam requires a null cursor beside cursorInvalid, so one folder's expiry throws
    // the whole page away — paying a $value request per message first would be wasted.
    const fetcher = fakeFetch([
      {
        match: `${INBOX_DELTA}?$deltatoken=old`,
        status: 410,
        body: { error: { code: 'resyncRequired' } },
      },
      {
        match: `${SENT_DELTA}?$deltatoken=s1`,
        body: {
          value: [{ id: 'm2', conversationId: 'c2', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${SENT_DELTA}?$deltatoken=s2`,
        },
      },
      { match: '/messages/m2/$value', source: rawMessage({ from: ACCOUNT_ADDRESS }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);
    const cursor = serializeCursor(
      new Map([
        ['inbox', `${INBOX_DELTA}?$deltatoken=old`],
        ['sentitems', `${SENT_DELTA}?$deltatoken=s1`],
      ] as const),
    );

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    expect(page.cursorInvalid).toBe(true);
    expect(fetcher.urls.some((url) => url.includes('$value'))).toBe(false);
  });
});

describe('createGraphProvider — an expired delta link', () => {
  it('invalidates the cursor on 410 Gone', async () => {
    const fetcher = fakeFetch([
      {
        match: `${INBOX_DELTA}?$deltatoken=old`,
        status: 410,
        body: { error: { code: 'resyncRequired' } },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s2`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);
    const cursor = serializeCursor(
      new Map([
        ['inbox', `${INBOX_DELTA}?$deltatoken=old`],
        ['sentitems', `${SENT_DELTA}?$deltatoken=s1`],
      ] as const),
    );

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    expect(page.cursorInvalid).toBe(true);
    expect(page.cursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  it('invalidates on a 4xx carrying syncStateNotFound', async () => {
    // Microsoft documents the expiry as "a 40X-series error with error codes such as
    // syncStateNotFound", so the status alone cannot decide it.
    const fetcher = fakeFetch([
      {
        match: `${INBOX_DELTA}?$deltatoken=old`,
        status: 400,
        body: { error: { code: 'syncStateNotFound' } },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s2`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);
    const cursor = serializeCursor(
      new Map([
        ['inbox', `${INBOX_DELTA}?$deltatoken=old`],
        ['sentitems', `${SENT_DELTA}?$deltatoken=s1`],
      ] as const),
    );

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    expect(page.cursorInvalid).toBe(true);
    expect(page.cursor).toBeNull();
  });

  it('does not report an expiry as a credential failure', async () => {
    // A 4xx that means "resync" would otherwise map to PROVIDER_AUTH_EXPIRED and tell the
    // user to reconnect a healthy mailbox — on the most-travelled error path this driver
    // has, since Outlook delta tokens have no fixed lifetime.
    const fetcher = fakeFetch([
      {
        match: `${INBOX_DELTA}?$deltatoken=old`,
        status: 400,
        body: { error: { code: 'syncStateNotFound' } },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s2`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);
    const cursor = serializeCursor(new Map([['inbox', `${INBOX_DELTA}?$deltatoken=old`]] as const));

    await expect(provider.fetchSince(AUTH, cursor, SINCE)).resolves.toMatchObject({
      cursorInvalid: true,
    });
  });
});

describe('createGraphProvider — messages it does not store', () => {
  it('skips a @removed entry rather than deleting a stored row', async () => {
    // Graph reports a move the same way it reports a delete, and the engine has no delete
    // path — a message refiled elsewhere did not stop existing.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', '@removed': { reason: 'deleted' } }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(0);
    expect(fetcher.urls.some((url) => url.includes('$value'))).toBe(false);
  });

  it('skips a draft', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', isDraft: true, receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(0);
  });

  it('skips a message older than the window without downloading its body', async () => {
    // Dropping it after the $value request would pay a full body fetch per message on a
    // ten-year mailbox's opening round.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', conversationId: 'c1', receivedDateTime: '2019-01-01T00:00:00Z' }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(0);
    expect(fetcher.urls.some((url) => url.includes('$value'))).toBe(false);
  });

  it('keeps a message whose date will not parse', async () => {
    // The window is an optimization; dropping a message over a missing field would lose it
    // for good once the cursor advanced past it.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', conversationId: 'c1' }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      { match: '/messages/m1/$value', source: rawMessage({ from: 'them@example.com' }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(1);
  });

  it('skips a message that vanished between listing and fetching', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [
            { id: 'm1', conversationId: 'c1', receivedDateTime: RECENT },
            { id: 'm2', conversationId: 'c2', receivedDateTime: RECENT },
          ],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      { match: '/messages/m1/$value', status: 404 },
      { match: '/messages/m2/$value', source: rawMessage({ from: 'them@example.com' }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].providerMessageId).toBe('m2');
  });

  it('drops a message with no usable sender', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', conversationId: 'c1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      { match: '/messages/m1/$value', source: Buffer.from('Subject: no sender\r\n\r\nbody\r\n') },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(0);
  });
});

describe('createGraphProvider — bodies', () => {
  it('preserves a non-UTF-8 body rather than corrupting it', async () => {
    // $value is labelled text/plain but carries per-part charsets. Reading it as text
    // would replace every latin1 byte with U+FFFD before the parser saw it.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', conversationId: 'c1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      {
        match: '/messages/m1/$value',
        source: rawMessage({
          from: 'them@example.com',
          body: 'café naïve',
          charset: 'iso-8859-1',
          encoding: 'latin1',
        }),
      },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages[0].bodyText).toContain('café naïve');
    expect(page.messages[0].bodyText).not.toContain('�');
  });

  it('stores headers only for an oversized document rather than dropping it', async () => {
    // The cursor advances past the message either way, so dropping it would lose it.
    const huge = Buffer.concat([
      rawMessage({ from: 'them@example.com', subject: 'Big one', body: 'start' }),
      Buffer.alloc(2_200_000, 0x61),
    ]);
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', conversationId: 'c1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      { match: '/messages/m1/$value', source: huge },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].subject).toBe('Big one');
    expect(page.messages[0].bodyText).toBeNull();
  });
});

describe('createGraphProvider — threading', () => {
  it('uses the conversation id Graph supplies', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', conversationId: 'conv-1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      { match: '/messages/m1/$value', source: rawMessage({ from: 'them@example.com' }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages[0].threadId).toBe('conv-1');
  });

  it('falls back to the RFC 5322 rule when Graph supplies none', async () => {
    const document = Buffer.from(
      [
        'From: them@example.com',
        'To: rep@example.com',
        'Subject: Re: a thread',
        'References: <root@example.com> <second@example.com>',
        '',
        'Reply text.',
        '',
      ].join('\r\n'),
      'utf8',
    );
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      { match: '/messages/m1/$value', source: document },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages[0].threadId).toBe('root@example.com');
  });

  it('falls back to the message id when it carries neither', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      { match: '/messages/m1/$value', source: rawMessage({ from: 'them@example.com' }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages[0].threadId).toBe('graph-m1');
  });

  it('stores one row for a message that appears in both folders', async () => {
    // A Graph id is unique across the mailbox, unlike an IMAP UID — so qualifying it by
    // folder would store a self-sent or moved message twice.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'shared-id', conversationId: 'c1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      {
        match: SENT_DELTA,
        body: {
          value: [{ id: 'shared-id', conversationId: 'c1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${SENT_DELTA}?$deltatoken=s1`,
        },
      },
      { match: '/messages/shared-id/$value', source: rawMessage({ from: ACCOUNT_ADDRESS }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(1);
    // One document, one download: the body pass is sequential to respect Graph's
    // per-mailbox throttle, so fetching it twice spends exactly what that protects.
    expect(fetcher.urls.filter((url) => url.includes('$value'))).toHaveLength(1);
  });
});

describe('createGraphProvider — failures', () => {
  it('keeps the other folder when one cannot be read', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      { match: INBOX_DELTA, status: 500, body: { error: { code: 'InternalServerError' } } },
      {
        match: SENT_DELTA,
        body: {
          value: [{ id: 'm2', conversationId: 'c2', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${SENT_DELTA}?$deltatoken=s2`,
        },
      },
      { match: '/messages/m2/$value', source: rawMessage({ from: ACCOUNT_ADDRESS }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);
    const cursor = serializeCursor(new Map([['inbox', `${INBOX_DELTA}?$deltatoken=d1`]] as const));

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    expect(page.messages).toHaveLength(1);
    // The failed folder keeps its stored position so it resumes rather than re-backfills.
    expect(parseCursor(page.cursor).get('inbox')).toBe(`${INBOX_DELTA}?$deltatoken=d1`);
    expect(parseCursor(page.cursor).get('sentitems')).toBe(`${SENT_DELTA}?$deltatoken=s2`);
  });

  it('does not set hasMore for a folder that failed', async () => {
    // A folder gone for good would otherwise keep the engine paging forever to deliver
    // nothing. The healthy folder finishes its round here, so hasMore can only be true if
    // the failed folder contributed it.
    const fetcher = fakeFetch([
      { match: `${INBOX_DELTA}?$skiptoken=p2`, status: 500, body: {} },
      { match: `${SENT_DELTA}?$deltatoken=s1`, body: emptyRound(`${SENT_DELTA}?$deltatoken=s2`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);
    // The inbox is mid-round: its stored link is a skiptoken, so a driver that reported
    // the failed folder's pending work would set hasMore.
    const cursor = serializeCursor(
      new Map([
        ['inbox', `${INBOX_DELTA}?$skiptoken=p2`],
        ['sentitems', `${SENT_DELTA}?$deltatoken=s1`],
      ] as const),
    );

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    expect(page.hasMore).toBe(false);
    // Its position is kept, so the folder resumes rather than re-backfilling.
    expect(parseCursor(page.cursor).get('inbox')).toBe(`${INBOX_DELTA}?$skiptoken=p2`);
  });

  it('throws when no folder on the mailbox can be read', async () => {
    // Reporting an empty page would clear the failure count on every tick, so a dead
    // mailbox would never retire and the user would never be told to reconnect.
    const fetcher = fakeFetch([
      { match: '/mailFolders/inbox', status: 500, body: {} },
      { match: '/mailFolders/sentitems', status: 500, body: {} },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
  });

  it('reports a refused credential rather than an unreachable server', async () => {
    const fetcher = fakeFetch([
      {
        match: '/mailFolders/inbox',
        status: 401,
        body: { error: { code: 'InvalidAuthenticationToken' } },
      },
      {
        match: '/mailFolders/sentitems',
        status: 401,
        body: { error: { code: 'InvalidAuthenticationToken' } },
      },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    // Where the folders agree the credential was refused, the account-level throw carries
    // that code — CONNECTION_FAILED would tell the rep to wait for a retry that can never
    // succeed, and burn the whole backoff ceiling doing it.
    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'PROVIDER_AUTH_EXPIRED' }),
    );
  });

  it('treats throttling as a connection failure, not a bad credential', async () => {
    // Telling a rep to reconnect does nothing for a limit that resets in a minute, and the
    // engine's backoff already handles the waiting.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      { match: INBOX_DELTA, status: 429, body: { error: { code: 'TooManyRequests' } } },
      { match: SENT_DELTA, status: 429, body: { error: { code: 'TooManyRequests' } } },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
  });

  it('refuses an IMAP credential', async () => {
    const provider = createGraphProvider(
      ACCOUNT_ADDRESS,
      [GRAPH_MAIL_READ_SCOPE],
      fakeFetch([]).fn,
    );

    await expect(
      provider.fetchSince(
        { kind: 'imap', host: 'h', port: 993, username: 'u', password: 'p', secure: true },
        null,
        SINCE,
      ),
    ).rejects.toThrow(expect.objectContaining({ code: 'PROVIDER_AUTH_EXPIRED' }));
  });

  it('counts a delta page with no continuation link as a folder failure', async () => {
    // Not an invalidation: that would re-read from null every tick while commitPage
    // cleared the failure count, so a persistently malformed folder would never retire and
    // never reach the user.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      { match: INBOX_DELTA, body: { value: [] }, contractViolation: true },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.cursorInvalid).toBe(false);
    // The healthy folder still advances; the broken one contributes no cursor entry.
    expect(parseCursor(page.cursor).has('inbox')).toBe(false);
    expect(parseCursor(page.cursor).get('sentitems')).toBe(`${SENT_DELTA}?$deltatoken=s1`);
  });
});

describe('testGraphAccess', () => {
  it('accepts a mailbox it can read', async () => {
    const fetcher = fakeFetch([{ match: '/mailFolders/inbox', body: { id: 'inbox-id' } }]);
    expect(await testGraphAccess('token', [GRAPH_MAIL_READ_SCOPE], fetcher.fn)).toEqual({
      ok: true,
    });
  });

  it('refuses a grant that cannot read mail without asking Microsoft', async () => {
    const fetcher = fakeFetch([]);
    const result = await testGraphAccess('token', ['openid'], fetcher.fn);
    expect(result).toMatchObject({ ok: false, code: INSUFFICIENT_SCOPE });
    expect(fetcher.urls).toHaveLength(0);
  });

  it('reports a mailbox that is gone as a dead credential', async () => {
    // Reporting it healthy would clear the failure count and put a dead mailbox back on
    // the schedule.
    const fetcher = fakeFetch([{ match: '/mailFolders/inbox', status: 404 }]);
    expect(await testGraphAccess('token', [GRAPH_MAIL_READ_SCOPE], fetcher.fn)).toMatchObject({
      ok: false,
      code: 'PROVIDER_AUTH_EXPIRED',
    });
  });

  it('reports a 200 carrying no id as a dead credential', async () => {
    const fetcher = fakeFetch([{ match: '/mailFolders/inbox', body: {}, contractViolation: true }]);
    expect(await testGraphAccess('token', [GRAPH_MAIL_READ_SCOPE], fetcher.fn)).toMatchObject({
      ok: false,
      code: 'PROVIDER_AUTH_EXPIRED',
    });
  });

  it('reports a refused token as needing a person', async () => {
    const fetcher = fakeFetch([
      {
        match: '/mailFolders/inbox',
        status: 401,
        body: { error: { code: 'InvalidAuthenticationToken' } },
      },
    ]);
    expect(await testGraphAccess('token', [GRAPH_MAIL_READ_SCOPE], fetcher.fn)).toMatchObject({
      ok: false,
      code: 'PROVIDER_AUTH_EXPIRED',
    });
  });

  it('reports throttling as a connection failure', async () => {
    const fetcher = fakeFetch([
      { match: '/mailFolders/inbox', status: 429, body: { error: { code: 'TooManyRequests' } } },
    ]);
    expect(await testGraphAccess('token', [GRAPH_MAIL_READ_SCOPE], fetcher.fn)).toMatchObject({
      ok: false,
      code: 'CONNECTION_FAILED',
    });
  });
});
