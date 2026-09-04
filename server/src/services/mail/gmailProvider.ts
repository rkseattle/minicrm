/**
 * The Gmail implementation of the provider seam.
 *
 * Google publishes no sandbox — every call reaches a real mailbox — so this driver is
 * written against the Discovery Document rather than against observed behavior, and its
 * tests validate every fake response against that same schema.
 *
 * No SDK. `googleapis` would pull a large transitive tree to wrap four REST endpoints,
 * and its main draw is an auth layer the connected-account service already owns. The
 * precedent for reaching Google directly is `revokeProviderTokens`: raw fetch, a hardcoded
 * URL, and an AbortController for the timeout.
 */

import logger from '../../logger.js';
import type { ConnectedAccountAuth } from '../connectedAccountService.js';
import { CONNECTION_FAILED, PROVIDER_AUTH_EXPIRED } from '../imapConnectionService.js';
import { GMAIL_READ_SCOPE } from '../oauthProviderService.js';

import type { MailProvider, NormalizedMessage, ProviderPage } from './mailProvider.js';
import { boundIndexedId, directionOf, parseMessage } from './messageBody.js';
import { resolveThreadId } from './threading.js';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Reported when a mailbox's granted scopes cannot read mail. */
export const INSUFFICIENT_SCOPE = 'INSUFFICIENT_SCOPE';

/**
 * History records requested per incremental page.
 *
 * Sent as `maxResults`, which is the only bound that can be enforced without losing mail:
 * the API pages by record, so a client-side cap on the messages inside those records could
 * only discard the overflow — there is no cursor position that resumes inside a page.
 * A single record set may therefore exceed this in messages, which is logged and read in
 * full rather than trimmed.
 */
const MAX_MESSAGES_PER_PAGE = 200;

/**
 * Messages read per backfill page.
 *
 * Lower than the incremental cap because the engine runs up to MAX_BACKFILL_PAGES_PER_TICK
 * of these back to back with no pacing. A `messages.get` costs 20 quota units against a
 * 6,000-per-user-per-minute budget, so 5 pages x 50 messages x 20 is 5,000 — under budget
 * with room for the list and profile calls beside it. At 200 it would be 20,000.
 */
const MAX_BACKFILL_MESSAGES_PER_PAGE = 50;

/**
 * Stands in for a history position a backfill could not read.
 *
 * The cursor's historyId is required, but a mailbox whose profile answered without one
 * still has a window to page through. The placeholder keeps that progress while marking
 * the anchor as still owed, so the phase cannot flip to a position nothing can resume
 * from. It is not a value Gmail can return: history ids are decimal.
 */
export const UNANCHORED = 'unanchored';

/** Bound on each Gmail request, so a hung endpoint cannot stall the whole tick. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * What Gmail is asked to exclude.
 *
 * IMAP syncs exactly INBOX and Sent, so a driver that ingested drafts and chats would
 * make a mailbox read differently depending on which one synced it — a half-written draft
 * stored as real correspondence. `includeSpamTrash` defaults to false and is left alone.
 */
const EXCLUDED_LABELS = '-in:drafts -in:chats';

/**
 * Labels the incremental path drops.
 *
 * Wider than the backfill query's `-in:drafts -in:chats` because the two endpoints differ:
 * `messages.list` leaves spam and trash out by default, while a history record reports a
 * message added straight to either.
 */
const EXCLUDED_LABEL_IDS = ['DRAFT', 'CHAT', 'SPAM', 'TRASH'];

/**
 * Where a Gmail sync stopped.
 *
 * `phase` decides which endpoint runs, never the presence of a field. A bare historyId
 * cannot do that job: the engine feeds each backfill page's cursor straight back in, so
 * page two would arrive holding a historyId and switch to the incremental endpoint,
 * abandoning the rest of the window permanently.
 */
interface GmailCursor {
  phase: 'backfill' | 'incremental';
  /**
   * The mailbox's history position. Captured once from users.getProfile before the first
   * backfill page and carried unchanged through every page of it, because a value read
   * after the listing misses anything that arrived while the listing ran.
   */
  historyId: string;
  /**
   * Where the current listing resumes, on either phase.
   *
   * The incremental path needs it as much as the backfill does: history longer than one
   * page would otherwise re-read page one every tick and never reach page two, because
   * the engine calls fetchSince once per tick and the position cannot advance until the
   * whole page set is read.
   */
  pageToken: string | null;
}

/**
 * Parses the stored cursor.
 *
 * A cursor that will not parse is treated as absent rather than thrown on: forgetting
 * where a mailbox stopped costs a bounded re-backfill, where refusing to sync at all is
 * unbounded. Each field is validated independently for the same reason.
 */
export function parseCursor(cursor: string | null): GmailCursor | null {
  if (!cursor) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(cursor);
  } catch {
    return null;
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null;

  const { phase, historyId, pageToken } = decoded as {
    phase?: unknown;
    historyId?: unknown;
    pageToken?: unknown;
  };
  if (phase !== 'backfill' && phase !== 'incremental') return null;
  if (typeof historyId !== 'string' || historyId === '') return null;
  if (pageToken !== null && typeof pageToken !== 'string') return null;

  return { phase, historyId, pageToken: pageToken ?? null };
}

/** Serializes the cursor for storage. */
export function serializeCursor(cursor: GmailCursor): string {
  return JSON.stringify(cursor);
}

/**
 * What this driver reads off a response.
 *
 * Narrower than the global `Response` on purpose: it states the contract a fake has to
 * meet, and it keeps the module off a global whose availability the lint config still
 * guards by Node version.
 */
export interface GmailResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

/** The fetch seam, injected so tests drive the driver without reaching Google. */
export type FetchLike = (url: string, init: RequestInit) => Promise<GmailResponse>;

/** A Gmail request that failed in a way the engine should record. */
function providerError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Reasons Google returns on a 403 that mean quota, not a bad credential. */
const RATE_LIMIT_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'];

/** True when a 403 body blames quota rather than the credential. */
function isRateLimited(body: unknown): boolean {
  const errors = (body as { error?: { errors?: unknown } } | null)?.error?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((entry) => {
    const reason = (entry as { reason?: unknown } | null)?.reason;
    return typeof reason === 'string' && RATE_LIMIT_REASONS.includes(reason);
  });
}

/**
 * Turns a non-OK response into one of the engine's domain codes.
 *
 * Never leaks the provider's own body: it is a remote server's prose, and `status_detail`
 * is rendered to a user.
 *
 * A 403 means either "this token may not do that" or "you have asked too often", and
 * Google distinguishes them only in the body. Reading it matters because the two produce
 * opposite advice: reconnecting a mailbox does nothing for a quota that resets in a
 * minute, and the engine's backoff already handles the waiting.
 */
function errorForStatus(status: number, body: unknown): Error {
  if (status === 429 || (status === 403 && isRateLimited(body))) {
    return providerError('Gmail is rate limiting this mailbox.', CONNECTION_FAILED);
  }
  if (status === 401 || status === 403) {
    return providerError('Google rejected the stored credentials.', PROVIDER_AUTH_EXPIRED);
  }
  return providerError('Could not reach Gmail.', CONNECTION_FAILED);
}

interface GmailRequestResult {
  status: number;
  body: unknown;
}

/** Issues one bounded Gmail request. Transport failures become CONNECTION_FAILED. */
async function gmailRequest(
  fetchImpl: FetchLike,
  accessToken: string,
  path: string,
  params: Record<string, string>,
): Promise<GmailRequestResult> {
  const query = new URLSearchParams(params).toString();
  const url = `${GMAIL_API_BASE}${path}${query ? `?${query}` : ''}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: controller.signal,
      // A redirect would carry the bearer token to wherever it points.
      redirect: 'manual',
    });

    // A 404 is a routine answer on both paths — an expired startHistoryId, a message
    // deleted between listing and fetching — so the caller decides, not this helper.
    if (response.status === 404) return { status: 404, body: null };

    // Read before branching: a 403's body is the only thing separating a spent quota from
    // a refused credential, and the two need opposite handling.
    const body: unknown = await response.json();
    if (!response.ok) throw errorForStatus(response.status, body);

    return { status: response.status, body };
  } catch (err) {
    if (err instanceof Error && 'code' in err) throw err;
    // undici reports every transport failure as the same TypeError, so the cause matters
    // more than the name; either way the mailbox is unreachable rather than unauthorized.
    throw providerError('Could not reach Gmail.', CONNECTION_FAILED);
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the mailbox's current history position, which anchors a backfill. */
async function fetchProfileHistoryId(
  fetchImpl: FetchLike,
  accessToken: string,
): Promise<string | null> {
  const { body } = await gmailRequest(fetchImpl, accessToken, '/profile', {});
  const historyId = (body as { historyId?: unknown } | null)?.historyId;
  return typeof historyId === 'string' && historyId !== '' ? historyId : null;
}

/** One message id and the thread Gmail places it in. */
export interface GmailMessageRef {
  id: string;
  threadId: string | null;
}

/** Pulls `{id, threadId}` pairs out of a list response, skipping malformed entries. */
function messageRefsOf(body: unknown): GmailMessageRef[] {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw)) return [];

  const refs: GmailMessageRef[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, threadId } = entry as { id?: unknown; threadId?: unknown };
    if (typeof id !== 'string' || id === '') continue;
    refs.push({ id, threadId: typeof threadId === 'string' && threadId ? threadId : null });
  }
  return refs;
}

/**
 * Collects the message ids a history page reports as added.
 *
 * `historyTypes=messageAdded` narrows this server-side, but the label filter still runs
 * here: a message added straight to SPAM is a messageAdded record like any other, and the
 * backfill query excludes the same labels.
 */
function addedRefsOf(body: unknown): GmailMessageRef[] {
  const history = (body as { history?: unknown } | null)?.history;
  if (!Array.isArray(history)) return [];

  const refs: GmailMessageRef[] = [];
  for (const record of history) {
    const added = (record as { messagesAdded?: unknown } | null)?.messagesAdded;
    if (!Array.isArray(added)) continue;

    for (const entry of added) {
      const message = (entry as { message?: unknown } | null)?.message;
      if (typeof message !== 'object' || message === null) continue;
      const { id, threadId, labelIds } = message as {
        id?: unknown;
        threadId?: unknown;
        labelIds?: unknown;
      };
      if (typeof id !== 'string' || id === '') continue;
      const labels = Array.isArray(labelIds) ? labelIds : [];
      if (labels.some((label) => typeof label === 'string' && EXCLUDED_LABEL_IDS.includes(label)))
        continue;
      refs.push({ id, threadId: typeof threadId === 'string' && threadId ? threadId : null });
    }
  }
  return refs;
}

/**
 * The largest raw document whose body is stored, in bytes.
 *
 * Bounds what reaches the body COLUMNS, not what is downloaded or parsed: with RAW the
 * whole document has already crossed the wire by the time its size is known, and the
 * headers still have to be parsed out of it. A document past this is carrying attachments
 * rather than prose, so it is stored as headers with no body.
 *
 * Applied to the decoded buffer rather than to the response's `sizeEstimate`, because
 * Google documents RAW as "the full email message data" without stating which metadata
 * survives the projection, and a cap that stops applying when a field is absent is worse
 * than one that always applies.
 */
const MAX_MESSAGE_SOURCE_BYTES = 2_097_152;

/**
 * Turns one Gmail message resource into the row the engine stores.
 *
 * The body comes from the same parser IMAP uses, over the same kind of document, so a
 * message reads identically whichever driver synced it.
 *
 * @returns null when the document carries no usable sender — the one field with no
 *   sensible default, and the same rule the IMAP driver applies.
 */
async function normalizeMessage(
  body: unknown,
  ref: GmailMessageRef,
  accountAddress: string,
): Promise<NormalizedMessage | null> {
  const raw = (body as { raw?: unknown } | null)?.raw;
  if (typeof raw !== 'string' || raw === '') return null;

  // Named for what Gmail sends. Node's 'base64' happens to accept this alphabet too, so
  // the label documents the encoding rather than guarding against a decode failure.
  const source = Buffer.from(raw, 'base64url');

  // Oversized documents keep their headers and store no body, which is what IMAP does
  // with a message it declined to fetch. Dropping the message instead would lose it for
  // good: the cursor advances past it in the same transaction that stores the page.
  // Unlike IMAP this cannot avoid the download — RAW carries the whole document, and its
  // size is only known once it has arrived.
  const oversized = source.byteLength > MAX_MESSAGE_SOURCE_BYTES;
  if (oversized) {
    logger.warn(
      { messageId: ref.id, bytes: source.byteLength },
      'gmailProvider: storing headers only for an oversized message',
    );
  }

  const parsed = await parseMessage(source, { headersOnly: oversized });
  if (!parsed.fromAddress) return null;

  // Reported per message so a silent body loss stays observable, as the IMAP driver does.
  if (parsed.lostText && !oversized) {
    logger.warn({ messageId: ref.id }, 'gmailProvider: stored a message with no body text');
  }

  return {
    providerMessageId: boundIndexedId(ref.id),
    // Gmail's own thread id where it has one — the Discovery Document puts threadId on
    // every Message. The RFC 5322 fallback covers a response that somehow lacks it, and
    // the id itself covers a message that carries neither.
    threadId: boundIndexedId(
      ref.threadId ?? resolveThreadId(parsed.threading) ?? `gmail-${ref.id}`,
    ),
    direction: directionOf(parsed.fromAddress, accountAddress),
    fromAddress: parsed.fromAddress,
    toAddresses: parsed.toAddresses,
    ccAddresses: parsed.ccAddresses,
    subject: parsed.subject,
    hasAttachments: parsed.hasAttachments,
    sentAt: parsed.sentAt,
    bodyText: parsed.bodyText,
    bodyHtml: parsed.bodyHtml,
    snippet: parsed.snippet,
  };
}

/**
 * Reads each selected message and turns it into a stored row.
 *
 * `format=RAW` returns the whole RFC 2822 document, which `parseMessageBody` already
 * parses correctly. Walking Gmail's own `payload.parts[]` instead would mean a second
 * rule for part selection, HTML-only conversion, and attachment disposition, kept in
 * agreement with IMAP's forever — the duplication that makes a mailbox read differently
 * depending on which driver synced it.
 *
 * Sequential rather than concurrent: a page of these already costs 20 quota units each
 * against a per-minute budget, and the engine runs several pages back to back.
 */
async function readMessages(
  fetchImpl: FetchLike,
  accessToken: string,
  refs: readonly GmailMessageRef[],
  accountAddress: string,
): Promise<NormalizedMessage[]> {
  const messages: NormalizedMessage[] = [];

  for (const ref of refs) {
    const { status, body } = await gmailRequest(fetchImpl, accessToken, `/messages/${ref.id}`, {
      format: 'RAW',
    });

    // A message listed a moment ago can be gone by the time it is fetched. Skipping it
    // costs one message; failing the page would discard every message beside it and
    // re-read them all next tick.
    if (status === 404) {
      logger.warn({ messageId: ref.id }, 'gmailProvider: message vanished between list and fetch');
      continue;
    }

    const normalized = await normalizeMessage(body, ref, accountAddress);
    if (normalized !== null) messages.push(normalized);
  }

  return messages;
}

/**
 * Builds a Gmail provider for one account.
 *
 * @param accountAddress - The mailbox's own address, used to decide message direction.
 * @param grantedScopes - What the provider actually granted, which may be fewer than were
 *   requested.
 * @throws with code INSUFFICIENT_SCOPE when those scopes cannot read mail.
 * @param fetchImpl - Injected so tests drive the driver without reaching Google, which
 *   publishes no sandbox to reach.
 */
export function createGmailProvider(
  accountAddress: string,
  grantedScopes: readonly string[],
  fetchImpl: FetchLike = fetch,
): MailProvider {
  // Checked at construction, not at fetch: the engine builds the provider before it
  // decrypts and refreshes credentials, so refusing here is what keeps an under-scoped
  // mailbox from spending a locked token refresh every tick.
  if (!grantedScopes.includes(GMAIL_READ_SCOPE)) {
    logger.warn(
      { accountAddress, grantedScopes },
      'gmailProvider: mailbox lacks the scope needed to read mail',
    );
    throw providerError(
      'This mailbox did not grant permission to read mail. Reconnect it to continue syncing.',
      INSUFFICIENT_SCOPE,
    );
  }

  return {
    async fetchSince(
      auth: ConnectedAccountAuth,
      cursor: string | null,
      since: Date,
    ): Promise<ProviderPage> {
      if (auth.kind !== 'oauth') {
        throw providerError('Gmail requires an OAuth account.', PROVIDER_AUTH_EXPIRED);
      }

      const stored = parseCursor(cursor);
      return stored?.phase === 'incremental'
        ? readIncremental(fetchImpl, auth.access_token, stored, accountAddress)
        : readBackfill(fetchImpl, auth.access_token, stored, since, accountAddress);
    },
  };
}

/**
 * Reads a window of history for a mailbox with no usable position.
 *
 * The anchoring historyId comes from users.getProfile before the first page, not from the
 * listing: a value read afterwards misses every message that arrived while the listing
 * ran, and those would never be seen again.
 */
async function readBackfill(
  fetchImpl: FetchLike,
  accessToken: string,
  stored: GmailCursor | null,
  since: Date,
  accountAddress: string,
): Promise<ProviderPage> {
  // A stored anchor is kept; the placeholder means an earlier page could not read one, so
  // this page tries again rather than carrying a value no incremental sync can use.
  const anchored = stored?.historyId !== undefined && stored.historyId !== UNANCHORED;
  const historyId = anchored
    ? stored.historyId
    : ((await fetchProfileHistoryId(fetchImpl, accessToken)) ?? null);

  // `q` rides every page, not just the first: a page token positions within a result set
  // the other parameters define, so dropping the filter would let page two enumerate the
  // whole mailbox — drafts, chats, and everything outside the window.
  const afterSeconds = Math.floor(since.getTime() / 1000);
  const params: Record<string, string> = {
    q: `after:${String(afterSeconds)} ${EXCLUDED_LABELS}`,
    maxResults: String(MAX_BACKFILL_MESSAGES_PER_PAGE),
  };
  if (stored?.pageToken) params.pageToken = stored.pageToken;

  const { body } = await gmailRequest(fetchImpl, accessToken, '/messages', params);
  const refs = messageRefsOf(body);
  const nextPageToken = (body as { nextPageToken?: unknown } | null)?.nextPageToken;
  const pageToken = typeof nextPageToken === 'string' && nextPageToken ? nextPageToken : null;

  // The phase flips only when the listing is exhausted; until then every page carries the
  // same historyId, so the incremental sync that follows resumes from before the backfill
  // began rather than from wherever it happened to stop.
  //
  // A mailbox still owed an anchor keeps a backfill cursor only while the listing has
  // pages left. Once it is exhausted the cursor goes null, which is what routes the next
  // tick back through backfillAccount — the engine reads a non-null cursor with no open
  // job as "incremental", and that path has no page budget and opens no job.
  const next: GmailCursor | null =
    historyId === null
      ? pageToken === null
        ? null
        : { phase: 'backfill', historyId: UNANCHORED, pageToken }
      : pageToken
        ? { phase: 'backfill', historyId, pageToken }
        : { phase: 'incremental', historyId, pageToken: null };

  return {
    messages: await readMessages(fetchImpl, accessToken, refs, accountAddress),
    cursor: next === null ? null : serializeCursor(next),
    cursorInvalid: false,
    hasMore: pageToken !== null,
  };
}

/**
 * Reads what changed since the stored history position.
 *
 * The cursor is not advanced past a page this call could not deliver: the engine stores
 * messages and cursor in one transaction, so a position moved past unread records would
 * skip that mail permanently.
 */
async function readIncremental(
  fetchImpl: FetchLike,
  accessToken: string,
  stored: GmailCursor,
  accountAddress: string,
): Promise<ProviderPage> {
  const params: Record<string, string> = {
    startHistoryId: stored.historyId,
    historyTypes: 'messageAdded',
    maxResults: String(MAX_MESSAGES_PER_PAGE),
  };
  if (stored.pageToken) params.pageToken = stored.pageToken;

  const { status, body } = await gmailRequest(fetchImpl, accessToken, '/history', params);

  // Google documents a 404 here as the signal that the stored position has aged out of
  // the history window. The engine answers with a bounded re-backfill, not a full resync.
  if (status === 404) {
    return { messages: [], cursor: null, cursorInvalid: true, hasMore: false };
  }

  const refs = addedRefsOf(body);
  const nextPageToken = (body as { nextPageToken?: unknown } | null)?.nextPageToken;
  const pageToken =
    typeof nextPageToken === 'string' && nextPageToken !== '' ? nextPageToken : null;

  // Every ref this page reported is delivered, however many that is. Gmail's history API
  // offers no way to resume inside a page — `pageToken` moves whole pages — so a cap here
  // could only discard the remainder, and the cursor would then advance past mail that was
  // never stored. `maxResults` is the bound that works, and it bounds history RECORDS
  // rather than the messages inside them, so a burst can exceed it; the cost of that is a
  // larger page, which is recoverable, where dropping refs is not.
  const latest = (body as { historyId?: unknown } | null)?.historyId;
  const advanced =
    pageToken === null && typeof latest === 'string' && latest !== '' ? latest : stored.historyId;

  if (refs.length > MAX_MESSAGES_PER_PAGE) {
    logger.warn(
      { count: refs.length, cap: MAX_MESSAGES_PER_PAGE },
      'gmailProvider: history page carried more messages than one page expects',
    );
  }

  return {
    messages: await readMessages(fetchImpl, accessToken, refs, accountAddress),
    cursor: serializeCursor({ phase: 'incremental', historyId: advanced, pageToken }),
    cursorInvalid: false,
    hasMore: pageToken !== null,
  };
}
