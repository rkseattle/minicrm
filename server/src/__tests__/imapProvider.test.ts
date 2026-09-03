/**
 * IMAP provider behavior, driven by a fake ImapFlow.
 *
 * Injected rather than vi.mock'd, following getUsableAccessToken's injected refresh: the
 * seam is the client factory, and a fake makes UIDVALIDITY changes and odd server
 * responses reproducible on demand, which a real server cannot be made to do.
 */

import type { ImapFlow } from 'imapflow';

import logger from '../logger.js';
import { createImapProvider, parseCursor, serializeCursor } from '../services/mail/imapProvider.js';
import type { ImapAuthPayload } from '../services/connectedAccountService.js';

const ACCOUNT_ADDRESS = 'rep@example.com';

const AUTH: ImapAuthPayload = {
  kind: 'imap',
  host: 'imap.example.com',
  port: 993,
  username: ACCOUNT_ADDRESS,
  password: 'imap-password-value',
  secure: true,
};

interface FakeMessage {
  uid: number;
  from: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  referencesHeader?: string;
  date?: Date;
  /** The server's own INTERNALDATE, which is a different field from the header date. */
  internalDate?: Date;
  bodyStructure?: unknown;
  /** RFC822.SIZE, which the server reports without transferring the body. */
  size?: number;
  /** Raw MIME the server returns for BODY.PEEK[], when the body pass asks for it. */
  source?: string;
}

interface FakeMailbox {
  path: string;
  uidValidity: string;
  uidNext: number;
  /** A flag the SERVER advertised, as an RFC 6154 SPECIAL-USE capable server would. */
  specialUse?: string;
  messages: FakeMessage[];
  /**
   * Order the server hands messages back in.
   *
   * RFC 3501 §7.4.2 puts no ordering on untagged FETCH responses, and imapflow yields
   * them as they arrive — `onUntaggedFetch` pushes onto a queue the iterator shifts off,
   * with no sort anywhere. A fake that always ascends cannot see a cap that assumes one.
   */
  arrivalOrder?: 'ascending' | 'descending';
  /** Set to make SELECT fail, as a folder renamed or deleted between LIST and SELECT does. */
  failsToOpen?: string;
  /**
   * Suppresses imapflow's own leaf-name special-use guess, as happens for a folder whose
   * name is not in its localized index. Without this the name guess always fires and the
   * whole-path fallback can never be the deciding branch.
   */
  suppressNameGuess?: boolean;
  /** Hierarchy delimiter, which determines what `name` is a leaf of. */
  delimiter?: string;
}

/**
 * Applies a fetch query the way a server would.
 *
 * A `uid` range is resolved per RFC 3501 §6.4.8: `*` is the mailbox's highest existing UID,
 * and the range is order-independent, so `500:*` over a mailbox topping out at 499 covers
 * 499 through 500 rather than being empty. Reproducing that is the whole point — it is the
 * behavior an open-ended resume query gets wrong.
 */
function selectMessages(messages: FakeMessage[], query: unknown): FakeMessage[] {
  const uidRange = (query as { uid?: string }).uid;
  if (uidRange) {
    const highestUid = messages.reduce((highest, m) => Math.max(highest, m.uid), 0);
    const bound = (token: string): number => (token === '*' ? highestUid : Number(token));
    // RFC 3501 §9 sequence-set: comma-separated items, each a single UID or a range.
    // Splitting on ':' alone turns "3,7,11" into NaN, which matches nothing silently.
    const selected = new Set<number>();
    for (const item of uidRange.split(',')) {
      const [start, end = start] = item.split(':').map(bound);
      const [low, high] = start <= end ? [start, end] : [end, start];
      for (const m of messages) {
        if (m.uid >= low && m.uid <= high) selected.add(m.uid);
      }
    }
    return messages.filter((m) => selected.has(m.uid));
  }

  const since = (query as { since?: Date }).since;
  if (since) {
    // A server filters on its own internal date, so a message whose header date is absent
    // or unparseable is still returned — it is the provider's job to cope with it.
    return messages.filter((m) => {
      if (!m.date || Number.isNaN(m.date.getTime())) return true;
      return m.date >= since;
    });
  }

  throw new Error(`fake ImapFlow: unsupported fetch query ${JSON.stringify(query)}`);
}

/**
 * A stand-in for ImapFlow covering only what the provider calls.
 *
 * The fetch HONORS its query rather than yielding everything: a fake that ignores the
 * query makes every resumption test an assertion about a string the provider built, which
 * is how an open-ended `uid` range that re-delivered the top message forever passed a
 * green suite. `fetchCalls` still records each query, but it is the weaker assertion.
 */
function makeFakeClient(mailboxes: FakeMailbox[]): {
  client: ImapFlow;
  fetchCalls: Array<{ path: string; query: unknown; options?: unknown; uid?: unknown }>;
  loggedOut: () => boolean;
} {
  const fetchCalls: Array<{ path: string; query: unknown; options?: unknown; uid?: unknown }> = [];
  let didLogout = false;
  let open: FakeMailbox | undefined;

  const client = {
    list: async () => {
      // imapflow reports `name` as the last path segment, not the whole path. A fake that
      // conflates them hides every defect in code that reads one and means the other.
      const entries = mailboxes.map((m) => {
        const delimiter = m.delimiter ?? '/';
        const segments = m.path.split(delimiter);
        return {
          path: m.path,
          name: segments[segments.length - 1],
          delimiter,
          specialUse: m.specialUse,
          specialUseSource: m.specialUse ? 'extension' : undefined,
        };
      });

      // imapflow ALSO derives specialUse from its own localized leaf-name index when the
      // server advertises none, and when several folders share a leaf it awards the flag
      // to exactly one, by path.localeCompare. A fake that omits this cannot see code
      // that mistakes a guess for the server's word.
      const named = entries
        .filter(
          (e, i) =>
            !e.specialUse &&
            !mailboxes[i].suppressNameGuess &&
            SENT_LEAF_NAMES.includes(e.name.toLowerCase()),
        )
        .sort((a, b) => a.path.localeCompare(b.path));
      if (named.length > 0 && !entries.some((e) => e.specialUse === SENT_FLAG)) {
        named[0].specialUse = SENT_FLAG;
        named[0].specialUseSource = 'name';
      }

      return entries;
    },
    getMailboxLock: async (path: string) => {
      const target = mailboxes.find((m) => m.path === path);
      if (!target) throw new Error(`no such mailbox ${path}`);
      if (target.failsToOpen) throw new Error(target.failsToOpen);
      open = target;
      return { path, release: () => undefined };
    },
    get mailbox() {
      return open
        ? { path: open.path, uidValidity: BigInt(open.uidValidity), uidNext: open.uidNext }
        : false;
    },
    // The options argument is honoured rather than ignored: a fake that returns every
    // field regardless of what was asked cannot fail when the provider requests the wrong
    // one, which is the defect the body pass is most likely to have.
    // imapflow's signature is fetch(range, query, options); `query` here is the range it
    // selects by, `options` the fields it returns, and `uid` the third argument. The
    // third is recorded because reading a UID set as sequence numbers would attach every
    // body to the wrong message, and no assertion on the bodies themselves shows that.
    fetch: (query: unknown, options?: unknown, uid?: unknown) => {
      const mailbox = open;
      fetchCalls.push({ path: mailbox?.path ?? '(none)', query, options, uid });
      const wants = (options ?? {}) as { source?: boolean; size?: boolean };
      const selected = selectMessages(mailbox?.messages ?? [], query);
      const messages = mailbox?.arrivalOrder === 'descending' ? [...selected].reverse() : selected;
      return (async function* () {
        for (const m of messages) {
          if (wants.source) {
            // The body pass asks for the raw document and nothing else.
            yield {
              uid: m.uid,
              source: m.source === undefined ? undefined : Buffer.from(m.source, 'utf8'),
            };
            continue;
          }
          yield {
            uid: m.uid,
            envelope: {
              from: [{ address: m.from }],
              to: (m.to ?? []).map((address) => ({ address })),
              cc: (m.cc ?? []).map((address) => ({ address })),
              subject: m.subject,
              messageId: m.messageId,
              inReplyTo: m.inReplyTo,
              date: m.date,
            },
            internalDate: m.internalDate ?? m.date,
            bodyStructure: m.bodyStructure,
            size: wants.size ? m.size : undefined,
            headers: m.referencesHeader ? Buffer.from(m.referencesHeader, 'utf8') : undefined,
          };
        }
      })();
    },
    logout: async () => {
      didLogout = true;
    },
    close: () => undefined,
  } as unknown as ImapFlow;

  return { client, fetchCalls, loggedOut: () => didLogout };
}

function inbox(messages: FakeMessage[], overrides: Partial<FakeMailbox> = {}): FakeMailbox {
  return { path: 'INBOX', uidValidity: '900', uidNext: 10, messages, ...overrides };
}

const SINCE = new Date('2026-06-01T00:00:00Z');

/** What imapflow's own name index treats as a sent-mail folder. */
const SENT_LEAF_NAMES = ['sent', 'sent items', 'sent mail', 'sent messages'];
const SENT_FLAG = '\\Sent';

/** Builds a stored cursor without restating its encoding at every call site. */
function cursorOf(entries: Record<string, { uidValidity: string; uidNext: number }>): string {
  return serializeCursor(new Map(Object.entries(entries)));
}

/**
 * A provider whose SSRF guard is stubbed out.
 *
 * The real guard resolves the host over DNS, and these fixtures name hosts that do not
 * exist. Stubbing it is deliberate and explicit — the guard's own behavior is asserted
 * separately, against the real one.
 */
function providerWith(client: ImapFlow): ReturnType<typeof createImapProvider> {
  return createImapProvider(
    ACCOUNT_ADDRESS,
    async () => client,
    async () => undefined,
  );
}

describe('the cursor codec', () => {
  it('round-trips one mailbox', () => {
    const parsed = parseCursor(
      serializeCursor(new Map([['INBOX', { uidValidity: '900', uidNext: 42 }]])),
    );
    expect(parsed.get('INBOX')).toEqual({ uidValidity: '900', uidNext: 42 });
  });

  it('round-trips several mailboxes', () => {
    const source = new Map([
      ['INBOX', { uidValidity: '900', uidNext: 42 }],
      ['Sent', { uidValidity: '901', uidNext: 7 }],
    ]);
    const parsed = parseCursor(serializeCursor(source));
    expect(parsed.size).toBe(2);
    expect(parsed.get('Sent')).toEqual({ uidValidity: '901', uidNext: 7 });
  });

  it('round-trips a path containing a colon, which is a hierarchy delimiter', () => {
    // A delimited encoding splits this path into the wrong fields, and the mailbox then
    // looks never-synced on every tick and re-delivers its entire history.
    const source = new Map([['Sent:Items', { uidValidity: '901', uidNext: 5 }]]);
    expect(parseCursor(serializeCursor(source)).get('Sent:Items')).toEqual({
      uidValidity: '901',
      uidNext: 5,
    });
  });

  it('round-trips a path containing a pipe', () => {
    const source = new Map([['Odd|Name', { uidValidity: '901', uidNext: 5 }]]);
    expect(parseCursor(serializeCursor(source)).get('Odd|Name')).toEqual({
      uidValidity: '901',
      uidNext: 5,
    });
  });

  it('round-trips a path containing quotes and backslashes', () => {
    const path = 'We"ird\\Folder';
    const source = new Map([[path, { uidValidity: '901', uidNext: 5 }]]);
    expect(parseCursor(serializeCursor(source)).get(path)).toEqual({
      uidValidity: '901',
      uidNext: 5,
    });
  });

  it('treats a null cursor as nothing synced yet', () => {
    expect(parseCursor(null).size).toBe(0);
  });

  it('discards a cursor that is not JSON rather than refusing to sync', () => {
    // The delimited encoding this replaced. A stored cursor in the old shape must degrade
    // to a bounded re-backfill, not to a parse that yields wrong mailbox positions.
    expect(parseCursor('INBOX:900:42').size).toBe(0);
  });

  it('drops an unusable entry rather than refusing the whole cursor', () => {
    const cursor = JSON.stringify({
      INBOX: { uidValidity: '900', uidNext: 42 },
      Bad: { uidValidity: '901', uidNext: 0 },
      Worse: { uidValidity: 901, uidNext: 5 },
      Missing: {},
    });
    const parsed = parseCursor(cursor);
    expect(parsed.size).toBe(1);
    expect(parsed.get('INBOX')).toEqual({ uidValidity: '900', uidNext: 42 });
  });

  it('keeps UIDVALIDITY as a string, so a large value cannot lose precision', () => {
    const large = '4294967295';
    const source = new Map([['INBOX', { uidValidity: large, uidNext: 1 }]]);
    expect(parseCursor(serializeCursor(source)).get('INBOX')?.uidValidity).toBe(large);
  });
});

describe('fetchSince', () => {
  it('reads from `since` when the mailbox has never been synced', async () => {
    const { client, fetchCalls } = makeFakeClient([
      inbox([{ uid: 5, from: 'someone@example.net', messageId: '<a@example.net>' }]),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(fetchCalls[0].query).toEqual({ since: SINCE });
    expect(page.messages).toHaveLength(1);
    expect(page.cursorInvalid).toBe(false);
  });

  it('resumes from the stored UIDNEXT rather than re-reading the window', async () => {
    const { client, fetchCalls } = makeFakeClient([
      inbox(
        [
          { uid: 39, from: 'old@example.net', messageId: '<old@example.net>' },
          { uid: 42, from: 'someone@example.net', messageId: '<b@example.net>' },
        ],
        { uidNext: 43 },
      ),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(
      AUTH,
      cursorOf({ INBOX: { uidValidity: '900', uidNext: 40 } }),
      SINCE,
    );

    expect(fetchCalls[0].query).toEqual({ uid: '40:42' });
    // The already-synced UID 39 is below the cursor and must not come back.
    expect(page.messages.map((m) => m.providerMessageId)).toEqual(['INBOX:42']);
  });

  it('closes the resume range, so an exhausted mailbox stops re-delivering its top message', async () => {
    // An open-ended `41:*` would resolve to `40:41` per RFC 3501 §6.4.8 and hand back UID
    // 40 on every tick forever, re-parsing and re-upserting a message that has not changed.
    const { client, fetchCalls } = makeFakeClient([
      inbox([{ uid: 40, from: 'a@example.net', messageId: '<a@example.net>' }], { uidNext: 41 }),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(
      AUTH,
      cursorOf({ INBOX: { uidValidity: '900', uidNext: 41 } }),
      SINCE,
    );

    expect(page.messages).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
    expect(parseCursor(page.cursor).get('INBOX')?.uidNext).toBe(41);
    expect(page.hasMore).toBe(false);
  });

  it('re-syncing an unchanged mailbox yields nothing the second time', async () => {
    const { client } = makeFakeClient([
      inbox(
        [
          { uid: 5, from: 'a@example.net', messageId: '<a@example.net>' },
          { uid: 6, from: 'b@example.net', messageId: '<b@example.net>' },
        ],
        { uidNext: 7 },
      ),
    ]);
    const provider = providerWith(client);

    const first = await provider.fetchSince(AUTH, null, SINCE);
    const second = await provider.fetchSince(AUTH, first.cursor, SINCE);

    expect(first.messages).toHaveLength(2);
    expect(second.messages).toHaveLength(0);
    expect(second.cursor).toBe(first.cursor);
    expect(first.hasMore).toBe(false);
    expect(second.hasMore).toBe(false);
  });

  it('picks up only what arrived since the last sync', async () => {
    const mailbox = inbox([{ uid: 5, from: 'a@example.net', messageId: '<a@example.net>' }], {
      uidNext: 6,
    });
    const { client } = makeFakeClient([mailbox]);
    const provider = providerWith(client);

    const first = await provider.fetchSince(AUTH, null, SINCE);
    mailbox.messages.push({ uid: 6, from: 'b@example.net', messageId: '<b@example.net>' });
    mailbox.uidNext = 7;
    const second = await provider.fetchSince(AUTH, first.cursor, SINCE);

    expect(second.messages.map((m) => m.providerMessageId)).toEqual(['INBOX:6']);
  });

  it('advances the cursor past the highest UID it saw', async () => {
    const { client } = makeFakeClient([
      inbox(
        [
          { uid: 40, from: 'a@example.net', messageId: '<a@example.net>' },
          { uid: 41, from: 'b@example.net', messageId: '<b@example.net>' },
        ],
        { uidNext: 42 },
      ),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(
      AUTH,
      cursorOf({ INBOX: { uidValidity: '900', uidNext: 40 } }),
      SINCE,
    );

    expect(parseCursor(page.cursor).get('INBOX')).toEqual({ uidValidity: '900', uidNext: 42 });
  });

  it('reports the cursor invalid when UIDVALIDITY changed, and persists nothing', async () => {
    const { client } = makeFakeClient([
      inbox([{ uid: 1, from: 'a@example.net', messageId: '<a@example.net>' }], {
        uidValidity: '999',
      }),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(
      AUTH,
      cursorOf({ INBOX: { uidValidity: '900', uidNext: 40 } }),
      SINCE,
    );

    expect(page.cursorInvalid).toBe(true);
    expect(page.cursor).toBeNull();
    expect(page.messages).toHaveLength(0);
    expect(page.hasMore).toBe(false);
  });

  it('returns an empty page for an empty mailbox without reporting invalidity', async () => {
    const { client } = makeFakeClient([inbox([])]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(0);
    expect(page.cursorInvalid).toBe(false);
    expect(page.hasMore).toBe(false);
    expect(parseCursor(page.cursor).get('INBOX')).toBeDefined();
  });

  it('keeps two mailboxes distinct even when they reuse the same UID', async () => {
    // IMAP numbers UIDs per mailbox, so both folders having a UID 4 is the common case,
    // not an edge one. A bare UID would collide on the account-level unique constraint and
    // one of the two messages would be silently dropped.
    const { client } = makeFakeClient([
      inbox([{ uid: 4, from: 'someone@example.net', messageId: '<in@example.net>' }]),
      {
        path: 'Sent Items',
        uidValidity: '901',
        uidNext: 5,
        specialUse: '\\Sent',
        messages: [{ uid: 4, from: ACCOUNT_ADDRESS, messageId: '<out@example.com>' }],
      },
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(2);
    expect(new Set(page.messages.map((m) => m.providerMessageId)).size).toBe(2);
    const cursor = parseCursor(page.cursor);
    expect(cursor.get('INBOX')).toBeDefined();
    expect(cursor.get('Sent Items')).toBeDefined();
  });

  it('never rewinds the cursor when the server reports a lower uidNext', async () => {
    const { client } = makeFakeClient([inbox([], { uidNext: 300 })]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(
      AUTH,
      cursorOf({ INBOX: { uidValidity: '900', uidNext: 500 } }),
      SINCE,
    );

    expect(parseCursor(page.cursor).get('INBOX')?.uidNext).toBe(500);
  });

  it('reports more history waiting when a mailbox exceeds the per-fetch cap', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      uid: i + 1,
      from: 'someone@example.net',
      messageId: `<m${String(i)}@example.net>`,
    }));
    const { client } = makeFakeClient([inbox(many, { uidNext: 251 })]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.hasMore).toBe(true);
    expect(page.messages).toHaveLength(200);
    // Resumes at the truncation boundary, not past it, so nothing above is skipped.
    expect(parseCursor(page.cursor).get('INBOX')?.uidNext).toBe(201);
  });

  it('loses nothing when the server returns messages highest-UID-first', async () => {
    // RFC 3501 §7.4.2 puts no ordering on untagged FETCH responses, and imapflow yields
    // them as they arrive. Capping an arrival stream at a count and then taking the
    // highest UID seen skips everything the server happened to send after the cap.
    const many = Array.from({ length: 250 }, (_, i) => ({
      uid: i + 1,
      from: 'someone@example.net',
      messageId: `<m${String(i)}@example.net>`,
    }));
    const { client } = makeFakeClient([inbox(many, { uidNext: 251, arrivalOrder: 'descending' })]);
    const provider = providerWith(client);

    const first = await provider.fetchSince(AUTH, null, SINCE);
    const second = await provider.fetchSince(AUTH, first.cursor, SINCE);
    const third = await provider.fetchSince(AUTH, second.cursor, SINCE);

    const delivered = new Set(
      [...first.messages, ...second.messages, ...third.messages].map((m) => m.providerMessageId),
    );
    expect(delivered.size).toBe(250);
  });

  it('caps the delivered result rather than the requested range', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      uid: i + 1,
      from: 'someone@example.net',
      messageId: `<m${String(i)}@example.net>`,
    }));
    const { client, fetchCalls } = makeFakeClient([inbox(many, { uidNext: 251 })]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(
      AUTH,
      cursorOf({ INBOX: { uidValidity: '900', uidNext: 1 } }),
      SINCE,
    );

    // The request spans to the top of the mailbox; the cap is applied to what comes back,
    // so a sparse mailbox is crossed in one round trip rather than one per 200 UIDs.
    expect(fetchCalls[0].query).toEqual({ uid: '1:250' });
    expect(page.messages).toHaveLength(200);
    expect(page.hasMore).toBe(true);
    expect(parseCursor(page.cursor).get('INBOX')?.uidNext).toBe(201);
  });

  it('skips to the top when a window holds no surviving messages', async () => {
    // The window bounds UID width, not message count, so a mailbox whose live mail sits
    // far above the cursor would need one tick per 200 UIDs to crawl the empty ground
    // between. Nothing was found, so there is nothing below the top left to find.
    const { client } = makeFakeClient([inbox([], { uidNext: 500 })]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(
      AUTH,
      cursorOf({ INBOX: { uidValidity: '900', uidNext: 10 } }),
      SINCE,
    );

    expect(page.messages).toHaveLength(0);
    expect(parseCursor(page.cursor).get('INBOX')?.uidNext).toBe(500);
    expect(page.hasMore).toBe(false);
  });

  it('crosses a sparse mailbox in a bounded number of ticks', async () => {
    // 10 live messages at the top of a million-UID range. Advancing 200 UIDs a tick would
    // need 5000 round trips to reach them.
    const live = Array.from({ length: 10 }, (_, i) => ({
      uid: 1_000_000 + i,
      from: 'a@example.net',
      messageId: `<s${String(i)}@example.net>`,
    }));
    const { client } = makeFakeClient([inbox(live, { uidNext: 1_000_010 })]);
    const provider = providerWith(client);

    let cursor: string | null = cursorOf({ INBOX: { uidValidity: '900', uidNext: 1 } });
    let ticks = 0;
    const delivered = new Set<string>();
    while (ticks < 10) {
      ticks += 1;
      const page: Awaited<ReturnType<typeof provider.fetchSince>> = await provider.fetchSince(
        AUTH,
        cursor,
        SINCE,
      );
      page.messages.forEach((m) => delivered.add(m.providerMessageId));
      cursor = page.cursor;
      if (!page.hasMore) break;
    }

    expect(delivered.size).toBe(10);
    expect(ticks).toBeLessThanOrEqual(3);
  });

  it('treats a mailbox missing from the cursor as never synced', async () => {
    const { client, fetchCalls } = makeFakeClient([
      inbox([]),
      {
        path: 'Sent',
        uidValidity: '901',
        uidNext: 5,
        specialUse: '\\Sent',
        messages: [{ uid: 4, from: ACCOUNT_ADDRESS, messageId: '<out@example.com>' }],
      },
    ]);
    const provider = providerWith(client);

    await provider.fetchSince(AUTH, cursorOf({ INBOX: { uidValidity: '900', uidNext: 9 } }), SINCE);

    expect(fetchCalls.find((c) => c.path === 'INBOX')?.query).toEqual({ uid: '9:9' });
    expect(fetchCalls.find((c) => c.path === 'Sent')?.query).toEqual({ since: SINCE });
  });

  it('syncs INBOX alone when the server refuses to list mailboxes', async () => {
    const { client } = makeFakeClient([inbox([])]);
    (client as unknown as { list: () => Promise<never> }).list = async () => {
      throw new Error('LIST refused');
    };
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.cursorInvalid).toBe(false);
    expect(parseCursor(page.cursor).size).toBe(1);
  });

  it('finds Sent by name on a server that reports no special-use flag', async () => {
    // RFC 6154 SPECIAL-USE is optional; without a name fallback these servers sync INBOX
    // alone, and the ticket's "inbound and sent email" quietly becomes inbound only.
    const { client } = makeFakeClient([
      inbox([]),
      {
        path: 'Sent Items',
        uidValidity: '901',
        uidNext: 5,
        messages: [{ uid: 4, from: ACCOUNT_ADDRESS, messageId: '<out@example.com>' }],
      },
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages.map((m) => m.providerMessageId)).toEqual(['Sent Items:4']);
    expect(parseCursor(page.cursor).get('Sent Items')).toBeDefined();
  });

  it('prefers the special-use flag over a folder that merely looks like Sent', async () => {
    const { client } = makeFakeClient([
      inbox([]),
      {
        path: 'Sent',
        uidValidity: '901',
        uidNext: 2,
        messages: [{ uid: 1, from: ACCOUNT_ADDRESS, messageId: '<decoy@example.com>' }],
      },
      {
        path: 'Archive/Outbound',
        uidValidity: '902',
        uidNext: 2,
        specialUse: '\\Sent',
        messages: [{ uid: 1, from: ACCOUNT_ADDRESS, messageId: '<real@example.com>' }],
      },
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages.map((m) => m.providerMessageId)).toEqual(['Archive/Outbound:1']);
  });

  it('does not mistake an archived folder whose leaf name is Sent for the real one', async () => {
    // imapflow reports `name` as the last path segment, so matching on it selects
    // Archive/2019/Sent — a years-old archive — as the account's sent-mail folder.
    const { client } = makeFakeClient([
      inbox([]),
      {
        path: 'Archive/2019/Sent',
        uidValidity: '901',
        uidNext: 2,
        messages: [{ uid: 1, from: ACCOUNT_ADDRESS, messageId: '<old@example.com>' }],
      },
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(0);
    expect(parseCursor(page.cursor).size).toBe(1);
  });

  it('finds Sent under the INBOX namespace, as Courier and Dovecot present it', async () => {
    // `INBOX.Sent` with a `.` delimiter is the most common layout on servers reporting no
    // RFC 6154 special-use. Treating it as nested drops the folder silently.
    const { client } = makeFakeClient([
      inbox([], { path: 'INBOX', delimiter: '.' }),
      {
        path: 'INBOX.Sent',
        delimiter: '.',
        uidValidity: '901',
        uidNext: 2,
        messages: [{ uid: 1, from: ACCOUNT_ADDRESS, messageId: '<out@example.com>' }],
      },
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages.map((m) => m.providerMessageId)).toEqual(['INBOX.Sent:1']);
  });

  it('resolves Sent by whole path when imapflow made no name guess', async () => {
    // Pins the whole-path fallback as the DECIDING branch: with the name guess suppressed
    // there is no specialUse at all, so only that branch can find this folder.
    const { client } = makeFakeClient([
      inbox([]),
      {
        path: 'Sent Mail',
        uidValidity: '901',
        uidNext: 2,
        suppressNameGuess: true,
        messages: [{ uid: 1, from: ACCOUNT_ADDRESS, messageId: '<out@example.com>' }],
      },
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages.map((m) => m.providerMessageId)).toEqual(['Sent Mail:1']);
  });

  it('warns rather than silently syncing INBOX alone when no Sent folder resolves', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const { client } = makeFakeClient([inbox([])]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(parseCursor(page.cursor).size).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('no separate sent-mail folder resolved'),
    );
    warn.mockRestore();
  });

  it('does not sync INBOX twice when the server spells it with different case', async () => {
    // Some servers report the inbox as "Inbox" and hang \Sent off that same mailbox. A
    // case-sensitive comparison reads it as a second, distinct folder and syncs it twice
    // — every message stored under two provider ids, one per spelling.
    const { client } = makeFakeClient([
      {
        path: 'Inbox',
        uidValidity: '900',
        uidNext: 2,
        specialUse: '\\Sent',
        messages: [{ uid: 1, from: 'a@example.net', messageId: '<a@example.net>' }],
      },
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(parseCursor(page.cursor).size).toBe(1);
    expect(page.messages).toHaveLength(1);
  });
});

describe('message normalization', () => {
  it('marks a message the account sent as outbound, wherever it was filed', async () => {
    const { client } = makeFakeClient([
      inbox([
        { uid: 1, from: ACCOUNT_ADDRESS.toUpperCase(), messageId: '<self@example.com>' },
        { uid: 2, from: 'someone@example.net', messageId: '<in@example.net>' },
      ]),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages[0].direction).toBe('outbound');
    expect(page.messages[1].direction).toBe('inbound');
  });

  it('lowercases every address so downstream matching is case-insensitive', async () => {
    const { client } = makeFakeClient([
      inbox([
        {
          uid: 1,
          from: 'Someone@Example.NET',
          to: ['Rep@Example.com'],
          cc: ['Watcher@Example.org'],
          messageId: '<a@example.net>',
        },
      ]),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.fromAddress).toBe('someone@example.net');
    expect(message.toAddresses).toEqual(['rep@example.com']);
    expect(message.ccAddresses).toEqual(['watcher@example.org']);
  });

  it('threads a reply onto its References root', async () => {
    const { client } = makeFakeClient([
      inbox([
        {
          uid: 1,
          from: 'someone@example.net',
          messageId: '<reply@example.net>',
          referencesHeader: 'References: <root@example.net> <mid@example.net>',
        },
      ]),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.threadId).toBe('root@example.net');
  });

  it('threads on References, not on another field in the same header block', async () => {
    // The fetch asks for one field but the server returns a block, and some servers ignore
    // HEADER.FIELDS filtering entirely. Taking the first bracketed token would thread every
    // message from such a server onto its bounce address.
    const { client } = makeFakeClient([
      inbox(
        [
          {
            uid: 1,
            from: 'someone@example.net',
            messageId: '<reply@example.net>',
            referencesHeader:
              'Return-Path: <bounce-12345@mailer.example.net>\r\n' +
              'References: <root@example.net> <mid@example.net>\r\n',
          },
        ],
        { uidNext: 2 },
      ),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.threadId).toBe('root@example.net');
  });

  it('reads a References value folded across continuation lines', async () => {
    // RFC 5322 §2.2.3 folds a long value onto lines beginning with whitespace.
    const { client } = makeFakeClient([
      inbox(
        [
          {
            uid: 1,
            from: 'someone@example.net',
            messageId: '<reply@example.net>',
            referencesHeader: 'References: <root@example.net>\r\n\t<mid@example.net>\r\n',
          },
        ],
        { uidNext: 2 },
      ),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.threadId).toBe('root@example.net');
  });

  it('falls back to Message-ID when the block carries no References field', async () => {
    const { client } = makeFakeClient([
      inbox(
        [
          {
            uid: 1,
            from: 'someone@example.net',
            messageId: '<solo@example.net>',
            referencesHeader: 'Return-Path: <bounce@mailer.example.net>\r\n',
          },
        ],
        { uidNext: 2 },
      ),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.threadId).toBe('solo@example.net');
  });

  it('carries the envelope date through to sentAt', async () => {
    const sent = new Date('2026-07-04T12:30:00Z');
    const { client } = makeFakeClient([
      inbox([{ uid: 1, from: 'a@example.net', messageId: '<a@example.net>', date: sent }], {
        uidNext: 2,
      }),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.sentAt).toEqual(sent);
  });

  it('falls back to the server INTERNALDATE when the envelope has no date', async () => {
    const internal = new Date('2026-07-04T12:30:00Z');
    const { client } = makeFakeClient([
      inbox(
        [{ uid: 1, from: 'a@example.net', messageId: '<a@example.net>', internalDate: internal }],
        {
          uidNext: 2,
        },
      ),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.sentAt).toEqual(internal);
  });

  it('falls back to INTERNALDATE when the envelope date is unparseable', async () => {
    const internal = new Date('2026-07-04T12:30:00Z');
    const { client } = makeFakeClient([
      inbox(
        [
          {
            uid: 1,
            from: 'a@example.net',
            messageId: '<a@example.net>',
            date: new Date('nonsense'),
            internalDate: internal,
          },
        ],
        { uidNext: 2 },
      ),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.sentAt).toEqual(internal);
  });

  it('stores no date rather than an invalid one', async () => {
    // An Invalid Date reaches a timestamptz column as a write failure or a corrupt row,
    // and sent_at is indexed.
    const { client } = makeFakeClient([
      inbox(
        [
          {
            uid: 1,
            from: 'a@example.net',
            messageId: '<a@example.net>',
            date: new Date('nonsense'),
          },
        ],
        { uidNext: 2 },
      ),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.sentAt).toBeNull();
  });

  it('bounds a thread id so it cannot overflow its btree index', async () => {
    // Postgres refuses an index entry over ~2704 bytes with SQLSTATE 54000, which is not
    // a mapped error — it would escape as a 500 and fail the whole page, wedging the
    // account's sync on one broken sender.
    const { client } = makeFakeClient([
      inbox([{ uid: 1, from: 'a@example.net', messageId: `<${'x'.repeat(5000)}@example.net>` }], {
        uidNext: 2,
      }),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.threadId.length).toBeLessThanOrEqual(512);
  });

  it('keeps thread ids distinct when two Message-IDs share a long prefix', async () => {
    // The length bound above passes against a slice, which is what let the same flaw sit
    // undetected on the provider-id path. Two conversations merging into one is milder
    // than a dropped message, but it is the same defect.
    const shared = 'x'.repeat(600);
    const { client } = makeFakeClient([
      inbox(
        [
          { uid: 1, from: 'a@example.net', messageId: `<${shared}a@example.net>` },
          { uid: 2, from: 'b@example.net', messageId: `<${shared}b@example.net>` },
        ],
        { uidNext: 3 },
      ),
    ]);
    const provider = providerWith(client);

    const ids = (await provider.fetchSince(AUTH, null, SINCE)).messages.map(
      (message) => message.threadId,
    );

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(512);
  });

  it('bounds a provider message id, which carries a unique index', async () => {
    const longPath = `Sent ${'A'.repeat(5000)}`;
    const { client } = makeFakeClient([
      inbox([]),
      {
        path: longPath,
        uidValidity: '901',
        uidNext: 2,
        specialUse: '\\Sent',
        messages: [{ uid: 1, from: ACCOUNT_ADDRESS, messageId: '<a@example.net>' }],
      },
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].providerMessageId.length).toBeLessThanOrEqual(512);
  });

  it('keeps ids distinct for two messages in one deeply nested mailbox', async () => {
    const longPath = `Sent ${'A'.repeat(5000)}`;
    const { client } = makeFakeClient([
      inbox([]),
      {
        path: longPath,
        uidValidity: '901',
        uidNext: 3,
        specialUse: '\\Sent',
        messages: [
          { uid: 1, from: ACCOUNT_ADDRESS, messageId: '<a@example.net>' },
          { uid: 2, from: ACCOUNT_ADDRESS, messageId: '<b@example.net>' },
        ],
      },
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);
    const ids = page.messages.map((message) => message.providerMessageId);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('bounds a subject a sender made absurdly long', async () => {
    const { client } = makeFakeClient([
      inbox(
        [
          {
            uid: 1,
            from: 'a@example.net',
            messageId: '<a@example.net>',
            subject: 'x'.repeat(5000),
          },
        ],
        { uidNext: 2 },
      ),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.subject).toHaveLength(998);
  });

  it('gives a message with no threading headers an identity that spans mailboxes', async () => {
    const { client } = makeFakeClient([inbox([{ uid: 7, from: 'someone@example.net' }])]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    // Not qualified by mailbox: the same message filed in both INBOX and Sent must land
    // in one thread.
    expect(message.threadId).toBe('uid-7');
  });

  it('reads has_attachments from the body structure without downloading a part', async () => {
    const { client } = makeFakeClient([
      inbox([
        {
          uid: 1,
          from: 'a@example.net',
          messageId: '<a@example.net>',
          bodyStructure: {
            childNodes: [{ disposition: undefined }, { disposition: 'attachment' }],
          },
        },
        {
          uid: 2,
          from: 'b@example.net',
          messageId: '<b@example.net>',
          bodyStructure: { childNodes: [{ disposition: undefined }] },
        },
      ]),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages[0].hasAttachments).toBe(true);
    expect(page.messages[1].hasAttachments).toBe(false);
  });

  it('finds an attachment nested inside a multipart part', async () => {
    const { client } = makeFakeClient([
      inbox([
        {
          uid: 1,
          from: 'a@example.net',
          messageId: '<a@example.net>',
          bodyStructure: {
            childNodes: [{ childNodes: [{ disposition: 'attachment' }] }],
          },
        },
      ]),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.hasAttachments).toBe(true);
  });

  it('counts a single-part message that is itself an attachment', async () => {
    const { client } = makeFakeClient([
      inbox([
        {
          uid: 1,
          from: 'a@example.net',
          messageId: '<a@example.net>',
          bodyStructure: { disposition: 'attachment' },
        },
      ]),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.hasAttachments).toBe(true);
  });

  it('counts a part named the legacy way, on Content-Type rather than disposition', async () => {
    // `Content-Type: application/pdf; name="invoice.pdf"` predates RFC 2183 disposition
    // parameters and is still how a large share of real attachments are labeled.
    const { client } = makeFakeClient([
      inbox(
        [
          {
            uid: 1,
            from: 'a@example.net',
            messageId: '<a@example.net>',
            bodyStructure: {
              childNodes: [{ disposition: 'inline', parameters: { name: 'invoice.pdf' } }],
            },
          },
        ],
        { uidNext: 2 },
      ),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.hasAttachments).toBe(true);
  });

  it('counts an inline part that carries a filename', async () => {
    const { client } = makeFakeClient([
      inbox(
        [
          {
            uid: 1,
            from: 'a@example.net',
            messageId: '<a@example.net>',
            bodyStructure: {
              childNodes: [
                { disposition: 'inline', dispositionParameters: { filename: 'invoice.pdf' } },
              ],
            },
          },
        ],
        { uidNext: 2 },
      ),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.hasAttachments).toBe(true);
  });

  it('does not count an inline part with no filename, which is body content', async () => {
    const { client } = makeFakeClient([
      inbox(
        [
          {
            uid: 1,
            from: 'a@example.net',
            messageId: '<a@example.net>',
            bodyStructure: { childNodes: [{ disposition: 'inline' }] },
          },
        ],
        { uidNext: 2 },
      ),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.hasAttachments).toBe(false);
  });

  it('matches a disposition the server spelled in a different case', async () => {
    const { client } = makeFakeClient([
      inbox(
        [
          {
            uid: 1,
            from: 'a@example.net',
            messageId: '<a@example.net>',
            bodyStructure: { childNodes: [{ disposition: 'ATTACHMENT' }] },
          },
        ],
        { uidNext: 2 },
      ),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.hasAttachments).toBe(true);
  });

  it('reports no attachments when the server returned no body structure', async () => {
    const { client } = makeFakeClient([
      inbox([{ uid: 1, from: 'a@example.net', messageId: '<a@example.net>' }]),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.hasAttachments).toBe(false);
  });

  it('skips a message with no sender rather than storing an unattributable row', async () => {
    const { client } = makeFakeClient([
      inbox([
        { uid: 1, from: '', messageId: '<nobody@example.net>' },
        { uid: 2, from: 'a@example.net', messageId: '<a@example.net>' },
      ]),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].providerMessageId).toBe('INBOX:2');
  });
});

describe('connection handling', () => {
  it('closes the session even when the mailbox listing throws', async () => {
    const { client, loggedOut } = makeFakeClient([inbox([])]);
    (client as unknown as { list: () => Promise<never> }).list = async () => {
      throw new Error('connection reset');
    };
    (client as unknown as { getMailboxLock: () => Promise<never> }).getMailboxLock = async () => {
      throw new Error('connection reset');
    };
    const provider = providerWith(client);

    await provider.fetchSince(AUTH, null, SINCE);

    expect(loggedOut()).toBe(true);
  });

  it('skips an unreadable mailbox rather than discarding the ones that worked', async () => {
    // A folder renamed or deleted between LIST and SELECT is routine. Letting it throw
    // costs the whole page AND the cursor, so the account makes no forward progress on any
    // tick until the folder comes back.
    const { client } = makeFakeClient([
      inbox([{ uid: 1, from: 'a@example.net', messageId: '<a@example.net>' }], { uidNext: 2 }),
      {
        path: 'Sent',
        uidValidity: '901',
        uidNext: 5,
        specialUse: '\\Sent',
        messages: [],
        failsToOpen: 'NONEXISTENT: mailbox does not exist',
      },
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages.map((m) => m.providerMessageId)).toEqual(['INBOX:1']);
    expect(parseCursor(page.cursor).get('INBOX')?.uidNext).toBe(2);
  });

  it('keeps an unreadable mailbox at its stored position rather than re-backfilling it', async () => {
    const { client } = makeFakeClient([
      inbox([], { uidNext: 2 }),
      {
        path: 'Sent',
        uidValidity: '901',
        uidNext: 9,
        specialUse: '\\Sent',
        messages: [],
        failsToOpen: 'NONEXISTENT: mailbox does not exist',
      },
    ]);
    const provider = providerWith(client);

    const stored = cursorOf({
      INBOX: { uidValidity: '900', uidNext: 2 },
      Sent: { uidValidity: '901', uidNext: 7 },
    });
    const page = await provider.fetchSince(AUTH, stored, SINCE);

    expect(parseCursor(page.cursor).get('Sent')).toEqual({ uidValidity: '901', uidNext: 7 });
  });

  it('does not report more waiting forever for a mailbox that is permanently gone', async () => {
    // hasMore is what the engine paginates on. A folder that will never come back must
    // not keep it true, or the account is paged every tick to deliver nothing.
    const { client } = makeFakeClient([
      inbox([], { uidNext: 2 }),
      {
        path: 'Sent',
        uidValidity: '901',
        uidNext: 2,
        specialUse: '\\Sent',
        messages: [],
        failsToOpen: 'NONEXISTENT: mailbox does not exist',
      },
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.hasMore).toBe(false);
  });

  it('reports rejected credentials distinctly from an unreachable server', async () => {
    const authFailure = Object.assign(new Error('nope'), { authenticationFailed: true });
    const provider = createImapProvider(
      ACCOUNT_ADDRESS,
      async () => {
        throw authFailure;
      },
      async () => undefined,
    );

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_EXPIRED',
    });
  });

  it('reports an unreachable server as a connection failure', async () => {
    const provider = createImapProvider(
      ACCOUNT_ADDRESS,
      async () => {
        throw new Error('ECONNREFUSED');
      },
      async () => undefined,
    );

    await expect(provider.fetchSince(AUTH, null, SINCE)).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
  });

  it('refuses a link-local host before the client factory is consulted', async () => {
    // Runs against the REAL guard — a literal address needs no DNS. 169.254.169.254 is the
    // cloud metadata endpoint, the address this whole check exists for. The factory must
    // never be reached: a mailbox whose host was repointed after its connection test
    // passed would otherwise open a session against the internal network.
    let factoryCalled = false;
    const provider = createImapProvider(ACCOUNT_ADDRESS, async () => {
      factoryCalled = true;
      return makeFakeClient([inbox([])]).client;
    });

    await expect(
      provider.fetchSince({ ...AUTH, host: '169.254.169.254' }, null, SINCE),
    ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
    expect(factoryCalled).toBe(false);
  });

  it('refuses a loopback host, which no real mail server uses', async () => {
    let factoryCalled = false;
    const provider = createImapProvider(ACCOUNT_ADDRESS, async () => {
      factoryCalled = true;
      return makeFakeClient([inbox([])]).client;
    });

    await expect(
      provider.fetchSince({ ...AUTH, host: '127.0.0.1' }, null, SINCE),
    ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
    expect(factoryCalled).toBe(false);
  });

  it('refuses an account whose credentials are not IMAP', async () => {
    const { client } = makeFakeClient([inbox([])]);
    const provider = providerWith(client);

    await expect(
      provider.fetchSince(
        { kind: 'oauth', access_token: 'x', refresh_token: null, expires_at: null },
        null,
        SINCE,
      ),
    ).rejects.toThrow(/not an IMAP account/);
  });
});

describe('the body pass', () => {
  /** A minimal message document, since these tests are about which UIDs get fetched. */
  function sourceOf(text: string): string {
    return ['Content-Type: text/plain; charset=utf-8', '', text, ''].join('\r\n');
  }

  /** The queries of every fetch that asked for message source. */
  function bodyFetches(
    calls: Array<{ query: unknown; options?: unknown; uid?: unknown }>,
  ): Array<{ query: unknown }> {
    const bodyCalls = calls.filter(
      (call) => (call.options as { source?: unknown } | undefined)?.source,
    );
    // Without `uid: true` the server reads the set as sequence numbers and every body
    // lands on the wrong message, which no assertion on the returned bodies would catch.
    for (const call of bodyCalls) {
      expect(call.uid).toMatchObject({ uid: true });
    }
    return bodyCalls;
  }

  it('parses the body of a delivered message onto the normalized message', async () => {
    const { client } = makeFakeClient([
      inbox([
        {
          uid: 5,
          from: 'someone@example.net',
          messageId: '<a@example.net>',
          size: 400,
          source: sourceOf('The body of the message.'),
        },
      ]),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages[0].bodyText?.trim()).toBe('The body of the message.');
    expect(page.messages[0].snippet).toBe('The body of the message.');
  });

  it('asks for the body only of the UIDs the first pass delivered', async () => {
    const { client, fetchCalls } = makeFakeClient([
      inbox(
        [
          { uid: 7, from: 'a@example.net', size: 100, source: sourceOf('seven') },
          { uid: 11, from: 'b@example.net', size: 100, source: sourceOf('eleven') },
        ],
        { uidNext: 12 },
      ),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    // A comma-separated sequence set, not a range: delivered UIDs are not contiguous.
    expect(bodyFetches(fetchCalls)).toHaveLength(1);
    expect(bodyFetches(fetchCalls)[0].query).toEqual({ uid: '7,11' });
    expect(page.messages.map((m) => m.bodyText?.trim())).toEqual(['seven', 'eleven']);
  });

  it('does not request a message whose reported size is over the cap', async () => {
    const { client, fetchCalls } = makeFakeClient([
      inbox([
        { uid: 3, from: 'small@example.net', size: 500, source: sourceOf('kept') },
        {
          uid: 4,
          from: 'huge@example.net',
          subject: 'Large attachment',
          size: 3_000_000,
          source: sourceOf('never asked for'),
        },
      ]),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(bodyFetches(fetchCalls)[0].query).toEqual({ uid: '3' });
    const oversized = page.messages.find((m) => m.fromAddress === 'huge@example.net');
    expect(oversized?.bodyText).toBeNull();
    expect(oversized?.snippet).toBeNull();
    // Its headers still store: an oversized body costs the body, not the message.
    expect(oversized?.subject).toBe('Large attachment');
  });

  it('still fetches a body for a message the server reported no size for', async () => {
    // RFC822.SIZE is not universal. Filtering unsized messages out would silently store
    // no body at all from such a server; the request carries its own byte bound instead.
    const { client, fetchCalls } = makeFakeClient([
      inbox([{ uid: 5, from: 'someone@example.net', source: sourceOf('unsized but read') }]),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(bodyFetches(fetchCalls)[0].query).toEqual({ uid: '5' });
    expect(page.messages[0].bodyText?.trim()).toBe('unsized but read');
  });

  it('stores headers without bodies when the whole body fetch fails', async () => {
    const { client } = makeFakeClient([
      inbox([{ uid: 5, from: 'someone@example.net', size: 100, source: sourceOf('never seen') }]),
    ]);
    // A Proxy rather than a spread: the fake exposes `mailbox` as a getter, and spreading
    // would freeze it at its pre-open value so no mailbox ever opens.
    const failing = new Proxy(client, {
      get(target, prop, receiver) {
        if (prop !== 'fetch') return Reflect.get(target, prop, receiver);
        return (query: unknown, options?: unknown) => {
          if ((options as { source?: unknown } | undefined)?.source) {
            throw new Error('server refused BODY.PEEK[]');
          }
          return (Reflect.get(target, 'fetch', receiver) as (q: unknown, o?: unknown) => unknown)(
            query,
            options,
          );
        };
      },
    });
    const provider = providerWith(failing);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    // The headers the first pass already read must survive a body failure.
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].bodyText).toBeNull();
    expect(page.messages[0].snippet).toBeNull();
  });

  it('strips NUL from a subject, which Postgres would reject outright', async () => {
    // A subject arrives decoded through RFC 2047, which carries NUL straight through.
    // Unstripped it fails the whole INSERT with SQLSTATE 22021 — every message in the
    // page lost and the cursor unadvanced, so the same failure repeats on every tick.
    const nul = String.fromCharCode(0);
    const { client } = makeFakeClient([
      inbox([
        {
          uid: 5,
          from: 'someone@example.net',
          subject: `Quarter${nul}End review`,
          size: 100,
          source: sourceOf('body'),
        },
      ]),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages[0].subject).toBe('QuarterEnd review');
    expect(page.messages[0].subject).not.toContain(nul);
  });

  it('strips NUL from every sender-controlled field, not only the subject', async () => {
    // to_addresses and cc_addresses are text[], and Postgres rejects NUL in an array
    // element with the same unmapped SQLSTATE that would fail the whole page.
    const nul = String.fromCharCode(0);
    const { client } = makeFakeClient([
      inbox([
        {
          uid: 5,
          from: `send${nul}er@example.net`,
          to: [`to${nul}@example.com`],
          cc: [`cc${nul}@example.com`],
          messageId: `<ro${nul}ot@example.net>`,
          size: 100,
          source: sourceOf('body'),
        },
      ]),
    ]);
    const provider = providerWith(client);

    const [message] = (await provider.fetchSince(AUTH, null, SINCE)).messages;

    expect(message.fromAddress).not.toContain(nul);
    expect(message.toAddresses[0]).not.toContain(nul);
    expect(message.ccAddresses[0]).not.toContain(nul);
    expect(message.threadId).not.toContain(nul);
    expect(message.providerMessageId).not.toContain(nul);
  });

  it('cuts an over-long subject without splitting an astral character', () => {
    // Same hazard the body bound already guards: a lone high surrogate reaches the column
    // as a replacement character rather than failing.
    const { client } = makeFakeClient([
      inbox([
        {
          uid: 5,
          from: 'someone@example.net',
          subject: 'z'.repeat(997) + String.fromCodePoint(0x1f600) + 'tail',
          size: 100,
          source: sourceOf('body'),
        },
      ]),
    ]);

    return providerWith(client)
      .fetchSince(AUTH, null, SINCE)
      .then((page) => {
        expect(page.messages[0].subject).toHaveLength(997);
        expect(page.messages[0].subject?.endsWith('z')).toBe(true);
      });
  });

  it('makes no body fetch when the first pass delivered nothing', async () => {
    const { client, fetchCalls } = makeFakeClient([inbox([])]);
    const provider = providerWith(client);

    await provider.fetchSince(AUTH, null, SINCE);

    expect(bodyFetches(fetchCalls)).toHaveLength(0);
  });

  it('stores headers without a body for a message that carries no text', async () => {
    const { client } = makeFakeClient([
      inbox([
        { uid: 5, from: 'good@example.net', size: 100, source: sourceOf('readable') },
        { uid: 6, from: 'bad@example.net', size: 100, source: '\u0000\u00ff not a document' },
      ]),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    expect(page.messages).toHaveLength(2);
    expect(page.messages[0].bodyText?.trim()).toBe('readable');
    expect(page.messages[1].bodyText).toBeNull();
  });

  it('still derives the thread id from the References header block', async () => {
    const { client } = makeFakeClient([
      inbox([
        {
          uid: 5,
          from: 'someone@example.net',
          messageId: '<reply@example.net>',
          referencesHeader: 'References: <root@example.net> <mid@example.net>\r\n',
          size: 100,
          source: sourceOf('body'),
        },
      ]),
    ]);
    const provider = providerWith(client);

    const page = await provider.fetchSince(AUTH, null, SINCE);

    // The body pass must not disturb the header block the first pass read.
    expect(page.messages[0].threadId).toBe('root@example.net');
    expect(page.messages[0].bodyText?.trim()).toBe('body');
  });
});
