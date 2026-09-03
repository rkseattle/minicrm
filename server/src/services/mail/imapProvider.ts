/**
 * IMAP implementation of the mail provider seam.
 *
 * Syncs two mailboxes, INBOX and Sent, because a conversation is only half recorded
 * without the replies the user sent. Sent is located by its `\Sent` special-use flag
 * where the server reports one, and otherwise by name — RFC 6154 SPECIAL-USE is an
 * optional extension, and a server without it would silently sync INBOX alone.
 *
 * The cursor carries one UIDVALIDITY/UIDNEXT pair per mailbox, because IMAP scopes both
 * to a mailbox. A mailbox absent from a stored cursor is treated as never-synced, which
 * is what lets Sent be added to an account already syncing INBOX without a migration.
 *
 * Bodies are read in a second fetch, over the messages the first one delivered. The
 * message cap applies to what the first fetch returns rather than to what it asks for, so
 * asking for bodies there would pull a whole backfill window to keep two hundred
 * messages.
 */

import { createHash } from 'node:crypto';

import {
  type ImapFlow,
  type FetchMessageObject,
  type ListResponse,
  type MessageAddressObject,
  type MessageStructureObject,
} from 'imapflow';

import logger from '../../logger.js';
import { assertHostnameIsSafe, UrlNotSafeError } from '../../utils/urlSafetyUtils.js';
import type { ConnectedAccountAuth, ImapAuthPayload } from '../connectedAccountService.js';
import {
  CONNECTION_FAILED,
  classifyImapError,
  closeImapClient,
  createImapClient,
  type ImapClientTimeouts,
  PROVIDER_AUTH_EXPIRED,
} from '../imapConnectionService.js';
import type { MailProvider, NormalizedMessage, ProviderPage } from './mailProvider.js';
import {
  EMPTY_MESSAGE_BODY,
  parseMessageBody,
  stripNul,
  type ParsedMessageBody,
} from './messageBody.js';
import { extractHeaderField, resolveThreadId } from './threading.js';

/** The mailbox every IMAP server has, under this exact name. */
const INBOX_PATH = 'INBOX';

/** The special-use flag identifying the sent-mail folder, per RFC 6154. */
const SENT_SPECIAL_USE = '\\Sent';

/**
 * `specialUseSource` values that mean the server said so, rather than imapflow guessing
 * from a folder's name. Only these make a `\Sent` flag authoritative.
 */
const SERVER_SUPPLIED_SPECIAL_USE = ['extension', 'user'];

/**
 * Top-level paths a sent-mail folder goes by, for servers reporting no special-use flag.
 *
 * Matched against the whole path rather than the leaf name: `Archive/2019/Sent` has the
 * leaf "Sent" but is a years-old archive, and syncing it instead of the live folder puts
 * the wrong outbound history on the account.
 */
const SENT_FALLBACK_PATHS = ['sent', 'sent items', 'sent mail', 'sent messages'];

/** Shown to the user for any unreachable server, so no banner or stack trace escapes. */
const UNREACHABLE_MESSAGE = 'Could not reach that mail server.';

/**
 * Timeouts for a background sync.
 *
 * Deliberately longer than imapConnectionService's, which are tuned for a user waiting on
 * a form submit. Nobody is waiting here, and a slow mailbox is better synced than failed.
 */
const SYNC_TIMEOUTS: ImapClientTimeouts = {
  connectionTimeout: 30_000,
  greetingTimeout: 20_000,
  socketTimeout: 120_000,
};

/**
 * Longest subject stored.
 *
 * RFC 5322 §2.1.1 caps a header line at 998 octets; anything past that is a sender doing
 * something deliberate, and `subject` is an unindexed `text` column with no bound.
 * Measured in UTF-16 code units, so a CJK or emoji subject keeps more than 998 octets —
 * acceptable here precisely because nothing indexes this column.
 */
const MAX_SUBJECT_LENGTH = 998;

/**
 * Longest value stored in a column that carries a btree index.
 *
 * Postgres refuses an index entry larger than about a third of a page — 2704 bytes on a
 * default build — and `thread_id` and `provider_message_id` are both indexed. A
 * `Message-ID` may legally run to RFC 5322's 998-octet line limit and a hostile one is
 * unbounded, so an unbounded derived id fails the INSERT with SQLSTATE 54000. That is not
 * a mapped error, so it would escape as a 500 and fail the whole page — one broken sender
 * wedging an account's sync indefinitely.
 *
 * The bound is well under the limit because it counts UTF-16 code units, not bytes: a
 * 4-byte character costs two units, so the worst case is twice this in bytes.
 */
const MAX_INDEXED_ID_LENGTH = 512;

/**
 * Brings an identifier under the index bound without letting two distinct values become
 * one. Plain truncation cannot do that: a mailbox path is the PREFIX of a qualified id,
 * so two deep mailboxes sharing their first bytes lose the UID that told them apart, and
 * the ingest's ON CONFLICT then overwrites one message with the other.
 *
 * Overflow is rare, so the readable form is kept whenever it fits and a digest of the
 * whole value is substituted only when it does not.
 */
function boundIndexedId(id: string): string {
  if (id.length <= MAX_INDEXED_ID_LENGTH) return id;
  return `sha256:${createHash('sha256').update(id, 'utf8').digest('hex')}`;
}

/**
 * The id a message is stored under.
 *
 * An IMAP UID is unique only within one mailbox — INBOX and Sent both number from 1 — so
 * the id is qualified by path and then bounded, because it lands under a btree index.
 */
function qualifiedMessageId(mailboxPath: string, uid: number): string {
  return boundIndexedId(`${mailboxPath}:${String(uid)}`);
}

/** Messages read per mailbox per fetch, bounding both memory and time per tick. */
const MAX_MESSAGES_PER_MAILBOX = 200;

/**
 * Largest body read per message, in bytes of raw MIME.
 *
 * Applied twice: a message the server sized above this is never requested, and the
 * request itself carries the same bound for a server that reports no size. A document
 * past this is carrying attachments rather than prose — the largest realistic text and
 * HTML pair is a long quoted reply chain in the low hundreds of kilobytes.
 */
const MAX_MESSAGE_SOURCE_BYTES = 2_097_152;

/** Where one mailbox's sync stopped. */
interface MailboxCursor {
  /** Stringified: UIDVALIDITY is a 32-bit unsigned value that imapflow reports as bigint. */
  uidValidity: string;
  uidNext: number;
}

type CursorByMailbox = Map<string, MailboxCursor>;

/**
 * Parses the stored cursor.
 *
 * JSON rather than a delimited string because a mailbox path may contain any character —
 * `:` is the hierarchy delimiter on several servers, and `|` is legal in a user-created
 * folder name. A delimited encoding splits such a path into the wrong fields, and the
 * mailbox then looks never-synced on every tick and re-delivers its whole history.
 *
 * A cursor that will not parse is discarded rather than thrown on: the cost of forgetting
 * where a mailbox stopped is a bounded re-backfill, where refusing to sync at all is
 * unbounded.
 */
export function parseCursor(cursor: string | null): CursorByMailbox {
  const parsed: CursorByMailbox = new Map();
  if (!cursor) return parsed;

  let decoded: unknown;
  try {
    decoded = JSON.parse(cursor);
  } catch {
    return parsed;
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return parsed;

  // Safe: the guard above rejects anything that is not a non-array object.
  for (const [path, value] of Object.entries(decoded as Record<string, unknown>)) {
    if (!path || typeof value !== 'object' || value === null) continue;
    const { uidValidity, uidNext } = value as { uidValidity?: unknown; uidNext?: unknown };
    if (typeof uidValidity !== 'string' || !uidValidity) continue;
    if (typeof uidNext !== 'number' || !Number.isSafeInteger(uidNext) || uidNext < 1) continue;
    parsed.set(path, { uidValidity, uidNext });
  }
  return parsed;
}

/** Serializes the cursor for storage. */
export function serializeCursor(cursors: CursorByMailbox): string {
  return JSON.stringify(Object.fromEntries(cursors));
}

/** Every address on a header, lowercased so matching is case-insensitive downstream. */
function addressesOf(list: MessageAddressObject[] | undefined): string[] {
  return (list ?? [])
    .map((entry) => entry.address?.trim().toLowerCase())
    .filter((address): address is string => Boolean(address))
    .map(stripNul);
}

/** The subject a `text` column can hold: bounded, and stripped of what Postgres rejects. */
function subjectOf(subject: string | undefined): string | null {
  if (subject === undefined) return null;
  return stripNul(subject.slice(0, MAX_SUBJECT_LENGTH));
}

/**
 * Decides whether the account sent this message.
 *
 * Compares the sender against the mailbox's own address rather than trusting the folder:
 * a copy of a sent message can appear in INBOX (self-addressed mail, some server-side
 * rules), and an inbound message can be filed into Sent by a misconfigured client.
 */
function directionOf(fromAddress: string, accountAddress: string): 'inbound' | 'outbound' {
  return fromAddress === accountAddress.trim().toLowerCase() ? 'outbound' : 'inbound';
}

/**
 * True when the message has a part that is not body text.
 *
 * Read from BODYSTRUCTURE, which the server computes — no part is downloaded. A server
 * that returns no structure yields false rather than an error: the flag is advisory, and
 * refusing to store a message over it would lose the message.
 */
function hasAttachments(message: FetchMessageObject): boolean {
  const structure = message.bodyStructure;
  if (!structure) return false;

  // `inline` with a filename counts: that is how an embedded image or a PDF a client chose
  // to display is dispositioned, and a user who attached it sees an attachment. An inline
  // part with no filename is body content — a quoted signature image, a text alternative.
  const isAttachment = (node: MessageStructureObject): boolean => {
    const disposition = node.disposition?.toLowerCase();
    const hasFilename = Boolean(node.dispositionParameters?.filename ?? node.parameters?.name);
    if (disposition === 'attachment') return true;
    if (disposition === 'inline' && hasFilename) return true;
    return (node.childNodes ?? []).some(isAttachment);
  };

  // The root node is tested too: a forwarded bare PDF is a single part that is itself the
  // attachment, with no children to descend into.
  return isAttachment(structure);
}

/**
 * A date the database will accept, or null.
 *
 * An unparseable value yields an Invalid Date, which reaches a `timestamptz` column as
 * either a write failure or a corrupt row depending on the driver. sent_at is indexed, so
 * neither is survivable — a message with no usable date is better stored without one.
 */
function usableDate(value: Date | string | undefined): Date | null {
  if (value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Turns one fetched message into the engine's shape, or null when it carries no sender.
 *
 * The id is qualified by mailbox because an IMAP UID is unique only within one mailbox:
 * INBOX and Sent both number from 1, so a bare UID would collide on the account-level
 * uniqueness the engine relies on and one of the two messages would be dropped.
 */
function normalize(
  message: FetchMessageObject,
  mailboxPath: string,
  accountAddress: string,
  body: ParsedMessageBody,
): NormalizedMessage | null {
  const envelope = message.envelope;
  const fromAddress = addressesOf(envelope?.from)[0] ?? '';
  if (!fromAddress) return null;

  // The fetch asks for one field but receives a header block, and a server may include
  // more fields than were requested — so the References field is read out by name.
  const headerBlock = message.headers?.toString('utf8') ?? null;
  const referencesHeader = headerBlock ? extractHeaderField(headerBlock, 'references') : null;
  const qualifiedId = stripNul(qualifiedMessageId(mailboxPath, message.uid));
  const rawThreadId =
    resolveThreadId({
      messageId: envelope?.messageId ?? null,
      inReplyTo: envelope?.inReplyTo ?? null,
      references: referencesHeader,
    }) ??
    // A message with no threading headers at all is its own conversation. The id is NOT
    // qualified by mailbox: the same message filed in both INBOX and Sent must land in one
    // thread, and the UID is the only handle it has.
    `uid-${String(message.uid)}`;
  const threadId = stripNul(boundIndexedId(rawThreadId));

  return {
    providerMessageId: qualifiedId,
    threadId,
    direction: directionOf(fromAddress, accountAddress),
    fromAddress,
    toAddresses: addressesOf(envelope?.to),
    ccAddresses: addressesOf(envelope?.cc),
    // Every field below this line comes from a header the sender wrote. NUL is stripped
    // from all of them, not just bodies: Postgres rejects it outright, and one such
    // message would fail the whole page rather than itself.
    subject: subjectOf(envelope?.subject),
    hasAttachments: hasAttachments(message),
    sentAt: usableDate(envelope?.date) ?? usableDate(message.internalDate),
    bodyText: body.bodyText,
    bodyHtml: body.bodyHtml,
    snippet: body.snippet,
  };
}

/** Opens an authenticated session against the account's server. */
async function connect(auth: ImapAuthPayload): Promise<ImapFlow> {
  const client = createImapClient(auth, SYNC_TIMEOUTS);
  await client.connect();
  return client;
}

/**
 * A mailbox's path relative to the top of the account's tree.
 *
 * Courier and Dovecot commonly namespace every folder under the inbox, so the real Sent
 * folder is `INBOX.Sent` with a `.` delimiter. Treating that as nested drops it: it is
 * top-level as far as the user is concerned, and it is the single most common layout on
 * servers that report no RFC 6154 special-use.
 */
function stripInboxNamespace(mailbox: ListResponse): string {
  const prefix = `${INBOX_PATH}${mailbox.delimiter}`;
  return mailbox.path.toLowerCase().startsWith(prefix.toLowerCase())
    ? mailbox.path.slice(prefix.length).trim()
    : mailbox.path.trim();
}

/**
 * Resolves which mailboxes to sync: INBOX always, Sent when one can be identified.
 *
 * A `\Sent` flag is trusted only when the SERVER supplied it. imapflow also sets
 * `specialUse` from its own localized leaf-name guess when the server advertises no
 * RFC 6154 SPECIAL-USE, and when several folders share a leaf name it breaks the tie by
 * `path.localeCompare` — so on such a server `Archive/2019/Sent` wins the flag outright
 * and the live `Sent` never gets one. `specialUseSource` separates the two cases.
 *
 * Failing every route is logged: the ticket asks for sent mail, and silently syncing half
 * a conversation is worse than a diagnosable gap.
 */
async function resolveMailboxPaths(client: ImapFlow): Promise<string[]> {
  const isInbox = (path: string): boolean => path.toLowerCase() === INBOX_PATH.toLowerCase();
  const paths = [INBOX_PATH];

  try {
    const listed = await client.list();

    // The name is case-insensitive per RFC 3501 §5.1, so a server may list it as "Inbox".
    // imapflow uppercases any spelling before SELECT, so this is about the CURSOR and the
    // provider ids, which are keyed on the path string this function returns.
    const inbox = listed.find((mailbox) => isInbox(mailbox.path));
    if (inbox) paths[0] = inbox.path;

    const isSentFlag = (mailbox: ListResponse): boolean =>
      mailbox.specialUse?.toLowerCase() === SENT_SPECIAL_USE.toLowerCase();

    const sent =
      listed.find(
        (mailbox) =>
          isSentFlag(mailbox) &&
          SERVER_SUPPLIED_SPECIAL_USE.includes(mailbox.specialUseSource ?? ''),
      ) ??
      listed.find((mailbox) =>
        SENT_FALLBACK_PATHS.includes(stripInboxNamespace(mailbox).toLowerCase()),
      ) ??
      // A name-derived flag is still better than nothing once the whole-path names are
      // exhausted — but only from a folder sitting at the top of the account's tree, so a
      // dated archive whose leaf happens to read "Sent" cannot claim it.
      listed.find(
        (mailbox) =>
          isSentFlag(mailbox) && !stripInboxNamespace(mailbox).includes(mailbox.delimiter),
      );

    if (sent && !isInbox(sent.path)) {
      paths.push(sent.path);
    } else {
      // A count rather than the paths: this fires on every tick for an account with no
      // resolvable Sent folder, and the folder list is the user's own mail structure.
      logger.warn(
        { mailboxCount: listed.length, resolvedToInbox: sent !== undefined },
        'imapProvider: no separate sent-mail folder resolved — syncing INBOX only',
      );
    }
  } catch (err) {
    // A server that refuses LIST still syncs INBOX; losing Sent costs outbound history,
    // not correctness.
    logger.warn({ err }, 'imapProvider: could not list mailboxes — syncing INBOX only');
  }
  return paths;
}

/**
 * Reads and parses the bodies of the messages this tick will deliver.
 *
 * A second pass, because the message cap is applied to what the first fetch returns
 * rather than to what it asks for — and on a never-synced mailbox the first fetch asks
 * for a whole backfill window. Requesting bodies there would download all of it to keep
 * two hundred messages.
 *
 * Every failure degrades to null bodies rather than propagating. `fetchSince` catches per
 * mailbox and restores its stored cursor, so an escaping body error would discard every
 * header the page had already read and re-read them next tick, repeatedly. Degrading
 * costs one body instead — permanently, since the cursor advances past the message and
 * nothing re-reads it under the same id.
 */
async function fetchBodies(
  client: ImapFlow,
  delivered: readonly FetchMessageObject[],
  mailboxPath: string,
): Promise<Map<number, ParsedMessageBody>> {
  const bodies = new Map<number, ParsedMessageBody>();

  // A message whose reported size is over the cap is not asked for at all. Where the
  // server reports no size — RFC822.SIZE is not universal — it is still asked for, and
  // the byte range on the request below is what bounds it. Filtering those out instead
  // would silently sync no body at all from such a server.
  const wanted = delivered.filter(
    (message) => message.size === undefined || message.size <= MAX_MESSAGE_SOURCE_BYTES,
  );
  if (wanted.length === 0) return bodies;

  try {
    for await (const message of client.fetch(
      { uid: wanted.map((m) => String(m.uid)).join(',') },
      // Bounded on the request, so a message the server never sized cannot arrive
      // unbounded. A truncated document still parses; its body is simply cut short.
      { uid: true, source: { maxLength: MAX_MESSAGE_SOURCE_BYTES } },
      { uid: true },
    )) {
      if (!message.source) continue;
      // The stored id, not just a qualified one: it is bounded the same way, so a long
      // mailbox path logs the digest the row actually carries.
      bodies.set(
        message.uid,
        await parseMessageBody(message.source, qualifiedMessageId(mailboxPath, message.uid)),
      );
    }
  } catch (err) {
    logger.warn(
      { err, mailbox: mailboxPath, messageCount: wanted.length },
      'imapProvider: body fetch failed — storing these headers without bodies, permanently',
    );
  }

  return bodies;
}

/** Reads one mailbox from its stored position, or from `since` when it has none. */
async function fetchMailbox(
  client: ImapFlow,
  path: string,
  stored: MailboxCursor | undefined,
  since: Date,
  accountAddress: string,
): Promise<{
  messages: NormalizedMessage[];
  cursor: MailboxCursor;
  invalid: boolean;
  hasMore: boolean;
}> {
  const lock = await client.getMailboxLock(path);
  try {
    const mailbox = client.mailbox;
    if (typeof mailbox === 'boolean') {
      throw new Error(`imapProvider: mailbox ${path} did not open`);
    }

    const uidValidity = mailbox.uidValidity.toString();
    const uidNext = mailbox.uidNext;

    // UIDVALIDITY changing means the server has renumbered every UID; the stored UIDs now
    // name different messages, so resuming from them would skip and mis-file mail.
    const invalid = stored !== undefined && stored.uidValidity !== uidValidity;
    const resumeFrom = !stored || invalid ? null : stored.uidNext;

    // A resume reads a deterministic UID window rather than "whatever arrives first".
    // RFC 3501 §7.4.2 puts no ordering on untagged FETCH responses and imapflow yields
    // them as they arrive, so truncating an arrival stream at a count and then taking the
    // highest UID seen would skip every message the server happened to send after the cap.
    //
    // The window is also closed at its top rather than open at `*`: §6.4.8 resolves `*` to
    // the mailbox's highest existing UID and makes a range order-independent, so once the
    // cursor passes the top message `501:*` evaluates as `500:501` and re-delivers UID 500
    // on every tick, forever.
    // The window spans from the cursor to the mailbox's top, and the CAP is applied to
    // what comes back. Bounding the request by UID width instead makes a sparse mailbox —
    // ten live messages atop a million-UID range — cost one round trip per 200 empty UIDs.
    const windowStart = resumeFrom;
    const windowEnd = windowStart === null ? null : uidNext - 1;

    const query =
      windowStart === null || windowEnd === null
        ? { since }
        : { uid: `${String(windowStart)}:${String(windowEnd)}` };

    const collected: FetchMessageObject[] = [];
    // Nothing above the cursor means nothing to ask for; an inverted range would be read
    // as its own reverse and re-deliver what the account already has.
    const hasWindow = windowStart === null || (windowEnd !== null && windowEnd >= windowStart);
    if (hasWindow) {
      for await (const message of client.fetch(
        query,
        {
          uid: true,
          envelope: true,
          internalDate: true,
          bodyStructure: true,
          size: true,
          headers: ['references'],
        },
        { uid: true },
      )) {
        collected.push(message);
      }
    }

    // Sorted because the cursor is a high-water mark over UIDs and the server may have
    // sent them in any order — the arrival stream cannot be truncated in place, because
    // which messages are the LOWEST is not known until the last one has arrived.
    collected.sort((a, b) => a.uid - b.uid);

    // Capped at the LOWEST UIDs, not at the first to arrive: taking arrival order would
    // strand everything below the cut, because the cursor advances past them and they are
    // never asked for again.
    const truncated = collected.length > MAX_MESSAGES_PER_MAILBOX;
    const delivered = truncated ? collected.slice(0, MAX_MESSAGES_PER_MAILBOX) : collected;

    const bodies = await fetchBodies(client, delivered, path);

    const messages = delivered
      .map((message) =>
        normalize(message, path, accountAddress, bodies.get(message.uid) ?? EMPTY_MESSAGE_BODY),
      )
      .filter((message): message is NormalizedMessage => message !== null);

    // The cursor only ever moves forward. A server can report a uidNext below where this
    // account already reached — an empty fetch, or a server that recounts — and taking it
    // verbatim would rewind the mailbox and redeliver everything above it.
    const highestDelivered = delivered.reduce((highest, m) => Math.max(highest, m.uid), 0);
    const resumedFrom = invalid ? 0 : (stored?.uidNext ?? 0);

    // A truncated read resumes just above what it delivered; a complete one resumes at the
    // top of the range it asked for, so mail deleted at the end is not re-requested.
    const reached = truncated
      ? highestDelivered + 1
      : windowEnd !== null
        ? windowEnd + 1
        : highestDelivered > 0
          ? highestDelivered + 1
          : uidNext;

    const nextCursor: MailboxCursor = {
      uidValidity,
      uidNext: Math.max(resumedFrom, reached),
    };

    // More is waiting only when the cap cut the result short — the request itself always
    // spans to the top of the mailbox.
    const hasMore = truncated;

    return {
      messages,
      cursor: nextCursor,
      invalid,
      hasMore,
    };
  } finally {
    lock.release();
  }
}

/**
 * Builds an IMAP provider for one account.
 *
 * @param accountAddress - The mailbox's own address, used to decide message direction.
 * @param clientFactory - Injected so tests can drive a fake; there is no in-repo
 *   precedent for mocking imapflow, and the real client needs a live server.
 * @param assertHostSafe - The SSRF guard, separated from `clientFactory` so that swapping
 *   the client cannot silently swap the guard out with it. A test that wants to reach the
 *   fake must stub this deliberately, which is visible in the test; overriding it is the
 *   only way past the check.
 */
export function createImapProvider(
  accountAddress: string,
  clientFactory: (auth: ImapAuthPayload) => Promise<ImapFlow> = connect,
  assertHostSafe: (hostname: string) => Promise<void> = assertHostnameIsSafe,
): MailProvider {
  return {
    async fetchSince(
      auth: ConnectedAccountAuth,
      cursor: string | null,
      since: Date,
    ): Promise<ProviderPage> {
      if (auth.kind !== 'imap') {
        throw new Error('imapProvider: account is not an IMAP account');
      }

      // Checked before the client is built, and on its own seam: the host is stored, so it
      // is re-resolved on every sync and a mailbox cannot be repointed at the internal
      // network after its connection test passed.
      try {
        await assertHostSafe(auth.host);
      } catch (err) {
        if (err instanceof UrlNotSafeError) {
          logger.warn(
            { host: auth.host, reason: err.reason },
            'imapProvider: refused an unsafe mail server address',
          );
          throw Object.assign(new Error(UNREACHABLE_MESSAGE), { code: CONNECTION_FAILED });
        }
        throw err;
      }

      let client: ImapFlow;
      try {
        client = await clientFactory(auth);
      } catch (err) {
        const code = classifyImapError(err);
        throw Object.assign(
          new Error(
            code === PROVIDER_AUTH_EXPIRED
              ? 'The mail server rejected the stored credentials.'
              : UNREACHABLE_MESSAGE,
          ),
          { code },
        );
      }

      try {
        const stored = parseCursor(cursor);
        const paths = await resolveMailboxPaths(client);

        const messages: NormalizedMessage[] = [];
        const nextCursor: CursorByMailbox = new Map();
        let anyInvalid = false;
        let anyMore = false;

        for (const path of paths) {
          const storedForPath = stored.get(path);
          try {
            const result = await fetchMailbox(client, path, storedForPath, since, accountAddress);
            messages.push(...result.messages);
            nextCursor.set(path, result.cursor);
            anyInvalid ||= result.invalid;
            anyMore ||= result.hasMore;
          } catch (err) {
            // One mailbox failing must not discard the mailboxes that succeeded: a folder
            // renamed or deleted between LIST and SELECT is routine, and letting it throw
            // costs the whole page plus the cursor, so the account makes no forward
            // progress on any tick until the folder returns. Its stored position is kept
            // so the mailbox resumes where it stopped rather than re-backfilling.
            logger.warn({ err, mailbox: path }, 'imapProvider: skipping unreadable mailbox');
            // The stored position is kept so the mailbox resumes rather than re-backfills
            // if it returns. `hasMore` is deliberately NOT set: a folder that is gone for
            // good would otherwise keep the engine paging an account forever to deliver
            // nothing, and the next tick retries this mailbox regardless.
            if (storedForPath) nextCursor.set(path, storedForPath);
          }
        }

        // One invalidated mailbox invalidates the account: the engine's recovery is a
        // bounded re-backfill, and running it per-mailbox would double the states to test
        // for a saving no acceptance criterion asks for.
        return {
          messages: anyInvalid ? [] : messages,
          cursor: anyInvalid ? null : serializeCursor(nextCursor),
          cursorInvalid: anyInvalid,
          hasMore: anyInvalid ? false : anyMore,
        };
      } finally {
        await closeImapClient(client);
      }
    },
  };
}
