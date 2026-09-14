/**
 * Builds the MIME document a send puts on the wire, and decides which conversation it
 * joins.
 *
 * Shared by every driver for the reason `messageBody.ts` is shared on the read side: a
 * message must not thread differently depending on which provider sent it.
 *
 * Encoding is `MailComposer`'s, not this module's. RFC 5322 header folding, RFC 2047
 * encoded-words for a non-ASCII subject, quoted-printable bodies, and multipart boundaries
 * are each a place a hand-rolled builder produces something a provider accepts and a
 * recipient renders wrongly. nodemailer already ships the composer and is already a
 * dependency here.
 */

import { randomUUID } from 'node:crypto';

// Deep import because nodemailer's root exports only createTransport, createTestAccount,
// and getTestMessageUrl — the composer is reachable no other way. The package declares no
// `exports` map today; a minor release adding one would break this import at build time,
// which the caret range in package.json permits.
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

import { boundIndexedId, subjectOf } from './messageBody.js';
import { extractMessageIds, normalizeMessageId } from './threading.js';

/** What a caller asks to be sent. */
export interface OutboundMessage {
  /** The sending mailbox's own address. */
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  bodyHtml: string;
}

/**
 * The message being replied to or forwarded, as the store holds it.
 *
 * Passed in rather than looked up: this module builds documents and must stay free of the
 * database, so it can be tested directly and reused by a driver that never sees a row.
 */
export interface ParentMessage {
  /** The conversation the parent belongs to, as `email_messages.thread_id` holds it. */
  threadId: string;
  /**
   * The parent's RFC 5322 `Message-ID`, angle brackets included or not.
   *
   * Null for a parent whose own `Message-ID` was never stored — a message synced before
   * the header was parsed, or one that arrived without one. A reply to such a parent still
   * joins its thread here, but carries no `In-Reply-To`, so the recipient's client threads
   * it on subject alone.
   */
  rfcMessageId: string | null;
  /**
   * The parent's own `References` header, verbatim: whitespace-separated message ids.
   *
   * Carried rather than reconstructed because the reply must extend the chain, not restart
   * it. `resolveThreadId` takes `References[0]` as a conversation's root, so a reply
   * emitting only its immediate parent's id re-roots the conversation on that parent — and
   * because the sync engine's upsert sets `thread_id = EXCLUDED.thread_id`, the correct
   * value written at send time is overwritten when the Sent copy is read back. Every chain
   * deeper than two messages splits.
   */
  references: string | null;
}

/** What a driver sends, and what the store needs back from the build. */
export interface OutboundDocument {
  /** The complete RFC 5322 document, ready for a provider to accept. */
  mime: Buffer;
  /**
   * The `Message-ID` this document carries.
   *
   * Generated here so it is known before the send: a provider that reports no id of its
   * own still leaves the message identifiable, and a reply chain agrees on one root.
   */
  rfcMessageId: string;
  /** The conversation to store the message under, bounded for its btree index. */
  threadId: string;
}

/**
 * Angle-bracketed form, which is how RFC 5322 writes a message id in a header.
 *
 * Stored ids are kept bare, so a value arriving either way is normalized rather than
 * doubled — `<<id>>` is not a valid reference and would thread the reply nowhere.
 */
function bracketed(messageId: string): string {
  // normalizeMessageId owns the bare form on the read side; a second copy of that rule
  // here is how the two drift into threading a reply nowhere.
  return `<${normalizeMessageId(messageId) ?? messageId.trim()}>`;
}

/**
 * A message id in the sender's own domain, per RFC 5322 §3.6.4.
 *
 * The domain half must be one the sender controls, so it is taken from the sending
 * address rather than the host this process happens to run on — a generated id naming an
 * internal hostname leaks it to every recipient.
 */
function defaultMessageId(fromAddress: string): string {
  const domain = fromAddress.split('@')[1]?.trim().toLowerCase();
  return `${randomUUID()}@${domain && domain !== '' ? domain : 'localhost'}`;
}

/**
 * The `References` chain a reply carries: the parent's own chain, then the parent itself.
 *
 * RFC 5322 §3.6.4 builds the chain this way, and the first entry is what every reader —
 * ours included — treats as the conversation's root. Emitting only the parent's id would
 * make the parent the root, which is a different conversation for anything deeper than a
 * single reply.
 *
 * Ids the parent's header already carries are kept verbatim rather than re-derived: they
 * identify messages that may not exist in this mailbox at all.
 */
function referencesFor(parentReferences: string | null, parentMessageId: string | null): string[] {
  // Only real message ids reach this header. Our own `thread_id` is a storage key — it may
  // be a `sha256:` digest from boundIndexedId, which names no message any party has seen —
  // so it must never be emitted. The recipient's client threads on these ids alone, and a
  // synthetic first entry is what splits a reply from the conversation it answers.
  const inherited = extractMessageIds(parentReferences ?? '');
  if (parentMessageId === null) return inherited;

  const parentId = bracketed(parentMessageId);
  // A parent whose own chain already names it must not list it twice; RFC 5322 §3.6.4
  // appends the parent to the chain it inherited.
  return inherited.includes(parentId) ? inherited : [...inherited, parentId];
}

/**
 * Resolves the conversation an outbound message belongs to.
 *
 * A reply takes its parent's stored `thread_id` verbatim rather than re-deriving one: the
 * parent's id already went through `resolveThreadId` when it was ingested, and re-deriving
 * from headers this module just wrote would put the reply in a thread of its own whenever
 * the parent threaded on something other than its own `Message-ID`.
 *
 * A message with no parent threads on its own `Message-ID`, which is what
 * `resolveThreadId` does for a conversation root on the read side.
 */
function resolveOutboundThreadId(rfcMessageId: string, parent: ParentMessage | null): string {
  if (parent) return boundIndexedId(parent.threadId);
  return boundIndexedId(rfcMessageId);
}

/**
 * Builds the document for one send.
 *
 * `In-Reply-To` and `References` are set from the parent so the message lands in the
 * recipient's existing thread — the recipient's client reads those headers, not our
 * `thread_id`, which is why both are written even though the stored thread comes from the
 * parent directly.
 *
 * @param message - What to send.
 * @param parent - The message being replied to or forwarded, or null for a new thread.
 * @param generateMessageId - Injected so a test can pin the id; defaults to a UUID in the
 *   sending address's domain, which is what RFC 5322 §3.6.4 asks for.
 */
export async function buildOutboundDocument(
  message: OutboundMessage,
  parent: ParentMessage | null,
  generateMessageId: () => string = () => defaultMessageId(message.fromAddress),
): Promise<OutboundDocument> {
  if (message.toAddresses.length === 0 && message.ccAddresses.length === 0) {
    // Refused here rather than at the provider, which rejects a recipient-less document
    // with an opaque error the caller cannot map to a field.
    throw Object.assign(new Error('A message needs at least one recipient.'), {
      code: 'NO_RECIPIENT',
    });
  }

  // Generated here rather than read back after compile(), so the caller receives the same
  // id the document carries without depending on MailComposer's generation order.
  const generated = generateMessageId();
  const rfcMessageId = normalizeMessageId(generated) ?? defaultMessageId(message.fromAddress);
  const threadId = resolveOutboundThreadId(rfcMessageId, parent);

  const references = parent ? referencesFor(parent.references, parent.rfcMessageId) : [];

  const composer = new MailComposer({
    from: message.fromAddress,
    to: message.toAddresses,
    cc: message.ccAddresses,
    // subjectOf, not a bare NUL strip: the column is bounded the same way on every path
    // into it, and a 5,000-character subject is a header no provider should be handed.
    subject: subjectOf(message.subject) ?? '',
    html: message.bodyHtml,
    messageId: bracketed(rfcMessageId),
    // In-Reply-To names the message being answered; References carries the whole ancestry.
    // A parent with no stored Message-ID still contributes its inherited chain, which is
    // what threads the reply on the recipient's side.
    ...(parent?.rfcMessageId ? { inReplyTo: bracketed(parent.rfcMessageId) } : {}),
    ...(references.length > 0 ? { references } : {}),
  });

  const mime = await composer.compile().build();

  return {
    mime,
    rfcMessageId,
    threadId,
  };
}
