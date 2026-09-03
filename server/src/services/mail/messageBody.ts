/**
 * Turns a raw MIME document into the body fields the engine stores.
 *
 * The whole document goes to `simpleParser`, rather than this code selecting parts out of
 * BODYSTRUCTURE and fetching them individually. Part selection needs a correct rule for
 * every shape the parser already handles — excluding attachment-dispositioned text parts,
 * stopping at a message/rfc822 boundary, the single-part TEXT case — and each one is a
 * place to store the wrong text for a well-formed message.
 */

import { simpleParser } from 'mailparser';
import { htmlToText } from 'html-to-text';

/** Characters of body text kept for a list view that must not load a whole body. */
const SNIPPET_LENGTH = 200;

/**
 * Longest body stored, in characters.
 *
 * The fetch caps the raw document at two megabytes, but a document that size can decode
 * to far more — base64 expands, and deep HTML flattens to a long string. These are
 * unindexed `text` columns whose contents a sender chooses, so nothing else bounds them.
 */
const MAX_BODY_LENGTH = 262_144;

/**
 * Cuts to a length without splitting an astral character.
 *
 * A plain slice cuts by UTF-16 code unit, so it can leave a lone high surrogate that
 * reaches the column as a replacement character — silent corruption of the last
 * character rather than a failure.
 */
function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastCode = cut.charCodeAt(cut.length - 1);
  const splitPair = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return splitPair ? cut.slice(0, -1) : cut;
}

/**
 * Strips what a `text` column cannot hold and bounds what it should.
 *
 * Exported because every provider owes this, not just IMAP: the column enforces neither
 * rule, so a driver that skips it fails the whole page on one hostile message.
 *
 * Postgres rejects NUL in a text value with SQLSTATE 22021, which is not a mapped error:
 * it would escape as a 500 and fail the whole page, so one sender with a broken encoder
 * wedges an account's sync indefinitely. A body is sender-controlled, and mailparser
 * passes NUL straight through, so it is removed here rather than trusted not to appear.
 */
export function storable(value: string): string {
  return truncate(value.replace(/\u0000/g, ''), MAX_BODY_LENGTH);
}

/** The body fields parsed out of one message. */
export interface ParsedMessageBody {
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
}

/** What a message with no usable body stores: headers land, bodies do not. */
export const EMPTY_MESSAGE_BODY: ParsedMessageBody = {
  bodyText: null,
  bodyHtml: null,
  snippet: null,
};

/**
 * Collapses runs of whitespace and cuts to the snippet length.
 *
 * Normalizing before testing for empty is what makes a whitespace-only body null rather
 * than a string of spaces: such a body parses to non-empty text, so the order matters.
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
    return storable(htmlToText(html, { wordwrap: false }));
  }
  return null;
}

/**
 * Parses one raw MIME document.
 *
 * Never throws, and the try/catch is what makes that true rather than any promise from
 * the libraries: simpleParser rejects input that is not a document at all, and htmlToText
 * reads sender-controlled markup. Both have to converge on null bodies, because the
 * alternative is one unreadable message costing its whole mailbox the headers already
 * read.
 */
export async function parseMessageBody(source: Buffer): Promise<ParsedMessageBody> {
  try {
    const parsed = await simpleParser(source);
    // Inside the try, not after it: htmlToText recurses over sender-controlled markup and
    // overflows the stack on deep nesting, which a 220 KB document already reaches.
    const bodyText = bodyTextOf(parsed.text, parsed.html);
    return {
      bodyText,
      // `html` is false, not undefined, when a message has no HTML part.
      bodyHtml:
        typeof parsed.html === 'string' && parsed.html !== '' ? storable(parsed.html) : null,
      snippet: snippetOf(bodyText),
    };
  } catch {
    return EMPTY_MESSAGE_BODY;
  }
}
