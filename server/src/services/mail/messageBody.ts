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

/**
 * Parses one raw MIME document.
 *
 * Never throws, and the try/catch is what makes that true rather than any promise from
 * the libraries: simpleParser rejects input that is not a document at all, and htmlToText
 * reads sender-controlled markup. Both have to converge on null bodies, because the
 * alternative is one unreadable message costing its whole mailbox the headers already
 * read.
 *
 * A lost body is reported through `lostText` rather than thrown: a caller cannot catch
 * what never throws, and only the caller knows which message this was.
 */
export async function parseMessageBody(source: Buffer): Promise<ParsedMessageBody> {
  // Held outside the try so a failed text conversion still stores the HTML the parser
  // had already returned: it is the more faithful record of the two.
  let bodyHtml: string | null = null;
  try {
    // Neither output is read, and each costs memory proportional to the document.
    // `skipTextLinks` is deliberately absent: the library returns on `skipTextToHtml`
    // before it is ever consulted, so setting it would be dead configuration.
    const parsed = await simpleParser(source, {
      skipTextToHtml: true,
      skipImageLinks: true,
    });
    // Inside the try, not after it: htmlToText recurses over sender-controlled markup and
    // overflows the stack on deep nesting, which a 220 KB document already reaches.
    // `html` is false, not undefined, when a message has no HTML part.
    bodyHtml = typeof parsed.html === 'string' && parsed.html !== '' ? storable(parsed.html) : null;
    const bodyText = bodyTextOf(parsed.text, parsed.html);

    return {
      bodyText,
      bodyHtml,
      snippet: snippetOf(bodyText),
      lostText: bodyText === null,
    };
  } catch {
    // lostText stays true even when the HTML survived: the text and snippet columns are
    // null either way, and that is what the caller reports.
    return { ...EMPTY_MESSAGE_BODY, bodyHtml };
  }
}
