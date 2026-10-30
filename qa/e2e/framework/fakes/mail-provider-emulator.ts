/**
 * A stateful stand-in for the Gmail and Microsoft Graph mail endpoints the sync engine
 * calls, for E2E runs where the real providers cannot be reached.
 *
 * One file with no relative imports and only erasable TypeScript, so Node loads it with its
 * built-in type stripping and the container that runs it needs neither tsx nor a build.
 *
 * Ids are lowercase hex, the form Gmail's are and the server's driver insists on, so a
 * reply's threadId reaches the request exactly as it would against Gmail.
 *
 * Each mailbox is selected by the bearer token the client sends. One sequence number per
 * mailbox advances on every stored message and serves as both Gmail's historyId and the
 * position in a Graph delta link, so incremental reads see exactly what was added since.
 *
 * The control plane, which a test drives and the server never sees:
 *
 * - `POST /__admin/mailboxes` — body {@link RegisterMailbox}. Creates the mailbox, or
 *   answers 200 when it exists with that address and 409 when it exists with another.
 * - `DELETE /__admin/mailboxes/:token` — forgets one mailbox; a test's own teardown.
 * - `POST /__admin/mailboxes/:token/messages` — body {@link SeedMessage}; answers 201
 *   `{ id, threadId }`, both lowercase hex.
 * - `GET /__admin/mailboxes/:token/messages` — answers `{ messages: AdminMessage[] }`,
 *   every message in storage order, drafts included.
 * - `POST /__admin/mailboxes/:token/expire-cursors` — makes every historyId and delta link
 *   issued so far stale, as a provider does when it can no longer resume a sync.
 * - `POST /__admin/reset` — forgets every mailbox; for global setup only, since parallel
 *   workers share one emulator.
 * - `GET /health` — 200 `{ ok: true }`, unauthenticated; for a readiness probe.
 */

import http from 'node:http';

const DEFAULT_PAGE_SIZE = 10;
/** Largest request body accepted; exported so a test can probe both sides of it. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Hex digits in a minted id, the width Gmail's own ids have. */
const ID_HEX_DIGITS = 16;
const FIRST_SEQUENCE = 1000;
const GMAIL_PREFIX = '/gmail/v1/users/me';
const GRAPH_PREFIX = '/v1.0/me';
const ADMIN_PREFIX = '/__admin';
const GRAPH_FOLDERS = ['inbox', 'sentitems'] as const;

type GraphFolder = (typeof GRAPH_FOLDERS)[number];

interface StoredMessage {
  id: string;
  threadId: string;
  raw: Buffer;
  folder: GraphFolder;
  receivedAt: Date;
  sequence: number;
  isDraft: boolean;
  messageIdHeader: string | null;
}

interface Mailbox {
  address: string;
  sequence: number;
  /** Gmail history before this sequence is gone; a startHistoryId below it gets 404. */
  historyFloor: number;
  /** A delta link minted under an older generation gets 410, as Graph does on resync. */
  deltaGeneration: number;
  messages: StoredMessage[];
}

/** Body of `POST /__admin/mailboxes`; `token` is the bearer token the server will send. */
export interface RegisterMailbox {
  token: string;
  address: string;
}

/** Body of `POST /__admin/mailboxes/:token/messages`. */
export interface SeedMessage {
  /** The whole RFC 5322 message, headers and body. */
  raw: string;
  /** Lowercase hex, as Gmail's are; omitted, the headers place it, or it starts a thread. */
  threadId?: string;
  /** Defaults to inbox. */
  folder?: 'inbox' | 'sent';
  /** ISO 8601; defaults to now. */
  receivedAt?: string;
}

/** One entry of `GET /__admin/mailboxes/:token/messages`. */
export interface AdminMessage {
  id: string;
  threadId: string;
  folder: 'inbox' | 'sentitems';
  isDraft: boolean;
  raw: string;
}

const HEX_ID = /^[0-9a-f]+$/;

class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${String(status)}`);
    this.status = status;
    this.body = body;
  }
}

/** One header's value, with RFC 5322 folded continuation lines joined, or null. */
function headerValue(raw: Buffer, name: string): string | null {
  const head = (raw.toString('utf8').split(/\r?\n\r?\n/, 1)[0] ?? '').replace(/\r?\n[ \t]+/g, ' ');
  const pattern = new RegExp(`^${name}:[ \\t]*(.+)$`, 'im');
  const match = pattern.exec(head);
  return match?.[1]?.trim() ?? null;
}

/** The message ids a reply names as its parents: In-Reply-To first, then References. */
function parentIds(raw: Buffer): string[] {
  const named = [headerValue(raw, 'In-Reply-To'), headerValue(raw, 'References')];
  return named.flatMap((value) => value?.match(/<[^>]+>/g) ?? []);
}

/** A path segment decoded, or a 404 naming the decode error for invalid percent-encoding. */
function decodeSegment(segment: string | undefined, notFound: () => HttpError): string {
  try {
    return decodeURIComponent(segment ?? '');
  } catch (err) {
    const base = notFound();
    // Safe: every 404 builder here returns an object body, as the providers' errors are.
    const body = base.body as Record<string, unknown>;
    throw new HttpError(base.status, { ...body, cause: String(err) });
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    // Safe: an IncomingMessage with no encoding set yields Buffers.
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, { error: 'body too large' });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8') || '{}');
  } catch (err) {
    throw new HttpError(400, { error: `expected a JSON object: ${String(err)}` });
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    // Safe: checked just above to be a non-array object.
    return parsed as Record<string, unknown>;
  }
  throw new HttpError(400, { error: 'expected a JSON object' });
}

/** Builds the emulator. Nothing listens until the caller calls `listen`. */
export function createMailProviderEmulator(): http.Server {
  const mailboxes = new Map<string, Mailbox>();
  let nextId = 1;

  const newId = (): string => (nextId++).toString(16).padStart(ID_HEX_DIGITS, '0');

  function mailboxFor(req: http.IncomingMessage, unauthorized: unknown): Mailbox {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const mailbox = mailboxes.get(token);
    if (!mailbox) throw new HttpError(401, unauthorized);
    return mailbox;
  }

  /** The thread a message's own headers place it in, as delivery and Graph drafts do. */
  function threadFromHeaders(mailbox: Mailbox, raw: Buffer): string {
    for (const parent of parentIds(raw)) {
      const match = mailbox.messages.find((m) => m.messageIdHeader === parent);
      if (match) return match.threadId;
    }
    return newId();
  }

  function store(
    mailbox: Mailbox,
    raw: Buffer,
    folder: GraphFolder,
    threadId: string,
    receivedAt: Date,
    isDraft: boolean,
  ): StoredMessage {
    mailbox.sequence += 1;
    const message: StoredMessage = {
      id: newId(),
      threadId,
      raw,
      folder,
      receivedAt,
      sequence: mailbox.sequence,
      isDraft,
      messageIdHeader: headerValue(raw, 'Message-ID'),
    };
    mailbox.messages.push(message);
    return message;
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async function admin(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
    if (req.method === 'POST' && path === '/reset') {
      mailboxes.clear();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && path === '/mailboxes') {
      const { token, address } = await readJson(req);
      if (typeof token !== 'string' || !token || typeof address !== 'string' || !address) {
        throw new HttpError(400, { error: 'token and address are required' });
      }
      const existing = mailboxes.get(token);
      if (existing && existing.address !== address) {
        throw new HttpError(409, { error: `token already registered to ${existing.address}` });
      }
      if (!existing) {
        mailboxes.set(token, {
          address,
          sequence: FIRST_SEQUENCE,
          historyFloor: 0,
          deltaGeneration: 1,
          messages: [],
        });
      }
      return sendJson(res, 200, { token, address });
    }
    const noMailbox = () => new HttpError(404, { error: 'no such mailbox' });
    const whole = /^\/mailboxes\/([^/]+)$/.exec(path);
    if (req.method === 'DELETE' && whole) {
      if (!mailboxes.delete(decodeSegment(whole[1], noMailbox))) throw noMailbox();
      return sendJson(res, 200, { ok: true });
    }
    const scoped = /^\/mailboxes\/([^/]+)\/(messages|expire-cursors)$/.exec(path);
    const mailbox = scoped ? mailboxes.get(decodeSegment(scoped[1], noMailbox)) : undefined;
    if (scoped && !mailbox) throw noMailbox();
    if (mailbox && scoped?.[2] === 'expire-cursors' && req.method === 'POST') {
      // Every historyId issued so far goes stale; the one profile reports next stays valid.
      mailbox.sequence += 1;
      mailbox.historyFloor = mailbox.sequence;
      mailbox.deltaGeneration += 1;
      return sendJson(res, 200, { ok: true });
    }
    if (mailbox && scoped?.[2] === 'messages' && req.method === 'POST') {
      const seed = await readJson(req);
      if (typeof seed['raw'] !== 'string' || !seed['raw']) {
        throw new HttpError(400, { error: 'raw is required' });
      }
      if (seed['folder'] !== undefined && seed['folder'] !== 'inbox' && seed['folder'] !== 'sent') {
        throw new HttpError(400, { error: 'folder must be inbox or sent' });
      }
      const receivedAt =
        seed['receivedAt'] === undefined ? new Date() : new Date(String(seed['receivedAt']));
      if (Number.isNaN(receivedAt.getTime())) {
        throw new HttpError(400, { error: 'receivedAt must be an ISO 8601 date' });
      }
      const raw = Buffer.from(seed['raw'], 'utf8');
      if (seed['threadId'] !== undefined && !HEX_ID.test(String(seed['threadId']))) {
        throw new HttpError(400, { error: 'threadId must be lowercase hex' });
      }
      const threadId =
        seed['threadId'] !== undefined ? String(seed['threadId']) : threadFromHeaders(mailbox, raw);
      const folder: GraphFolder = seed['folder'] === 'sent' ? 'sentitems' : 'inbox';
      const stored = store(mailbox, raw, folder, threadId, receivedAt, false);
      return sendJson(res, 201, { id: stored.id, threadId: stored.threadId });
    }
    if (mailbox && scoped?.[2] === 'messages' && req.method === 'GET') {
      return sendJson(res, 200, {
        messages: mailbox.messages.map((m): AdminMessage => ({
          id: m.id,
          threadId: m.threadId,
          folder: m.folder,
          isDraft: m.isDraft,
          raw: m.raw.toString('utf8'),
        })),
      });
    }
    throw new HttpError(404, { error: 'no such admin route' });
  }

  // ── Gmail ──────────────────────────────────────────────────────────────────

  const GMAIL_UNAUTHORIZED = { error: { code: 401, status: 'UNAUTHENTICATED' } };
  const gmailNotFound = () => new HttpError(404, { error: { code: 404, status: 'NOT_FOUND' } });
  const gmailLabels = (m: StoredMessage): string[] => [m.folder === 'inbox' ? 'INBOX' : 'SENT'];
  const gmailRef = (m: StoredMessage) => ({ id: m.id, threadId: m.threadId });

  function page<T>(items: T[], url: URL): { slice: T[]; next: string | undefined } {
    const size = Math.max(1, Number(url.searchParams.get('maxResults')) || DEFAULT_PAGE_SIZE);
    const offset = Math.max(0, Number(url.searchParams.get('pageToken') ?? '0') || 0);
    const slice = items.slice(offset, offset + size);
    const next = offset + size < items.length ? String(offset + size) : undefined;
    return { slice, next };
  }

  async function gmail(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    path: string,
  ) {
    const mailbox = mailboxFor(req, GMAIL_UNAUTHORIZED);
    const visible = mailbox.messages.filter((m) => !m.isDraft);

    if (req.method === 'GET' && path === '/profile') {
      return sendJson(res, 200, {
        emailAddress: mailbox.address,
        historyId: String(mailbox.sequence),
      });
    }
    if (req.method === 'GET' && path === '/messages') {
      const after = /after:(\d+)/.exec(url.searchParams.get('q') ?? '');
      const since = after ? Number(after[1]) * 1000 : 0;
      const matching = visible
        .filter((m) => m.receivedAt.getTime() >= since)
        // Newest first by date, as Gmail lists; arrival order breaks a tie.
        .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime() || b.sequence - a.sequence);
      const { slice, next } = page(matching, url);
      return sendJson(res, 200, {
        messages: slice.map(gmailRef),
        resultSizeEstimate: matching.length,
        ...(next ? { nextPageToken: next } : {}),
      });
    }
    if (req.method === 'GET' && path === '/history') {
      const startParam = url.searchParams.get('startHistoryId') ?? '';
      if (!/^\d+$/.test(startParam)) {
        throw new HttpError(400, { error: { code: 400, status: 'INVALID_ARGUMENT' } });
      }
      const start = Number(startParam);
      if (start < mailbox.historyFloor) {
        throw gmailNotFound();
      }
      const added = visible
        .filter((m) => m.sequence > start)
        .sort((a, b) => a.sequence - b.sequence);
      const { slice, next } = page(added, url);
      return sendJson(res, 200, {
        history: slice.map((m) => ({
          id: String(m.sequence),
          messagesAdded: [{ message: { ...gmailRef(m), labelIds: gmailLabels(m) } }],
        })),
        historyId: String(mailbox.sequence),
        ...(next ? { nextPageToken: next } : {}),
      });
    }
    if (req.method === 'POST' && path === '/messages/send') {
      const { raw, threadId } = await readJson(req);
      if (typeof raw !== 'string' || !raw) throw new HttpError(400, { error: { code: 400 } });
      // Gmail files a send only by the threadId it is handed, never by its headers.
      const named = typeof threadId === 'string' && threadId ? threadId : newId();
      if (named === threadId && !mailbox.messages.some((m) => m.threadId === named)) {
        throw gmailNotFound();
      }
      const sent = store(
        mailbox,
        Buffer.from(raw, 'base64url'),
        'sentitems',
        named,
        new Date(),
        false,
      );
      return sendJson(res, 200, { ...gmailRef(sent), labelIds: gmailLabels(sent) });
    }
    const single = /^\/messages\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && single) {
      // Decoded once, before the lookup, so a malformed id is reported even in an empty mailbox.
      const id = decodeSegment(single[1], gmailNotFound);
      const message = visible.find((m) => m.id === id);
      if (!message) throw gmailNotFound();
      return sendJson(res, 200, {
        ...gmailRef(message),
        labelIds: gmailLabels(message),
        historyId: String(message.sequence),
        internalDate: String(message.receivedAt.getTime()),
        raw: message.raw.toString('base64url'),
      });
    }
    throw gmailNotFound();
  }

  // ── Graph ──────────────────────────────────────────────────────────────────

  const GRAPH_UNAUTHORIZED = {
    error: { code: 'InvalidAuthenticationToken', message: 'unknown token' },
  };
  const graphNotFound = () =>
    new HttpError(404, { error: { code: 'ErrorItemNotFound', message: 'not found' } });

  function pageSize(req: http.IncomingMessage): number {
    const prefer = /odata\.maxpagesize=(\d+)/.exec(String(req.headers.prefer ?? ''));
    return prefer ? Math.max(1, Number(prefer[1])) : DEFAULT_PAGE_SIZE;
  }

  function deltaLink(origin: string, folder: GraphFolder, query: Record<string, string>): string {
    const params = new URLSearchParams(query);
    return `${origin}${GRAPH_PREFIX}/mailFolders/${folder}/messages/delta?${params.toString()}`;
  }

  async function graph(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    path: string,
    origin: string,
  ) {
    const mailbox = mailboxFor(req, GRAPH_UNAUTHORIZED);

    const folderMatch = /^\/mailFolders\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && folderMatch) {
      const folder = decodeSegment(folderMatch[1], graphNotFound);
      if (!(GRAPH_FOLDERS as readonly string[]).includes(folder)) throw graphNotFound();
      return sendJson(res, 200, { id: folder, displayName: folder });
    }

    const deltaMatch = /^\/mailFolders\/([^/]+)\/messages\/delta$/.exec(path);
    if (req.method === 'GET' && deltaMatch) {
      const named = decodeSegment(deltaMatch[1], graphNotFound);
      const folder = GRAPH_FOLDERS.find((candidate) => candidate === named);
      if (!folder) throw graphNotFound();
      const state = url.searchParams.get('$deltatoken') ?? url.searchParams.get('$skiptoken');
      let since = 0;
      let offset = 0;
      if (state !== null) {
        const [generation, sequence, skip] = state.split('.').map(Number);
        if (generation !== mailbox.deltaGeneration) {
          throw new HttpError(410, { error: { code: 'syncStateNotFound', message: 'resync' } });
        }
        since = sequence ?? 0;
        offset = skip ?? 0;
      }
      const changed = mailbox.messages
        .filter((m) => m.folder === folder && !m.isDraft && m.sequence > since)
        .sort((a, b) => a.sequence - b.sequence);
      const size = pageSize(req);
      const slice = changed.slice(offset, offset + size);
      const generation = String(mailbox.deltaGeneration);
      const link =
        offset + size < changed.length
          ? {
              '@odata.nextLink': deltaLink(origin, folder, {
                $skiptoken: `${generation}.${String(since)}.${String(offset + size)}`,
              }),
            }
          : {
              '@odata.deltaLink': deltaLink(origin, folder, {
                $deltatoken: `${generation}.${String(mailbox.sequence)}`,
              }),
            };
      return sendJson(res, 200, {
        value: slice.map((m) => ({
          id: m.id,
          conversationId: m.threadId,
          isDraft: false,
          receivedDateTime: m.receivedAt.toISOString(),
        })),
        ...link,
      });
    }

    const valueMatch = /^\/messages\/([^/]+)\/\$value$/.exec(path);
    if (req.method === 'GET' && valueMatch) {
      const id = decodeSegment(valueMatch[1], graphNotFound);
      const message = mailbox.messages.find((m) => m.id === id);
      if (!message) throw graphNotFound();
      res.writeHead(200, { 'Content-Type': 'message/rfc822' });
      res.end(message.raw);
      return;
    }

    if (req.method === 'POST' && path === '/messages') {
      const encoded = (await readBody(req)).toString('utf8').trim();
      const raw = Buffer.from(encoded, 'base64');
      if (
        !encoded ||
        !/^[A-Za-z0-9+/]+=*$/.test(encoded) ||
        !/\r?\n\r?\n/.test(raw.toString('utf8'))
      ) {
        throw new HttpError(400, {
          error: { code: 'ErrorMimeContentInvalid', message: 'bad MIME' },
        });
      }
      // Graph files a draft by its In-Reply-To and References, as Outlook threads replies.
      const draft = store(
        mailbox,
        raw,
        'sentitems',
        threadFromHeaders(mailbox, raw),
        new Date(),
        true,
      );
      return sendJson(res, 201, { id: draft.id, conversationId: draft.threadId, isDraft: true });
    }

    const sendMatch = /^\/messages\/([^/]+)\/send$/.exec(path);
    if (req.method === 'POST' && sendMatch) {
      const id = decodeSegment(sendMatch[1], graphNotFound);
      const draft = mailbox.messages.find((m) => m.id === id);
      if (!draft?.isDraft) throw graphNotFound();
      draft.isDraft = false;
      mailbox.sequence += 1;
      draft.sequence = mailbox.sequence;
      draft.receivedAt = new Date();
      res.writeHead(202);
      res.end();
      return;
    }

    throw graphNotFound();
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const handle = async (): Promise<void> => {
      if (path.startsWith(ADMIN_PREFIX)) return admin(req, res, path.slice(ADMIN_PREFIX.length));
      if (path.startsWith(GMAIL_PREFIX))
        return gmail(req, res, url, path.slice(GMAIL_PREFIX.length));
      if (path.startsWith(GRAPH_PREFIX)) {
        return graph(req, res, url, path.slice(GRAPH_PREFIX.length), url.origin);
      }
      if (path === '/health') return sendJson(res, 200, { ok: true });
      throw new HttpError(404, { error: 'not found' });
    };
    handle().catch((err: unknown) => {
      if (err instanceof HttpError) return sendJson(res, err.status, err.body);
      // The server reads any 5xx as an unreachable mailbox, so this is where a bug shows.
      process.stderr.write(
        `mail provider emulator: ${req.method ?? ''} ${path} failed: ${String(err)}\n`,
      );
      sendJson(res, 500, { error: String(err) });
    });
  });
}
