/**
 * The seam every mail provider implements.
 *
 * The sync engine owns the database, the cursor, and the backoff; a provider owns only
 * "given a cursor, hand me the next messages and a new cursor". Keeping the interface
 * this narrow is what lets Gmail and Microsoft Graph arrive later as implementations
 * rather than as branches threaded through the engine.
 *
 * Cursors are opaque strings the engine stores and returns verbatim. Each provider
 * chooses its own encoding — IMAP's is per-mailbox UIDVALIDITY/UIDNEXT, Gmail's a
 * historyId, Graph's a delta link — and is the only code that parses it. A shared shape
 * would be a schema three providers must agree on for no benefit.
 *
 * This module also carries the connection-test result and the OAuth guard every OAuth
 * driver's entry points share. Neither is part of the sync contract, but both need the
 * same neutral home: the controller dispatches over every provider, and no driver may
 * import another.
 */

import {
  PROVIDER_AUTH_EXPIRED,
  type CONNECTION_FAILED,
  type INSUFFICIENT_SCOPE,
} from '@minicrm/shared/schemas/connectedAccountSchema.js';

import type { ConnectedAccountAuth } from '../connectedAccountService.js';

/**
 * What a connection test answers.
 *
 * Here rather than in a driver because the controller dispatches over providers and must
 * name one type for all of them; this is the only module every driver and the controller
 * already reach without importing each other.
 *
 * `message` is for logs and for a caller reporting a raw provider error — the panel
 * renders `code` by translating it, so prose put there would arrive as a key no locale
 * file matches.
 */
export type MailboxTestResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof CONNECTION_FAILED | typeof PROVIDER_AUTH_EXPIRED | typeof INSUFFICIENT_SCOPE;
      message: string;
    };

/** A message normalized out of whatever shape its provider returned. */
export interface NormalizedMessage {
  /** The provider's own identifier. Opaque; unique per connected account. */
  providerMessageId: string;
  /** Native thread id where the provider has one, else derived from RFC 5322 headers. */
  threadId: string;
  direction: 'inbound' | 'outbound';
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  hasAttachments: boolean;
  /** When the message was sent, or null when the provider reported no usable date. */
  sentAt: Date | null;
  /**
   * Plain-text body. Taken from the message's text part, or converted from its HTML when
   * it has only that, so the same content reads the same either way. Null when the
   * message carries neither, when it exceeded the body size cap, or when it would not
   * parse.
   */
  bodyText: string | null;
  /**
   * HTML body as the sender wrote it, unsanitized. Null when the message carried no HTML
   * part, when it exceeded the size cap, or when it would not parse — but NOT merely
   * because `bodyText` is null: a message whose text derivation failed still stores the
   * HTML the parser returned.
   */
  bodyHtml: string | null;
  /** Leading characters of bodyText, whitespace collapsed. Null whenever bodyText is. */
  snippet: string | null;
  /** The message's own `Message-ID`, bare. What a reply to it names in `In-Reply-To`. */
  rfcMessageId: string | null;
  /** Its ancestry as bracketed ids, oldest first. What a reply to it extends. */
  references: string | null;
}

/** One page of history, plus where to resume. */
export interface ProviderPage {
  messages: NormalizedMessage[];
  /**
   * Where the next fetch resumes. Null exactly when `cursorInvalid` is true — there is
   * nothing worth persisting, because the engine is about to re-backfill.
   */
  cursor: string | null;
  /**
   * The stored cursor no longer means anything to the provider: an IMAP UIDVALIDITY
   * change, an expired Gmail historyId, a rejected delta link. The engine responds by
   * re-backfilling within the configured window rather than resyncing everything.
   */
  cursorInvalid: boolean;
  /** More history is waiting. The engine decides whether to keep going this tick. */
  hasMore: boolean;
}

/** What a provider reports about a message it accepted. */
export interface SentMessage {
  /**
   * The provider's own identifier for the message it just accepted.
   *
   * Required because the outbound row must carry the same `provider_message_id` the sync
   * engine will derive when it reads that message back out of Sent — otherwise the ingest
   * stores it a second time instead of updating the row.
   *
   * SMTP submission returns no such id, which is why no IMAP `send` is defined here:
   * recognizing its own sent mail needs a client-side APPEND and a per-account setting
   * rather than a wider type.
   */
  providerMessageId: string;
  /**
   * The provider's own conversation id for the message, or null when it reported none.
   *
   * The sync engine threads a mailbox's mail on this id, so a new conversation stored under
   * anything else would split from the replies that later arrive in it.
   */
  threadId: string | null;
}

export interface MailProvider {
  /**
   * Fetches the next page of history for one mailbox.
   *
   * @param auth - Decrypted credentials for the account being synced.
   * @param cursor - Where the last fetch stopped, or null to start from `since`.
   * @param since - Oldest message to consider when there is no cursor. Ignored once a
   *   cursor exists: the cursor is authoritative, so a mailbox whose sync stalled longer
   *   than the backfill window still resumes where it left off rather than skipping mail.
   */
  fetchSince(auth: ConnectedAccountAuth, cursor: string | null, since: Date): Promise<ProviderPage>;

  /**
   * Submits one message through the mailbox.
   *
   * Optional because not every provider can: a driver without it is read-only, and the
   * send path refuses that mailbox rather than failing at call time. A caller must check
   * for the method rather than assume it.
   *
   * @param auth - Decrypted credentials for the sending account.
   * @param mime - The complete RFC 5322 document. Build it with `outboundMessage.ts` so
   *   every driver puts the same bytes on the wire; a driver composing its own would
   *   thread differently from the others.
   * @param threadHint - The stored `thread_id` of the message being answered, or null.
   *   It must come from a message synced by this same account: Gmail files the sent copy
   *   into that conversation by id, and an id from another mailbox names nothing there.
   *   Graph takes no conversation id on a send and ignores the hint.
   * @throws an error whose `code` is one of `sendOutcome.ts`'s `SEND_FAILURE_CODES`.
   */
  send?(auth: ConnectedAccountAuth, mime: Buffer, threadHint: string | null): Promise<SentMessage>;
}

/**
 * The access token of an OAuth account, or a refusal for any other kind.
 *
 * Shared by every OAuth driver's entry points: an IMAP payload reaching one is a wiring
 * fault, and refusing it as an expired credential asks for a reconnect rather than
 * crashing the tick.
 */
export function requireOAuthAccessToken(auth: ConnectedAccountAuth, provider: string): string {
  if (auth.kind !== 'oauth') {
    throw Object.assign(new Error(`${provider} requires an OAuth account.`), {
      code: PROVIDER_AUTH_EXPIRED,
    });
  }
  return auth.access_token;
}
