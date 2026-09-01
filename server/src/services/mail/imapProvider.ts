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
 * No message body is fetched. Turning a raw MIME document into text needs a parser this
 * service does not carry, so only headers and metadata are read — which also keeps the
 * fetch small enough that a mailbox syncs in a few round trips.
 */

import {
  type ImapFlow,
  type FetchMessageObject,
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
import { extractHeaderField, resolveThreadId } from './threading.js';

/** The mailbox every IMAP server has, under this exact name. */
const INBOX_PATH = 'INBOX';

/** The special-use flag identifying the sent-mail folder, per RFC 6154. */
const SENT_SPECIAL_USE = '\\Sent';

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
 * something deliberate, and `subject` is a `text` column with no bound of its own.
 */
const MAX_SUBJECT_LENGTH = 998;

/** Messages read per mailbox per fetch, bounding both memory and time per tick. */
const MAX_MESSAGES_PER_MAILBOX = 200;

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
    .filter((address): address is string => Boolean(address));
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
): NormalizedMessage | null {
  const envelope = message.envelope;
  const fromAddress = addressesOf(envelope?.from)[0] ?? '';
  if (!fromAddress) return null;

  // The fetch asks for one field but receives a header block, and a server may include
  // more fields than were requested — so the References field is read out by name.
  const headerBlock = message.headers?.toString('utf8') ?? null;
  const referencesHeader = headerBlock ? extractHeaderField(headerBlock, 'references') : null;
  const qualifiedId = `${mailboxPath}:${String(message.uid)}`;
  const threadId =
    resolveThreadId({
      messageId: envelope?.messageId ?? null,
      inReplyTo: envelope?.inReplyTo ?? null,
      references: referencesHeader,
    }) ??
    // A message with no threading headers at all is its own conversation. The id is NOT
    // qualified by mailbox: the same message filed in both INBOX and Sent must land in one
    // thread, and the UID is the only handle it has.
    `uid-${String(message.uid)}`;

  return {
    providerMessageId: qualifiedId,
    threadId,
    direction: directionOf(fromAddress, accountAddress),
    fromAddress,
    toAddresses: addressesOf(envelope?.to),
    ccAddresses: addressesOf(envelope?.cc),
    subject: envelope?.subject?.slice(0, MAX_SUBJECT_LENGTH) ?? null,
    hasAttachments: hasAttachments(message),
    sentAt: usableDate(envelope?.date) ?? usableDate(message.internalDate),
  };
}

/** Opens an authenticated session against the account's server. */
async function connect(auth: ImapAuthPayload): Promise<ImapFlow> {
  const client = createImapClient(auth, SYNC_TIMEOUTS);
  await client.connect();
  return client;
}

/**
 * Resolves which mailboxes to sync: INBOX always, Sent when one can be identified.
 *
 * The special-use flag is preferred because it is unambiguous, but RFC 6154 is an optional
 * extension — Courier, Dovecot without the plugin, and many shared hosts report none — so
 * a name match is tried second. Failing both is logged: the ticket asks for sent mail, and
 * silently syncing half a conversation is worse than a diagnosable gap.
 */
async function resolveMailboxPaths(client: ImapFlow): Promise<string[]> {
  const isInbox = (path: string): boolean => path.toLowerCase() === INBOX_PATH.toLowerCase();
  const paths = [INBOX_PATH];

  try {
    const listed = await client.list();

    // The name is case-insensitive per RFC 3501 §5.1, so a server may list it as "Inbox".
    // Taking the server's own spelling keeps it one mailbox: two spellings would open two,
    // and every message would be stored twice under two provider ids.
    const inbox = listed.find((mailbox) => isInbox(mailbox.path));
    if (inbox) paths[0] = inbox.path;

    const sent =
      listed.find(
        (mailbox) => mailbox.specialUse?.toLowerCase() === SENT_SPECIAL_USE.toLowerCase(),
      ) ??
      listed.find((mailbox) => SENT_FALLBACK_PATHS.includes(mailbox.path.trim().toLowerCase()));

    if (sent && !isInbox(sent.path)) {
      paths.push(sent.path);
    } else {
      logger.warn(
        { mailboxes: listed.map((mailbox) => mailbox.path) },
        'imapProvider: no sent-mail folder found by flag or name — syncing INBOX only',
      );
    }
  } catch (err) {
    // A server that refuses LIST still syncs INBOX; losing Sent costs outbound history,
    // not correctness.
    logger.warn({ err }, 'imapProvider: could not list mailboxes — syncing INBOX only');
  }
  return paths;
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
    const windowStart = resumeFrom;
    const windowEnd =
      windowStart === null ? null : Math.min(windowStart + MAX_MESSAGES_PER_MAILBOX - 1, uidNext - 1);

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
    collected.sort((a, b) => (a.uid ?? 0) - (b.uid ?? 0));

    // The `since` path has no UID window bounding the request, so it is capped here, at
    // the lowest UIDs. Taking the first to arrive instead would strand everything below
    // the cut: the cursor advances past them and they are never asked for again.
    const truncatedSince = windowStart === null && collected.length > MAX_MESSAGES_PER_MAILBOX;
    const delivered = truncatedSince ? collected.slice(0, MAX_MESSAGES_PER_MAILBOX) : collected;

    const messages = delivered
      .map((message) => normalize(message, path, accountAddress))
      .filter((message): message is NormalizedMessage => message !== null);

    // The cursor only ever moves forward. A server can report a uidNext below where this
    // account already reached — an empty fetch, or a server that recounts — and taking it
    // verbatim would rewind the mailbox and redeliver everything above it.
    const highestDelivered = delivered.reduce((highest, m) => Math.max(highest, m.uid ?? 0), 0);
    const resumedFrom = invalid ? 0 : (stored?.uidNext ?? 0);

    // A resumed window advances past the window itself even when it came back empty:
    // the messages in it were deleted, and asking for them again every tick never ends.
    const reached =
      windowEnd !== null ? windowEnd + 1 : highestDelivered > 0 ? highestDelivered + 1 : uidNext;


    const nextCursor: MailboxCursor = {
      uidValidity,
      uidNext: Math.max(resumedFrom, reached),
    };

    // More is waiting when this window stopped short of the mailbox's top, or when the
    // unbounded `since` read hit its memory guard.
    const hasMore = windowEnd !== null ? windowEnd < uidNext - 1 : truncatedSince;

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
            if (storedForPath) nextCursor.set(path, storedForPath);
            anyMore = true;
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
