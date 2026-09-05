/**
 * The Microsoft Graph implementation of the provider seam.
 *
 * No SDK. `@microsoft/microsoft-graph-client` wraps the four REST calls this driver
 * makes, and its main draw is an auth layer connectedAccountService already owns. The
 * precedent for reaching a provider directly is `revokeProviderTokens`: raw fetch, a
 * hardcoded URL, an AbortController for the timeout.
 *
 * Graph's delta function is per-folder — there is no mailbox-wide `/me/messages/delta` —
 * so the cursor carries one link per folder and both are read in one call, which is the
 * IMAP driver's shape rather than Gmail's. Microsoft publishes no sandbox, so the tests
 * validate every fake response against a vendored schema.
 */

import {
  CONNECTION_FAILED,
  INSUFFICIENT_SCOPE,
  PROVIDER_AUTH_EXPIRED,
} from '@minicrm/shared/schemas/connectedAccountSchema.js';

import logger from '../../logger.js';
import type { ConnectedAccountAuth } from '../connectedAccountService.js';
import { GRAPH_MAIL_READ_SCOPE } from '../oauthProviderService.js';

import type {
  MailProvider,
  MailboxTestResult,
  NormalizedMessage,
  ProviderPage,
} from './mailProvider.js';
import { normalizeFromSource } from './messageBody.js';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0/me';

// Re-exported from the shared list rather than restated: this value reaches status_detail,
// which the client renders by translating, so a copy that drifts degrades the mailbox to
// the generic reason instead of failing loudly.
export { INSUFFICIENT_SCOPE };

/** Message for a grant that cannot read mail. The user sees the locale string keyed by
 * INSUFFICIENT_SCOPE; this reaches logs and any caller that reports a raw provider error. */
const INSUFFICIENT_SCOPE_MESSAGE =
  'This mailbox did not grant permission to read mail. Reconnect it to continue syncing.';

/** Message for a credential the provider refused. Logged, not rendered — the panel
 * translates PROVIDER_AUTH_EXPIRED instead. */
export const REJECTED_CREDENTIAL_MESSAGE = 'Microsoft rejected the stored credentials.';

/** Message for a mailbox that could not be reached at all. */
export const UNREACHABLE_MESSAGE = 'Could not reach Outlook.';

/**
 * The folders this driver syncs, by Microsoft's locale-independent well-known names.
 *
 * The same scope the IMAP driver takes — a conversation is only half recorded without the
 * replies the user sent. Unlike IMAP this needs no discovery heuristic: Microsoft
 * documents these names as substitutes for a folder id whatever the mailbox's language.
 */
const SYNCED_FOLDERS = ['inbox', 'sentitems'] as const;

type SyncedFolder = (typeof SYNCED_FOLDERS)[number];

/**
 * Messages requested per delta page, sent as `Prefer: odata.maxpagesize`.
 *
 * Graph chooses the page size otherwise and documents it as varying, and this driver
 * issues one `$value` GET per delivered message — so an unbounded page is an unbounded
 * tick.
 *
 * Per FOLDER, and both are read in one call, so the bound that matters is twice this.
 * Halved against Gmail's own 50 so a Graph page costs the same 50 body fetches: at 50 each
 * the worst case is 100 sequential requests against a REQUEST_TIMEOUT_MS budget, which can
 * outlast SYNC_CLAIM_LEASE_MS and let a second instance claim the mailbox mid-page.
 */
const MAX_MESSAGES_PER_PAGE = 25;

/** Bound on each Graph request, so a hung endpoint cannot stall the whole tick. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Where one folder's sync stopped.
 *
 * `link` is Graph's own `@odata.nextLink` or `@odata.deltaLink`, stored whole: those URLs
 * already encode the folder id and every query parameter of the request that issued them,
 * so re-deriving either would create a second source of truth.
 *
 * `opening` is recorded rather than read back out of the link. It decides whether the
 * backfill window still applies, and a wrong answer ingests the mailbox's entire history —
 * too much to rest on Microsoft continuing to spell a query parameter `$skiptoken`. Gmail's
 * cursor carries an explicit `phase` for the same reason.
 */
interface FolderPosition {
  link: string;
  /** True while the round that started this folder is still paging. */
  opening: boolean;
}

type CursorByFolder = Map<SyncedFolder, FolderPosition>;

function isSyncedFolder(value: string): value is SyncedFolder {
  return (SYNCED_FOLDERS as readonly string[]).includes(value);
}

/**
 * Graph's own host, the only one a stored link may point at.
 *
 * A cursor is data read back from a column, and the driver replays it with a bearer token
 * attached. Pinning the host is what stops a tampered row from directing that token
 * somewhere else.
 */
function isGraphUrl(value: string): boolean {
  try {
    return new URL(value).origin === 'https://graph.microsoft.com';
  } catch {
    return false;
  }
}

/**
 * Parses the stored cursor.
 *
 * A cursor that will not parse is treated as absent rather than thrown on: forgetting
 * where a mailbox stopped costs a bounded re-backfill, where refusing to sync at all is
 * unbounded. Each folder is validated independently for the same reason.
 */
export function parseCursor(cursor: string | null): CursorByFolder {
  const parsed: CursorByFolder = new Map();
  if (!cursor) return parsed;

  let decoded: unknown;
  try {
    decoded = JSON.parse(cursor);
  } catch {
    return parsed;
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return parsed;

  // Safe: the guard above rejects anything that is not a non-array object.
  for (const [folder, value] of Object.entries(decoded as Record<string, unknown>)) {
    if (!isSyncedFolder(folder)) continue;
    if (typeof value !== 'object' || value === null) continue;

    const { link, opening } = value as { link?: unknown; opening?: unknown };
    if (typeof link !== 'string' || !isGraphUrl(link)) continue;

    // An absent flag reads as an unfinished round, which is the safe direction: the worst
    // it costs is one window filter applied to an incremental page, where the opposite
    // mistake ingests everything the mailbox has ever held.
    parsed.set(folder, { link, opening: opening !== false });
  }
  return parsed;
}

export function serializeCursor(cursors: CursorByFolder): string {
  return JSON.stringify(Object.fromEntries(cursors));
}

/**
 * What this driver reads off a response.
 *
 * Narrower than the global `Response` on purpose: it states the contract a fake has to
 * meet, and it keeps the module off a global whose availability the lint config still
 * guards by Node version. `arrayBuffer` rather than `text` is load-bearing — a MIME
 * document carries per-part charsets, so decoding it as UTF-8 would replace every
 * non-UTF-8 byte before the parser saw it.
 *
 * Exactly one body reader is called per response, as a real `Response` requires — the
 * `$value` path reads `json()` only on a failure, whose body it has not otherwise touched.
 */
export interface GraphResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  headers: { get: (name: string) => string | null };
}

/** The fetch seam, injected so tests drive the driver without reaching Microsoft. */
export type FetchLike = (url: string, init: RequestInit) => Promise<GraphResponse>;

/** A Graph request that failed in a way the engine should record. */
function providerError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Error codes Graph returns when a stored delta link no longer means anything. */
const RESYNC_CODES = ['syncstatenotfound', 'resyncrequired'];

/** Error codes Graph returns for throttling, which is not a credential problem. */
const THROTTLE_CODES = ['toomanyrequests', 'applicationthrottled'];

/** The `error.code` a Graph error body carries, lowercased. */
function errorCodeOf(body: unknown): string {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code.toLowerCase() : '';
}

/** Error codes that mean the credential, not the cursor, whatever status carries them. */
const AUTH_CODES = [
  'invalidauthenticationtoken',
  'accessdenied',
  'erroraccessdenied',
  'unauthenticated',
];

/** True when a response says the stored delta link has aged out. */
function isResyncRequired(status: number, body: unknown): boolean {
  // Microsoft documents 410 for a sync reset, and separately "a 40X-series error with
  // error codes such as syncStateNotFound" for an expired token — so the status alone
  // cannot decide it, and neither can the body. An auth code wins over either: re-reading
  // a mailbox whose token was refused would loop rather than ask the user to reconnect.
  const code = errorCodeOf(body);
  if (AUTH_CODES.includes(code)) return false;
  return status === 410 || (status >= 400 && status < 500 && RESYNC_CODES.includes(code));
}

interface GraphRequestResult {
  status: number;
  body: unknown;
}

/**
 * Turns a non-OK response into one of the engine's domain codes.
 *
 * Never leaks the provider's own body: it is a remote server's prose, and `status_detail`
 * is rendered to a user.
 *
 * Throttling and a refused credential both arrive as a 4xx, and the two produce opposite
 * advice — reconnecting a mailbox does nothing for a limit that resets in a minute, and
 * the engine's backoff already handles the waiting. `Retry-After` is logged rather than
 * honored for that reason: the engine owns when the next attempt happens.
 */
function errorForStatus(status: number, body: unknown, retryAfter: string | null): Error {
  if (status === 429 || THROTTLE_CODES.includes(errorCodeOf(body))) {
    logger.warn({ status, retryAfter }, 'graphProvider: throttled by Microsoft');
    return providerError('Outlook is rate limiting this mailbox.', CONNECTION_FAILED);
  }
  if (status === 401 || status === 403) {
    return providerError(REJECTED_CREDENTIAL_MESSAGE, PROVIDER_AUTH_EXPIRED);
  }
  return providerError(UNREACHABLE_MESSAGE, CONNECTION_FAILED);
}

/**
 * Without this the id changes when a message moves between folders, which would
 * re-deliver moved mail under a new provider_message_id as a duplicate row.
 */
const IMMUTABLE_ID_PREFERENCE = 'IdType="ImmutableId"';

/**
 * The headers every Graph request carries.
 *
 * A caller's preference is comma-joined onto the immutable-id one rather than replacing
 * it: RFC 7240 allows several on one header, and every stored id depends on that one
 * surviving.
 */
function graphHeaders(
  accessToken: string,
  extra: Record<string, string>,
  preference?: string,
): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    Prefer: preference ? `${IMMUTABLE_ID_PREFERENCE}, ${preference}` : IMMUTABLE_ID_PREFERENCE,
    ...extra,
  };
}

/**
 * Issues one bounded Graph request against an absolute URL.
 *
 * Absolute rather than a path fragment because a delta link is returned whole and replayed
 * whole; callers building a fresh URL join it to GRAPH_API_BASE themselves.
 */
async function graphSend(
  fetchImpl: FetchLike,
  accessToken: string,
  url: string,
  accept: string,
  preference?: string,
): Promise<GraphResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: graphHeaders(accessToken, { Accept: accept }, preference),
      signal: controller.signal,
      // A redirect would carry the bearer token to wherever it points.
      redirect: 'manual',
    });
  } catch {
    // Only the fetch itself is inside this try — every classified failure is raised by a
    // caller, after it has read the response. undici reports every transport failure as
    // the same TypeError, so there is nothing here to tell apart: the mailbox is
    // unreachable rather than unauthorized.
    throw providerError(UNREACHABLE_MESSAGE, CONNECTION_FAILED);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Issues one bounded Graph request expecting JSON, against an absolute URL.
 *
 * Absolute rather than a path fragment because a delta link is returned whole and replayed
 * whole; callers building a fresh URL join it to GRAPH_API_BASE themselves.
 */
async function graphRequest(
  fetchImpl: FetchLike,
  accessToken: string,
  url: string,
  preference?: string,
): Promise<GraphRequestResult> {
  const response = await graphSend(fetchImpl, accessToken, url, 'application/json', preference);

  // A 404 is a routine answer on several paths — a folder the mailbox does not have, a
  // message deleted between listing and fetching — so the caller decides, not this helper.
  if (response.status === 404) return { status: 404, body: null };

  // Read before branching: the body is the only thing separating a spent quota and an
  // expired delta link from a refused credential, and the three need different handling.
  // A body that will not decode is a truncated or non-JSON response, which means the
  // mailbox is unreachable rather than unauthorized. Only a genuine decode failure is
  // rewritten that way: anything else thrown here is a fault in the caller's stack, and
  // burying it as CONNECTION_FAILED would hide the defect behind a retry.
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    if (err instanceof SyntaxError) throw providerError(UNREACHABLE_MESSAGE, CONNECTION_FAILED);
    throw err;
  }

  if (!response.ok) {
    if (isResyncRequired(response.status, body)) return { status: response.status, body };
    throw errorForStatus(response.status, body, response.headers.get('retry-after'));
  }
  return { status: response.status, body };
}

/**
 * Reads one message's MIME document as bytes.
 *
 * @returns null when the message is gone — listed a moment ago, deleted since.
 */
async function graphFetchSource(
  fetchImpl: FetchLike,
  accessToken: string,
  url: string,
): Promise<Buffer | null> {
  const response = await graphSend(fetchImpl, accessToken, url, 'text/plain');
  if (response.status === 404) return null;
  if (!response.ok) {
    // The error body decides a throttled 403 from a refused credential, exactly as on the
    // JSON path — this response is MIME on success, but a failure still carries Graph's
    // JSON error envelope, and reading it is what keeps a rate limit from telling the rep
    // to reconnect.
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A failure whose body will not decode leaves the status to classify it.
    }
    throw errorForStatus(response.status, body, response.headers.get('retry-after'));
  }
  // Bytes, never text: the document's parts carry their own charsets, and decoding the
  // whole thing as UTF-8 would corrupt every one that is not.
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The permissions that authorize reading a message body, bare of their resource prefix.
 *
 * `Mail.ReadBasic` is deliberately absent: it excludes bodies and attachments, so a mailbox
 * holding only it would sync headers and store nothing readable.
 */
const MAIL_READ_SCOPES = [
  GRAPH_MAIL_READ_SCOPE.slice(GRAPH_MAIL_READ_SCOPE.lastIndexOf('/') + 1).toLowerCase(),
  'mail.readwrite',
];

/**
 * True when a granted scope authorizes reading a message body.
 *
 * Looser than Gmail's exact match, because Microsoft's is a looser contract: the token
 * response may carry the bare `Mail.Read` rather than the full resource URI that was
 * requested, and `Mail.ReadWrite` supersedes it. An equality check would refuse a
 * correctly-granted mailbox and park it with a badge reconnecting cannot clear.
 *
 */
function grantsMailRead(grantedScopes: readonly string[]): boolean {
  return grantedScopes.some((scope) => {
    const withoutHost = scope.replace(/^https:\/\/graph\.microsoft\.com\//i, '');
    return MAIL_READ_SCOPES.includes(withoutHost.toLowerCase());
  });
}

/**
 * Confirms a token and grant can still read this mailbox, for the connection test.
 *
 * Lives here rather than in connectedAccountService because it needs this module's
 * request path, its scope rule, and its error mapping — and that service deliberately
 * keeps oauthProviderService type-only so openid-client does not load for every consumer
 * of it.
 *
 * The caller supplies the access token: refreshing it needs a row lock this module has no
 * business taking.
 */
export async function testGraphAccess(
  accessToken: string,
  grantedScopes: readonly string[],
  fetchImpl: FetchLike = fetch,
): Promise<MailboxTestResult> {
  if (!grantsMailRead(grantedScopes)) {
    return { ok: false, code: INSUFFICIENT_SCOPE, message: INSUFFICIENT_SCOPE_MESSAGE };
  }

  try {
    const { status, body } = await graphRequest(
      fetchImpl,
      accessToken,
      `${GRAPH_API_BASE}/mailFolders/inbox`,
    );

    // graphRequest hands a 404 back rather than throwing, because on the sync paths it
    // means a missing folder or a deleted message. On the inbox it means the mailbox
    // itself is gone, and reporting that as healthy would clear the failure count and put
    // a dead mailbox back on the schedule.
    if (status === 404 || typeof (body as { id?: unknown } | null)?.id !== 'string') {
      return { ok: false, code: PROVIDER_AUTH_EXPIRED, message: REJECTED_CREDENTIAL_MESSAGE };
    }
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return code === PROVIDER_AUTH_EXPIRED
      ? { ok: false, code: PROVIDER_AUTH_EXPIRED, message: REJECTED_CREDENTIAL_MESSAGE }
      : { ok: false, code: CONNECTION_FAILED, message: UNREACHABLE_MESSAGE };
  }
}

async function resolveFolderId(
  fetchImpl: FetchLike,
  accessToken: string,
  folder: SyncedFolder,
): Promise<string | null> {
  const { status, body } = await graphRequest(
    fetchImpl,
    accessToken,
    `${GRAPH_API_BASE}/mailFolders/${folder}`,
  );

  // A folder the mailbox does not have. Only this answer is an absent folder.
  if (status === 404) return null;

  // A 200 carrying no id is malformed, and must not read as "no folder": that would report
  // the tick a success, so commitPage would clear the failure count on every run and a
  // mailbox syncing nothing would never be retired nor surface to the user.
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || id === '') {
    throw providerError(UNREACHABLE_MESSAGE, CONNECTION_FAILED);
  }
  return id;
}

/** Only what routing needs: the body arrives separately, from `$value`. */
const DELTA_SELECT = 'id,conversationId,isDraft,receivedDateTime';

/** One message the delta page reported as present. */
interface GraphMessageRef {
  id: string;
  conversationId: string | null;
}

/**
 * Pulls the messages worth fetching out of a delta page.
 *
 * Three kinds are dropped here rather than after their body is downloaded, because each
 * costs a request that cannot be taken back:
 *
 * - `@removed`, which Graph uses for a message deleted OR moved out of the folder. The
 *   engine has no delete path and a stored row is the record of a conversation that did
 *   happen, so a removal is not acted on.
 * - drafts, which are not correspondence — a half-written draft stored as a real message
 *   is wrong however it arrived, the rule both other drivers apply.
 * - anything older than the backfill window, which the opening round returns in full
 *   because `$filter` cannot be used here. Only the opening round: the seam makes the
 *   cursor authoritative once one exists, and a resumed round reports a message the user
 *   just filed into the folder, whose own date may be years old.
 */
function messageRefsOf(body: unknown, since: Date | null): GraphMessageRef[] {
  const value = (body as { value?: unknown } | null)?.value;
  if (!Array.isArray(value)) return [];

  const refs: GraphMessageRef[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const message = entry as {
      id?: unknown;
      conversationId?: unknown;
      isDraft?: unknown;
      receivedDateTime?: unknown;
      '@removed'?: unknown;
    };
    if (message['@removed'] !== undefined) continue;
    if (typeof message.id !== 'string' || message.id === '') continue;
    if (message.isDraft === true) continue;

    // A message with no readable date is kept: the window is an optimization, and dropping
    // a message over a missing field would lose it for good once the cursor advanced.
    if (since !== null && typeof message.receivedDateTime === 'string') {
      const received = new Date(message.receivedDateTime);
      if (!Number.isNaN(received.getTime()) && received < since) continue;
    }

    refs.push({
      id: message.id,
      conversationId:
        typeof message.conversationId === 'string' && message.conversationId
          ? message.conversationId
          : null,
    });
  }
  return refs;
}

/**
 * Reads each selected message's MIME document and turns it into a stored row.
 *
 * `$value` returns the whole RFC 2822 document, which `parseMessage` already handles.
 * Walking Graph's own `body` property instead would mean a second rule for part
 * selection, HTML-only conversion, and attachment disposition, kept in agreement with the
 * other two drivers forever — the duplication that makes a mailbox read differently
 * depending on which driver synced it.
 *
 * Sequential rather than concurrent: Graph throttles per mailbox, and the engine runs
 * several pages back to back.
 */
async function readMessages(
  fetchImpl: FetchLike,
  accessToken: string,
  refs: readonly GraphMessageRef[],
  accountAddress: string,
): Promise<NormalizedMessage[]> {
  const messages: NormalizedMessage[] = [];

  for (const ref of refs) {
    const source = await graphFetchSource(
      fetchImpl,
      accessToken,
      `${GRAPH_API_BASE}/messages/${encodeURIComponent(ref.id)}/$value`,
    );

    // A message listed a moment ago can be gone by the time it is fetched. Skipping it
    // costs one message; failing the page would discard every message beside it and
    // re-read them all next tick.
    if (source === null) {
      logger.warn({ messageId: ref.id }, 'graphProvider: message vanished between list and fetch');
      continue;
    }

    const normalized = await normalizeFromSource(source, {
      // Not folder-qualified, unlike IMAP's: a UID means nothing outside its mailbox, but
      // a Graph id is unique across the whole mailbox, so qualifying it would store a
      // message moved between folders twice.
      providerMessageId: ref.id,
      nativeThreadId: ref.conversationId,
      fallbackThreadId: `graph-${ref.id}`,
      accountAddress,
      driver: 'graphProvider',
    });
    if (normalized !== null) messages.push(normalized);
  }

  return messages;
}

/**
 * What one folder's delta page reported, before any body is fetched.
 *
 * Metadata and bodies are two passes because an invalidation in EITHER folder discards the
 * whole account's page: the seam requires a null cursor beside `cursorInvalid`. Fetching
 * bodies as each folder is read would pay a `$value` request per message for a page the
 * sibling folder is about to throw away.
 */
interface FolderPage {
  refs: GraphMessageRef[];
  /** Where the next fetch resumes, or null when the folder is absent. */
  position: FolderPosition | null;
  invalid: boolean;
  hasMore: boolean;
  /** False when the folder does not exist, as distinct from failing to be read. */
  present: boolean;
}

/**
 * Reads one folder's next delta page.
 *
 * A round opened with no stored link returns the folder's current contents and pages via
 * `@odata.nextLink` until it hands back an `@odata.deltaLink`; the next round resumes from
 * that link. One endpoint carries both phases, so there is no phase field to keep in
 * agreement with the link beside it.
 *
 * Returns what to fetch, not what was fetched — see FolderPage.
 */
async function readFolder(
  fetchImpl: FetchLike,
  accessToken: string,
  folder: SyncedFolder,
  stored: FolderPosition | undefined,
  since: Date,
): Promise<FolderPage> {
  // The window bounds the whole opening round, not just its first page: a stored position
  // inside that round is still opening, so treating it as incremental would let page two
  // ingest the mailbox's entire history.
  const opening = stored === undefined || stored.opening;
  let url: string;
  if (stored === undefined) {
    const folderId = await resolveFolderId(fetchImpl, accessToken, folder);
    if (folderId === null) {
      return { refs: [], position: null, invalid: false, hasMore: false, present: false };
    }
    url =
      `${GRAPH_API_BASE}/mailFolders/${encodeURIComponent(folderId)}/messages/delta` +
      `?$select=${DELTA_SELECT}`;
  } else {
    url = stored.link;
  }

  const { status, body } = await graphRequest(
    fetchImpl,
    accessToken,
    url,
    `odata.maxpagesize=${String(MAX_MESSAGES_PER_PAGE)}`,
  );

  // The stored link has aged out of Graph's token cache. The engine answers with a
  // bounded re-backfill, not a full resync.
  if (isResyncRequired(status, body)) {
    return { refs: [], position: null, invalid: true, hasMore: false, present: true };
  }

  // A folder that answers 404 on a link it issued has been deleted under us. Treating it
  // as invalid rather than empty is what re-reads it from scratch once it returns.
  if (status === 404) {
    return { refs: [], position: null, invalid: true, hasMore: false, present: true };
  }

  const page = body as { '@odata.nextLink'?: unknown; '@odata.deltaLink'?: unknown } | null;
  const nextLink = page?.['@odata.nextLink'];
  const deltaLink = page?.['@odata.deltaLink'];
  const resume = typeof nextLink === 'string' ? nextLink : deltaLink;

  // Graph documents a page as carrying exactly one of the two, so a page with neither is
  // a malformed response rather than a stale cursor. Raised as a folder failure so the
  // failure ceiling can retire the mailbox: treating it as an invalidation would re-read
  // from null on every tick while commitPage cleared the failure count, forever.
  if (typeof resume !== 'string' || !isGraphUrl(resume)) {
    throw providerError(
      'graphProvider: delta page carried no usable continuation link',
      CONNECTION_FAILED,
    );
  }

  // The round is still opening while Graph hands back a nextLink; a deltaLink ends it.
  const stillOpening = typeof nextLink === 'string';

  return {
    // The window bounds an opening round only. Once the round has closed the cursor is
    // authoritative, per the seam — a message filed into the folder today is new to this
    // mailbox however old the message itself is.
    refs: messageRefsOf(body, opening ? since : null),
    position: { link: resume, opening: opening && stillOpening },
    invalid: false,
    hasMore: stillOpening,
    present: true,
  };
}

/**
 * Builds a Graph provider for one account.
 *
 * @param accountAddress - The mailbox's own address, used to decide message direction.
 * @param grantedScopes - What the provider actually granted, which may be fewer than were
 *   requested.
 * @throws with code INSUFFICIENT_SCOPE when those scopes cannot read mail.
 * @param fetchImpl - Injected so tests drive the driver without reaching Microsoft, which
 *   publishes no sandbox to reach.
 */
export function createGraphProvider(
  accountAddress: string,
  grantedScopes: readonly string[],
  fetchImpl: FetchLike = fetch,
): MailProvider {
  // Checked at construction, not at fetch: the engine builds the provider before it
  // decrypts and refreshes credentials, so refusing here is what keeps an under-scoped
  // mailbox from spending a locked token refresh every tick.
  if (!grantsMailRead(grantedScopes)) {
    logger.warn(
      { accountAddress, grantedScopes },
      'graphProvider: mailbox lacks the scope needed to read mail',
    );
    throw providerError(INSUFFICIENT_SCOPE_MESSAGE, INSUFFICIENT_SCOPE);
  }

  return {
    async fetchSince(
      auth: ConnectedAccountAuth,
      cursor: string | null,
      since: Date,
    ): Promise<ProviderPage> {
      if (auth.kind !== 'oauth') {
        throw providerError('Outlook requires an OAuth account.', PROVIDER_AUTH_EXPIRED);
      }

      const stored = parseCursor(cursor);
      const pending: GraphMessageRef[][] = [];
      const nextCursor: CursorByFolder = new Map();
      let readableFolders = 0;
      let anyInvalid = false;
      let anyMore = false;

      // Every folder is read in one call, as the IMAP driver does. Reading one per call
      // would halve the effective sync rate: the engine calls fetchSince once per tick on
      // the incremental path, so the unread folder would wait a whole interval.
      //
      // A folder that cannot be read fails the whole page rather than being skipped. The
      // engine's backoff and retirement ceiling are the only things that can bound a
      // persistent failure — a page reported as a success clears the failure count, so a
      // folder failing forever would be retried forever, never retired and never surfaced
      // to the user. Losing the sibling folder's page to that is cheap: its stored
      // position is untouched, so the next tick re-reads exactly what this one discarded.
      for (const folder of SYNCED_FOLDERS) {
        const result = await readFolder(
          fetchImpl,
          auth.access_token,
          folder,
          stored.get(folder),
          since,
        );
        pending.push(result.refs);
        if (result.position !== null) nextCursor.set(folder, result.position);
        if (result.present) readableFolders += 1;
        anyInvalid ||= result.invalid;
        anyMore ||= result.hasMore;
      }

      // A mailbox with neither folder is one the token cannot see rather than an empty
      // one: Inbox is not a folder a live mailbox lacks. Reporting an empty page for it
      // would clear the failure count on every tick, so it would never be retired.
      if (readableFolders === 0) {
        throw providerError(
          'graphProvider: no folder on this mailbox could be read',
          CONNECTION_FAILED,
        );
      }
      // One invalidated folder invalidates the account: the seam requires a null cursor
      // beside cursorInvalid, and the engine's recovery is a bounded re-backfill. Bodies
      // are fetched only once that is settled, so a discarded page costs no `$value` call.
      if (anyInvalid) {
        return { messages: [], cursor: null, cursorInvalid: true, hasMore: false };
      }

      // Deduplicated across folders before any body is fetched: a Graph id is unique in
      // the mailbox, so a self-sent message listed by both folders is one document, and
      // downloading it twice spends the per-mailbox throttle budget this pass is
      // sequential to protect.
      const seen = new Set<string>();
      const unique: GraphMessageRef[] = [];
      for (const refs of pending) {
        for (const ref of refs) {
          if (seen.has(ref.id)) continue;
          seen.add(ref.id);
          unique.push(ref);
        }
      }

      const messages = await readMessages(fetchImpl, auth.access_token, unique, accountAddress);

      return {
        messages,
        cursor: serializeCursor(nextCursor),
        cursorInvalid: false,
        hasMore: anyMore,
      };
    },
  };
}
