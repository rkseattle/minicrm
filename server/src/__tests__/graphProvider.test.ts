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

import { afterEach, describe, it, expect, vi } from 'vitest';

import type { OAuthAuthPayload } from '../services/connectedAccountService.js';
import {
  GRAPH_MAIL_READ_SCOPE,
  GRAPH_MAIL_READWRITE_SCOPE,
  GRAPH_MAIL_SEND_SCOPE,
  requestedScopes,
} from '../services/oauthProviderService.js';
import {
  createGraphProvider,
  INSUFFICIENT_SCOPE,
  parseCursor,
  REQUEST_TIMEOUT_MS,
  serializeCursor,
  testGraphAccess,
  type FetchLike,
} from '../services/mail/graphProvider.js';
import {
  SEND_AUTH_EXPIRED,
  SEND_NOT_SENT,
  SEND_OUTCOME_UNKNOWN,
  SEND_RATE_LIMITED,
  SEND_SCOPE_MISSING,
  SEND_TIMEOUT_MS,
} from '../services/mail/sendOutcome.js';
import { assertMatchesGraphSchema } from './graphSchema.js';
import { rejectOnAbort } from './mailFakes.js';

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
  /** Rejects the request at the transport, as undici does when the host is unreachable. */
  transportError?: true;
  /** The `cause.code` undici attaches to a transport failure. */
  transportCause?: string;
  /** Never answers until the driver's own timer aborts it. */
  hangs?: true;
  /** Answers, then the body stops arriving until the driver's own timer aborts it. */
  bodyHangs?: true;
  /** Answers, then the connection drops mid-body, as undici reports it. */
  bodyTerminated?: true;
  /** Rejects `json()` the way a truncated or non-JSON body does. */
  malformedJson?: true;
  retryAfter?: string;
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
  if (path.endsWith('/me/messages')) return 'CreatedDraft';
  if (path.includes('/messages/delta')) return 'DeltaResponse';
  if (path.includes('/mailFolders/')) return 'MailFolder';
  return null;
}

/** Records every request the driver makes and answers from a route table. */
function fakeFetch(routes: Route[]): {
  fn: FetchLike;
  urls: string[];
  headers: HeadersInit[];
  inits: RequestInit[];
} {
  const urls: string[] = [];
  const headers: HeadersInit[] = [];
  const inits: RequestInit[] = [];
  const fn: FetchLike = (url, init) => {
    urls.push(url);
    inits.push(init);
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
    if (route?.transportError) {
      const cause = route.transportCause ? { cause: { code: route.transportCause } } : {};
      return Promise.reject(Object.assign(new TypeError('fetch failed'), cause));
    }
    if (route?.hangs) return rejectOnAbort(init);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => (name === 'retry-after' ? (route?.retryAfter ?? null) : null),
      },
      json: () => {
        if (route?.bodyHangs) return rejectOnAbort(init);
        if (route?.bodyTerminated) {
          return Promise.reject(
            Object.assign(new TypeError('terminated'), { cause: { code: 'UND_ERR_SOCKET' } }),
          );
        }
        if (route?.malformedJson) return Promise.reject(new SyntaxError('Unexpected end of JSON'));
        const body = route?.body ?? {};
        const schema =
          status >= 200 && status < 300 && !route?.contractViolation ? schemaForUrl(url) : null;
        if (schema) assertMatchesGraphSchema(schema, body);
        return Promise.resolve(body);
      },
      arrayBuffer: () => {
        if (route?.bodyHangs) return rejectOnAbort(init);
        const source = route?.source ?? Buffer.alloc(0);
        // A fresh ArrayBuffer, not a view onto Node's pooled one: Buffer.buffer is
        // ArrayBufferLike, which is wider than what a real Response returns.
        const copy = new ArrayBuffer(source.byteLength);
        new Uint8Array(copy).set(source);
        return Promise.resolve(copy);
      },
    });
  };
  return { fn, urls, headers, inits };
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

  it('does not serve one message from another whose id it prefixes before a query', async () => {
    // The `&` half of the boundary rule: a resumed link carries more parameters after the
    // token, so a matcher that stopped at `?` alone would collide there.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: {
          value: [{ id: 'm1', conversationId: 'c1', receivedDateTime: RECENT }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1&$select=id`,
        },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
      { match: '/messages/m1/$value', source: rawMessage({ from: 'right@example.com' }) },
      { match: '/messages/m10/$value', source: rawMessage({ from: 'wrong@example.com' }) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages[0].fromAddress).toBe('right@example.com');
    expect(parseCursor(page.cursor).get('inbox')?.link).toBe(
      `${INBOX_DELTA}?$deltatoken=d1&$select=id`,
    );
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
        ['inbox', { link: `${INBOX_DELTA}?$deltatoken=a`, opening: false }],
        ['sentitems', { link: `${SENT_DELTA}?$deltatoken=b`, opening: false }],
      ] as const),
    );
    expect(parseCursor(cursor).get('inbox')?.link).toBe(`${INBOX_DELTA}?$deltatoken=a`);
    expect(parseCursor(cursor).get('sentitems')?.link).toBe(`${SENT_DELTA}?$deltatoken=b`);
  });

  it('treats an unparseable cursor as absent rather than throwing', () => {
    expect(parseCursor('not json').size).toBe(0);
    expect(parseCursor('[]').size).toBe(0);
    expect(parseCursor(null).size).toBe(0);
  });

  it('drops a link pointing anywhere but Graph', () => {
    // The driver replays a stored link with a bearer token attached, so a tampered row
    // must not be able to redirect that token.
    const cursor = JSON.stringify({
      inbox: { link: 'https://evil.example.com/steal', opening: false },
    });
    expect(parseCursor(cursor).size).toBe(0);
  });

  it('reads an entry with no phase as still opening', () => {
    // The safe direction: one window filter applied to an incremental page costs a page,
    // where the opposite mistake ingests everything the mailbox has ever held.
    const cursor = JSON.stringify({ inbox: { link: `${INBOX_DELTA}?$skiptoken=p2` } });
    expect(parseCursor(cursor).get('inbox')?.opening).toBe(true);
  });

  it('drops a folder it does not sync', () => {
    const cursor = JSON.stringify({
      drafts: { link: `${GRAPH}/mailFolders/x/messages/delta`, opening: false },
    });
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
    expect(stored.get('inbox')).toEqual({ link: `${INBOX_DELTA}?$deltatoken=d1`, opening: false });
    expect(stored.get('sentitems')).toEqual({
      link: `${SENT_DELTA}?$deltatoken=s1`,
      opening: false,
    });
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
    // The phase, not just the link: a page stored as finished makes page two read as
    // incremental, which drops the window and ingests the mailbox's whole history.
    expect(parseCursor(page.cursor).get('inbox')).toEqual({
      link: `${INBOX_DELTA}?$skiptoken=p2`,
      opening: true,
    });
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
        ['inbox', { link: `${INBOX_DELTA}?$skiptoken=p2`, opening: true }],
        ['sentitems', { link: `${SENT_DELTA}?$deltatoken=s1`, opening: false }],
      ] as const),
    );

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    // The resolve endpoint, not the delta URL that embeds the resolved id.
    expect(fetcher.urls.some((url) => url.endsWith('/mailFolders/inbox'))).toBe(false);
    expect(parseCursor(page.cursor).get('inbox')?.link).toBe(`${INBOX_DELTA}?$deltatoken=d2`);
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
        ['inbox', { link: `${INBOX_DELTA}?$deltatoken=d1`, opening: false }],
        ['sentitems', { link: `${SENT_DELTA}?$deltatoken=s1`, opening: false }],
      ] as const),
    );

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    expect(page.messages).toHaveLength(0);
    expect(page.cursorInvalid).toBe(false);
    expect(parseCursor(page.cursor).get('inbox')?.link).toBe(`${INBOX_DELTA}?$deltatoken=d2`);
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
        ['inbox', { link: `${INBOX_DELTA}?$deltatoken=d1`, opening: false }],
        ['sentitems', { link: `${SENT_DELTA}?$deltatoken=s1`, opening: false }],
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
    expect(parseCursor(page.cursor).get('sentitems')?.link).toBe(`${SENT_DELTA}?$deltatoken=s1`);
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
    const cursor = serializeCursor(
      new Map([['inbox', { link: `${INBOX_DELTA}?$skiptoken=p2`, opening: true }]] as const),
    );

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
        ['inbox', { link: `${INBOX_DELTA}?$deltatoken=old`, opening: false }],
        ['sentitems', { link: `${SENT_DELTA}?$deltatoken=s1`, opening: false }],
      ] as const),
    );

    const page = await provider.fetchSince(AUTH, cursor, SINCE);

    expect(page.cursorInvalid).toBe(true);
    expect(fetcher.urls.some((url) => url.includes('$value'))).toBe(false);
  });
});

describe('createGraphProvider — the phase a page records', () => {
  it('still applies the window on the page its own cursor resumes', async () => {
    // The two halves of the invariant, connected: page one's OUTPUT cursor is what page
    // two is driven with, so a phase written wrong here is a mailbox's entire history.
    const first = fakeFetch([
      ...FOLDER_ROUTES,
      {
        match: INBOX_DELTA,
        body: { value: [], '@odata.nextLink': `${INBOX_DELTA}?$skiptoken=p2` },
      },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const pageOne = await createGraphProvider(
      ACCOUNT_ADDRESS,
      [GRAPH_MAIL_READ_SCOPE],
      first.fn,
    ).fetchSince(AUTH, null, SINCE);

    const second = fakeFetch([
      {
        match: `${INBOX_DELTA}?$skiptoken=p2`,
        body: {
          value: [{ id: 'old', conversationId: 'c1', receivedDateTime: '2019-01-01T00:00:00Z' }],
          '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
        },
      },
      { match: `${SENT_DELTA}?$deltatoken=s1`, body: emptyRound(`${SENT_DELTA}?$deltatoken=s2`) },
    ]);
    const pageTwo = await createGraphProvider(
      ACCOUNT_ADDRESS,
      [GRAPH_MAIL_READ_SCOPE],
      second.fn,
    ).fetchSince(AUTH, pageOne.cursor, SINCE);

    expect(pageTwo.messages).toHaveLength(0);
    expect(second.urls.some((url) => url.includes('$value'))).toBe(false);
  });

  it('records a completed round as finished', async () => {
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      { match: INBOX_DELTA, body: emptyRound(`${INBOX_DELTA}?$deltatoken=d1`) },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(parseCursor(page.cursor).get('inbox')?.opening).toBe(false);
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
        ['inbox', { link: `${INBOX_DELTA}?$deltatoken=old`, opening: false }],
        ['sentitems', { link: `${SENT_DELTA}?$deltatoken=s1`, opening: false }],
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
        ['inbox', { link: `${INBOX_DELTA}?$deltatoken=old`, opening: false }],
        ['sentitems', { link: `${SENT_DELTA}?$deltatoken=s1`, opening: false }],
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
    const cursor = serializeCursor(
      new Map([
        ['inbox', { link: `${INBOX_DELTA}?$deltatoken=old`, opening: false }],
        ['sentitems', { link: `${SENT_DELTA}?$deltatoken=s1`, opening: false }],
      ] as const),
    );

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
    expect(page.messages[0].references).toBe('<root@example.com> <second@example.com>');
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
  it('throws when every folder is absent', async () => {
    // The only path to the readable-folder guard: any other failure throws out of
    // readFolder first. Inbox is not a folder a live mailbox lacks, so a 404 on all of
    // them means the token cannot see the mailbox — reporting an empty page would clear
    // the failure count every tick and the mailbox would never be retired.
    const fetcher = fakeFetch([
      { match: '/mailFolders/inbox', status: 404 },
      { match: '/mailFolders/sentitems', status: 404 },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
  });

  it('fails the page when one folder cannot be read', async () => {
    // Not skipped: a page reported as a success clears the failure count, so a folder
    // failing forever would be retried forever — never retired, never surfaced to the
    // user. Failing lets the engine's backoff and ceiling do their job.
    const fetcher = fakeFetch([
      { match: `${INBOX_DELTA}?$deltatoken=d1`, status: 500, body: {} },
      { match: `${SENT_DELTA}?$deltatoken=s1`, body: emptyRound(`${SENT_DELTA}?$deltatoken=s2`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);
    const cursor = serializeCursor(
      new Map([
        ['inbox', { link: `${INBOX_DELTA}?$deltatoken=d1`, opening: false }],
        ['sentitems', { link: `${SENT_DELTA}?$deltatoken=s1`, opening: false }],
      ] as const),
    );

    await expect(provider.fetchSince(AUTH, cursor, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
  });

  it('carries a refused credential up rather than reporting it unreachable', async () => {
    // The code decides the advice the user is given: PROVIDER_AUTH_EXPIRED asks them to
    // reconnect, where CONNECTION_FAILED tells them to wait for a retry that can never
    // succeed.
    const fetcher = fakeFetch([
      {
        match: '/mailFolders/inbox',
        status: 401,
        body: { error: { code: 'InvalidAuthenticationToken' } },
      },
      { match: '/mailFolders/sentitems', body: { id: 'sent-id' } },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'PROVIDER_AUTH_EXPIRED' }),
    );
  });

  it('stops at the first unreadable folder rather than reading on', async () => {
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

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'PROVIDER_AUTH_EXPIRED' }),
    );
    // The page fails at the first folder, so the second is never requested — a spent
    // request against a mailbox already known to be failing.
    expect(fetcher.urls.some((url) => url.includes('sentitems'))).toBe(false);
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

  it('fails the page when a delta response carries no continuation link', async () => {
    // Not an invalidation: that would re-read from null every tick while commitPage
    // cleared the failure count, so a persistently malformed folder would never retire and
    // never reach the user. Failing puts it under the engine's backoff instead.
    const fetcher = fakeFetch([
      ...FOLDER_ROUTES,
      { match: INBOX_DELTA, body: { value: [] }, contractViolation: true },
      { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
  });
});

describe('createGraphProvider — failures reading a body', () => {
  const listing: Route[] = [
    ...FOLDER_ROUTES,
    {
      match: INBOX_DELTA,
      body: {
        value: [{ id: 'm1', conversationId: 'c1', receivedDateTime: RECENT }],
        '@odata.deltaLink': `${INBOX_DELTA}?$deltatoken=d1`,
      },
    },
    { match: SENT_DELTA, body: emptyRound(`${SENT_DELTA}?$deltatoken=s1`) },
  ];

  it('reads a throttled body fetch as a connection failure', async () => {
    // The error envelope decides it: a 4xx on $value is otherwise indistinguishable from
    // a refused credential, and telling a rep to reconnect does nothing for a rate limit.
    const fetcher = fakeFetch([
      ...listing,
      {
        match: '/messages/m1/$value',
        status: 429,
        body: { error: { code: 'TooManyRequests' } },
        retryAfter: '30',
      },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
  });

  it('reads a refused body fetch as a dead credential', async () => {
    const fetcher = fakeFetch([
      ...listing,
      {
        match: '/messages/m1/$value',
        status: 401,
        body: { error: { code: 'InvalidAuthenticationToken' } },
      },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'PROVIDER_AUTH_EXPIRED' }),
    );
  });

  it('survives a failure whose own error body will not parse', async () => {
    const fetcher = fakeFetch([
      ...listing,
      { match: '/messages/m1/$value', status: 500, malformedJson: true },
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
  });
});

describe('createGraphProvider — transport failures', () => {
  it('reads an unreachable host as a connection failure', async () => {
    // undici reports every transport failure as the same TypeError, so the driver cannot
    // classify it further than "unreachable" — but it must not escape uncoded, which
    // would land as the generic SYNC_FAILED.
    const fetcher = fakeFetch([{ match: '/mailFolders/inbox', transportError: true }]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
  });

  it('reads a truncated JSON body as a connection failure', async () => {
    const fetcher = fakeFetch([{ match: '/mailFolders/inbox', malformedJson: true }]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
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

describe('createGraphProvider — send', () => {
  const SEND_SCOPES = [GRAPH_MAIL_READ_SCOPE, GRAPH_MAIL_SEND_SCOPE, GRAPH_MAIL_READWRITE_SCOPE];
  const MIME = Buffer.from('From: rep@example.com\r\nSubject: Hi ÿ\r\n\r\nHello\r\n', 'utf8');
  const DRAFTS = `${GRAPH}/messages`;
  const DRAFT = `${GRAPH}/messages/draft-1`;
  const DRAFT_SEND = `${DRAFT}/send`;
  const CREATED: Route = { match: DRAFTS, status: 201, body: { id: 'draft-1' } };

  /** Sends through a provider whose draft is created and whose send answers with `route`. */
  async function sendWith(sendRoute: Omit<Route, 'match'>, deleteRoute?: Omit<Route, 'match'>) {
    const fetcher = fakeFetch([
      { match: DRAFT_SEND, ...sendRoute },
      { match: DRAFT, status: 204, ...deleteRoute },
      CREATED,
    ]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, SEND_SCOPES, fetcher.fn);
    const outcome = provider.send?.(AUTH, MIME, null);
    return { fetcher, outcome };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a draft from the document, sends it, and returns the draft’s immutable id', async () => {
    const { fetcher, outcome } = await sendWith({ status: 202 });

    expect(await outcome).toEqual({ providerMessageId: 'draft-1' });
    expect(fetcher.urls).toEqual([DRAFTS, DRAFT_SEND]);
    expect(fetcher.inits.map((init) => init.method)).toEqual(['POST', 'POST']);
    expect(Buffer.from(String(fetcher.inits[0].body), 'base64').equals(MIME)).toBe(true);
    expect(fetcher.headers[0]).toMatchObject({
      'Content-Type': 'text/plain',
      Prefer: 'IdType="ImmutableId"',
    });
    expect(fetcher.headers[1]).toMatchObject({ Prefer: 'IdType="ImmutableId"' });
  });

  it('still syncs a mailbox connected before send needed Mail.ReadWrite, and refuses only the send', async () => {
    const fetcher = fakeFetch([]);
    const provider = createGraphProvider(
      ACCOUNT_ADDRESS,
      [GRAPH_MAIL_READ_SCOPE, GRAPH_MAIL_SEND_SCOPE],
      fetcher.fn,
    );

    await expect(provider.send?.(AUTH, MIME, null)).rejects.toMatchObject({
      code: SEND_SCOPE_MISSING,
    });
    expect(fetcher.urls).toHaveLength(0);
  });

  it('refuses a grant that can create drafts but not send them', async () => {
    const fetcher = fakeFetch([]);
    const provider = createGraphProvider(
      ACCOUNT_ADDRESS,
      [GRAPH_MAIL_READ_SCOPE, GRAPH_MAIL_READWRITE_SCOPE],
      fetcher.fn,
    );

    await expect(provider.send?.(AUTH, MIME, null)).rejects.toMatchObject({
      code: SEND_SCOPE_MISSING,
    });
    expect(fetcher.urls).toHaveLength(0);
  });

  it('is granted everything it needs by the consent Microsoft is asked for', async () => {
    const fetcher = fakeFetch([{ match: DRAFT_SEND, status: 202 }, CREATED]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, requestedScopes('microsoft'), fetcher.fn);

    await expect(provider.send?.(AUTH, MIME, null)).resolves.toEqual({
      providerMessageId: 'draft-1',
    });
  });

  it('accepts the bare scope names Microsoft may echo back', async () => {
    const fetcher = fakeFetch([{ match: DRAFT_SEND, status: 202 }, CREATED]);
    const provider = createGraphProvider(
      ACCOUNT_ADDRESS,
      ['Mail.Read', 'Mail.Send', 'Mail.ReadWrite'],
      fetcher.fn,
    );

    await expect(provider.send?.(AUTH, MIME, null)).resolves.toEqual({
      providerMessageId: 'draft-1',
    });
  });

  it('refuses an account whose credentials are not OAuth, before any request', async () => {
    const fetcher = fakeFetch([]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, SEND_SCOPES, fetcher.fn);

    await expect(
      provider.send?.(
        { kind: 'imap', host: 'h', port: 993, username: 'u', password: 'p', secure: true },
        MIME,
        null,
      ),
    ).rejects.toMatchObject({ code: SEND_AUTH_EXPIRED });
    expect(fetcher.urls).toHaveLength(0);
  });

  describe('a draft that cannot be created sends nothing', () => {
    it.each([
      [401, {}, SEND_AUTH_EXPIRED],
      [429, {}, SEND_RATE_LIMITED],
      [400, { error: { code: 'ErrorMimeContentInvalidBase64String' } }, SEND_NOT_SENT],
      [503, {}, SEND_NOT_SENT],
    ])('maps a %i answer to %s', async (status, body, code) => {
      const fetcher = fakeFetch([{ match: DRAFTS, status, body }]);
      const provider = createGraphProvider(ACCOUNT_ADDRESS, SEND_SCOPES, fetcher.fn);

      await expect(provider.send?.(AUTH, MIME, null)).rejects.toMatchObject({ code });
      expect(fetcher.urls).toEqual([DRAFTS]);
    });

    it('treats a creation that timed out as not sent', async () => {
      vi.useFakeTimers();
      const fetcher = fakeFetch([{ match: DRAFTS, hangs: true }]);
      const provider = createGraphProvider(ACCOUNT_ADDRESS, SEND_SCOPES, fetcher.fn);

      const outcome = expect(provider.send?.(AUTH, MIME, null)).rejects.toMatchObject({
        code: SEND_NOT_SENT,
      });
      // Creating a draft sends nothing, so it takes a read's bound rather than a send's.
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await outcome;
      expect(fetcher.urls).toEqual([DRAFTS]);
    });

    it('treats a created draft with no id as not sent', async () => {
      const fetcher = fakeFetch([
        { match: DRAFTS, status: 201, body: {}, contractViolation: true },
      ]);
      const provider = createGraphProvider(ACCOUNT_ADDRESS, SEND_SCOPES, fetcher.fn);

      await expect(provider.send?.(AUTH, MIME, null)).rejects.toMatchObject({
        code: SEND_NOT_SENT,
      });
      expect(fetcher.urls).toEqual([DRAFTS]);
    });

    it('treats a created draft whose body was cut off as not sent', async () => {
      const fetcher = fakeFetch([{ match: DRAFTS, status: 201, bodyTerminated: true }]);
      const provider = createGraphProvider(ACCOUNT_ADDRESS, SEND_SCOPES, fetcher.fn);

      await expect(provider.send?.(AUTH, MIME, null)).rejects.toMatchObject({
        code: SEND_NOT_SENT,
      });
      expect(fetcher.urls).toEqual([DRAFTS]);
    });

    it('treats a created draft whose body will not decode as not sent', async () => {
      const fetcher = fakeFetch([{ match: DRAFTS, status: 201, malformedJson: true }]);
      const provider = createGraphProvider(ACCOUNT_ADDRESS, SEND_SCOPES, fetcher.fn);

      await expect(provider.send?.(AUTH, MIME, null)).rejects.toMatchObject({
        code: SEND_NOT_SENT,
      });
    });
  });

  describe('a send refused outright deletes its draft', () => {
    it.each([
      [400, {}, SEND_NOT_SENT],
      [401, {}, SEND_AUTH_EXPIRED],
      [429, {}, SEND_RATE_LIMITED],
      [403, { error: { code: 'ApplicationThrottled' } }, SEND_RATE_LIMITED],
      [403, { error: { code: 'InvalidAuthenticationToken' } }, SEND_AUTH_EXPIRED],
      [403, { error: { code: 'ErrorSendAsDenied' } }, SEND_NOT_SENT],
      [403, {}, SEND_NOT_SENT],
    ])('a %i answer is %s, and the draft is deleted', async (status, body, code) => {
      const { fetcher, outcome } = await sendWith({ status, body });

      await expect(outcome).rejects.toMatchObject({ code });
      expect(fetcher.urls[2]).toBe(DRAFT);
      expect(fetcher.inits[2].method).toBe('DELETE');
    });

    it('a connection that never opened is not sent, and the draft is deleted', async () => {
      const { fetcher, outcome } = await sendWith({
        transportError: true,
        transportCause: 'ECONNREFUSED',
      });

      await expect(outcome).rejects.toMatchObject({ code: SEND_NOT_SENT });
      expect(fetcher.inits[2]?.method).toBe('DELETE');
    });

    it('classifies a refusal on its status even when its body is cut off', async () => {
      const { fetcher, outcome } = await sendWith({ status: 400, bodyTerminated: true });

      await expect(outcome).rejects.toMatchObject({ code: SEND_NOT_SENT });
      expect(fetcher.inits[2]?.method).toBe('DELETE');
    });

    it('reports a send as sent once Microsoft accepted it, whatever its body does', async () => {
      const { outcome } = await sendWith({ status: 202, bodyTerminated: true });

      await expect(outcome).resolves.toEqual({ providerMessageId: 'draft-1' });
    });

    it('reports the refused send, not the cleanup, when the delete is refused', async () => {
      const { outcome } = await sendWith({ status: 400 }, { status: 500 });

      await expect(outcome).rejects.toMatchObject({ code: SEND_NOT_SENT });
    });

    it('reports the refused send, not the cleanup, when the delete gets no answer', async () => {
      const { outcome } = await sendWith({ status: 400 }, { transportError: true });

      await expect(outcome).rejects.toMatchObject({ code: SEND_NOT_SENT });
    });
  });

  describe('a send that may have gone keeps its draft', () => {
    it.each([500, 502, 503, 504])('a %i answer is possibly sent', async (status) => {
      const { fetcher, outcome } = await sendWith({ status, body: {} });

      await expect(outcome).rejects.toMatchObject({ code: SEND_OUTCOME_UNKNOWN });
      expect(fetcher.urls).toEqual([DRAFTS, DRAFT_SEND]);
    });

    it('a connection lost mid-request is possibly sent', async () => {
      const { fetcher, outcome } = await sendWith({
        transportError: true,
        transportCause: 'ECONNRESET',
      });

      await expect(outcome).rejects.toMatchObject({ code: SEND_OUTCOME_UNKNOWN });
      expect(fetcher.urls).toEqual([DRAFTS, DRAFT_SEND]);
    });

    it('a timed-out send is possibly sent and never retried', async () => {
      vi.useFakeTimers();
      const { fetcher, outcome } = await sendWith({ hangs: true });
      let done = false;
      const tracked = outcome?.finally(() => {
        done = true;
      });
      const settled = expect(tracked).rejects.toMatchObject({ code: SEND_OUTCOME_UNKNOWN });

      // The send runs under its own, longer bound, not a read's.
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
      await settled;
      expect(fetcher.urls).toEqual([DRAFTS, DRAFT_SEND]);
    });
  });

  it('never puts the provider’s own words in the error', async () => {
    const { outcome } = await sendWith({ status: 400, body: { error: { message: 'detail' } } });

    await expect(outcome).rejects.toThrow(/^Outlook did not accept the message\.$/);
  });
});

describe('createGraphProvider — a body that stops arriving', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('bounds the body read, not just the headers, and reports the mailbox unreachable', async () => {
    vi.useFakeTimers();
    const fetcher = fakeFetch([{ match: '/mailFolders/inbox', bodyHangs: true }]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    const outcome = expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await outcome;
  });
});

describe('createGraphProvider — a body cut off mid-stream', () => {
  it('reports the mailbox unreachable rather than leaking the transport error', async () => {
    const fetcher = fakeFetch([{ match: '/mailFolders/inbox', bodyTerminated: true }]);
    const provider = createGraphProvider(ACCOUNT_ADDRESS, [GRAPH_MAIL_READ_SCOPE], fetcher.fn);

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toThrow(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
  });
});
