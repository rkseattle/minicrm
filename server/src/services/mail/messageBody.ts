/**
 * What every mail provider owes a stored message: body parsing, and the field rules that
 * are the same whatever protocol the message arrived over.
 *
 * The rules here are shared rather than per-provider because a mailbox must not read
 * differently depending on which driver synced it.
 *
 * The whole document goes to `simpleParser`, rather than this code selecting parts out of
 * BODYSTRUCTURE and fetching them individually. Part selection needs a correct rule for
 * every shape the parser already handles — excluding attachment-dispositioned text parts,
 * stopping at a message/rfc822 boundary, the single-part TEXT case — and each one is a
 * place to store the wrong text for a well-formed message.
 */

import { createHash } from 'node:crypto';

import { simpleParser } from 'mailparser';
import type { AddressObject } from 'mailparser';
import { htmlToText } from 'html-to-text';

import type { ThreadingHeaders } from './threading.js';

/** Characters of body text kept for a list view that must not load a whole body. */
const SNIPPET_LENGTH = 200;

/**
 * Longest body stored, in characters.
 *
 * The fetch caps the raw document at two megabytes, but a document that size can decode
 * to far more — base64 expands, and deep HTML flattens to a long string. These are
 * unindexed `text` columns whose contents a sender chooses, so nothing else bounds them.
 *
 * Chosen against the PAGE, not the message: two body fields, two hundred messages, two
 * mailboxes, all held at once through the insert. At 64 Ki characters that is roughly
 * 50-100 MB per tick depending on whether the text stays Latin-1 in the engine, which
 * the sequential tick carries. Raising this raises that product by the same factor.
 */
const MAX_BODY_LENGTH = 65_536;

/**
 * Cuts to a length without splitting an astral character.
 *
 * Exported because every bounded sender-controlled string owes this, not just a body.
 *
 * A plain slice cuts by UTF-16 code unit, so it can leave a lone high surrogate that
 * reaches the column as a replacement character — silent corruption of the last
 * character rather than a failure.
 */
export function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastCode = cut.charCodeAt(cut.length - 1);
  const splitPair = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return splitPair ? cut.slice(0, -1) : cut;
}

/**
 * Strips what a `text` column cannot hold.
 *
 * Postgres rejects NUL in a text value with SQLSTATE 22021, which is not a mapped error:
 * it would escape as a 500 and fail the whole page, so one sender wedges an account's
 * sync indefinitely — every message in that page lost, the cursor unadvanced, and the
 * same failure on every tick after.
 *
 * Every sender-controlled string owes this, not just a body. A subject arrives decoded
 * through RFC 2047, which carries NUL straight through, and an address or a Message-ID is
 * no more trustworthy. Exported for that reason, and because a second provider owes it
 * too: the column enforces nothing.
 */
export function stripNul(value: string): string {
  return value.replace(/\u0000/g, '');
}

/**
 * What a body column can hold: NUL removed and length bounded.
 *
 * Exported because every provider owes both rules, not just IMAP.
 */
export function storable(value: string): string {
  return truncate(stripNul(value), MAX_BODY_LENGTH);
}

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
 *
 * NUL is stripped here rather than by the caller: these values reach an indexed column,
 * Postgres rejects NUL in text outright, and a caller that forgets fails the whole page.
 * Stripped before the length test so the decision counts what will actually be stored.
 */
export function boundIndexedId(id: string): string {
  const stripped = stripNul(id);
  if (stripped.length <= MAX_INDEXED_ID_LENGTH) return stripped;
  return `sha256:${createHash('sha256').update(stripped, 'utf8').digest('hex')}`;
}

/** The subject a `text` column can hold: bounded, and stripped of what Postgres rejects. */
export function subjectOf(subject: string | undefined): string | null {
  if (subject === undefined) return null;
  return truncate(stripNul(subject), MAX_SUBJECT_LENGTH);
}

/**
 * Decides whether the account sent this message.
 *
 * Compares the sender against the mailbox's own address rather than trusting the folder:
 * a copy of a sent message can appear in INBOX (self-addressed mail, some server-side
 * rules), and an inbound message can be filed into Sent by a misconfigured client.
 *
 * @param fromAddress - Sender, already lowercased by the caller that parsed it.
 */
export function directionOf(fromAddress: string, accountAddress: string): 'inbound' | 'outbound' {
  return fromAddress === accountAddress.trim().toLowerCase() ? 'outbound' : 'inbound';
}

/** The body fields parsed out of one message. */
export interface ParsedMessageBody {
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  /**
   * True when the document was expected to yield text and did not.
   *
   * Reported rather than logged here, so the caller can name the message: this module
   * knows the outcome but not the id. It covers a document that produced nothing at all
   * and one whose HTML survived while the text conversion failed — both leave the text
   * and snippet columns permanently null, which is the loss worth reporting. It is not a
   * reason: an unreadable document and one that genuinely carries no body arrive
   * identically, and the parser cannot tell them apart.
   */
  lostText: boolean;
}

/** What a message with no usable body stores: headers land, bodies do not. */
export const EMPTY_MESSAGE_BODY: ParsedMessageBody = Object.freeze({
  bodyText: null,
  bodyHtml: null,
  snippet: null,
  lostText: true,
});

/**
 * Collapses runs of whitespace and cuts to the snippet length.
 *
 * Normalizing before testing for empty is what makes a whitespace-only body null rather
 * than a string of spaces: such a body parses to non-empty text, so the order matters.
 *
 * Call this on text that has already been through `storable`. It bounds length but does
 * not strip NUL, because the text it summarizes is expected to carry none by then.
 */
export function snippetOf(bodyText: string | null): string | null {
  if (bodyText === null) return null;
  const collapsed = bodyText.replace(/\s+/g, ' ').trim();
  return collapsed === '' ? null : truncate(collapsed, SNIPPET_LENGTH);
}

/**
 * The plain-text body, converted from HTML when the message carries no text part.
 *
 * mailparser derives `text` from HTML itself, but only for a single-part text/html
 * message — the same HTML inside a multipart container yields undefined. Converting here
 * rather than taking whatever the parser produced is what stops a body from depending on
 * whether the sender used a multipart wrapper.
 */
function bodyTextOf(text: string | undefined, html: string | false): string | null {
  if (typeof text === 'string' && text.trim() !== '') return storable(text);
  if (typeof html === 'string' && html !== '') {
    // Tested after converting, not before: markup that is only a spacer or an entity —
    // a signature-only reply, a tracking pixel — converts to whitespace or to nothing,
    // and storing that would put text in the column with no snippet beside it.
    const converted = htmlToText(html, { wordwrap: false });
    return converted.trim() === '' ? null : storable(converted);
  }
  return null;
}

/** Everything a provider needs from one document, parsed once. */
export interface ParsedMessage extends ParsedMessageBody {
  /** Sender address, lowercased. Empty when the document carries none. */
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  /** Send time, or null when the document carried no usable date. */
  sentAt: Date | null;
  hasAttachments: boolean;
  /** RFC 5322 headers, for a provider with no native thread id to fall back on. */
  threading: ThreadingHeaders;
}

/** An address list, lowercased and stripped of what a text column cannot hold. */
function addressesOf(value: AddressObject | AddressObject[] | undefined): string[] {
  const groups = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return groups
    .flatMap((group) => group.value)
    .map((entry) => (entry.address ? stripNul(entry.address).trim().toLowerCase() : ''))
    .filter((address) => address !== '');
}

/** A date the database will accept, or null. An Invalid Date reaches timestamptz as neither. */
function usableDate(value: Date | undefined): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

/**
 * Parses one document into every field a stored message needs.
 *
 * One parse, not two: simpleParser is the most expensive thing a driver does per message,
 * and it already returns the headers a caller would otherwise re-read the document for.
 *
 * Never throws, for the reason parseMessageBody does not — a caller cannot catch what an
 * unreadable document does to a page it shares with well-formed messages.
 */
export async function parseMessage(
  source: Buffer,
  options?: { headersOnly?: boolean },
): Promise<ParsedMessage> {
  const empty: ParsedMessage = {
    ...EMPTY_MESSAGE_BODY,
    fromAddress: '',
    toAddresses: [],
    ccAddresses: [],
    subject: null,
    sentAt: null,
    hasAttachments: false,
    threading: {},
  };

  // Held outside the try so a failed text conversion still stores the HTML the parser had
  // already returned: it is the more faithful record of the two.
  let bodyHtml: string | null = null;
  try {
    // Neither output is read, and each costs memory proportional to the document.
    // `skipTextLinks` is deliberately absent: the library returns on `skipTextToHtml`
    // before it is ever consulted, so setting it would be dead configuration.
    const parsed = await simpleParser(source, { skipTextToHtml: true, skipImageLinks: true });

    // Inside the try, not after it: htmlToText recurses over sender-controlled markup and
    // overflows the stack on deep nesting, which a 220 KB document already reaches.
    // `html` is false, not undefined, when a message has no HTML part.
    //
    // A caller that asked for headers only still gets them: a message too large to store
    // a body for is worth keeping as correspondence, and dropping it would lose it
    // permanently — the cursor advances past it either way. The document is parsed either
    // way, since the headers come out of the same pass; this bounds the columns, not the work.
    bodyHtml =
      !options?.headersOnly && typeof parsed.html === 'string' && parsed.html !== ''
        ? storable(parsed.html)
        : null;
    const bodyText = options?.headersOnly ? null : bodyTextOf(parsed.text, parsed.html);

    return {
      bodyText,
      bodyHtml,
      snippet: snippetOf(bodyText),
      lostText: bodyText === null,
      fromAddress: addressesOf(parsed.from)[0] ?? '',
      toAddresses: addressesOf(parsed.to),
      ccAddresses: addressesOf(parsed.cc),
      subject: subjectOf(parsed.subject),
      sentAt: usableDate(parsed.date),
      // `related` marks a part the parser says should not be offered for download — an
      // embedded image a cid: URL references — so those are body content, not attachments.
      hasAttachments: parsed.attachments.some((part) => !part.related),
      threading: {
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: Array.isArray(parsed.references)
          ? parsed.references.join(' ')
          : (parsed.references ?? null),
      },
    };
  } catch {
    // lostText stays true even when the HTML survived: the text and snippet columns are
    // null either way, and that is what the caller reports.
    return { ...empty, bodyHtml };
  }
}

/**
 * Parses one raw MIME document for its body fields alone.
 *
 * Delegates to parseMessage rather than parsing again: two implementations of the same
 * rules is how two drivers start storing the same message differently, which is the whole
 * reason these rules live in one module.
 */
export async function parseMessageBody(source: Buffer): Promise<ParsedMessageBody> {
  const { bodyText, bodyHtml, snippet, lostText } = await parseMessage(source);
  return { bodyText, bodyHtml, snippet, lostText };
}
