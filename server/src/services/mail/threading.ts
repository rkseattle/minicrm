/**
 * Thread identity for providers that do not supply one.
 *
 * IMAP has no native thread id, so a conversation is reconstructed from the RFC 5322
 * headers each reply carries. Gmail and Graph do supply one, and their providers pass it
 * through — this is the fallback, not the general rule.
 */

/**
 * Pulls one field's value out of a raw header block.
 *
 * A FETCH of `HEADER.FIELDS (REFERENCES)` returns a block — field name, colon, value,
 * CRLF — not a bare value, and a server may return more fields than were asked for.
 * Without this, the first bracketed token in the block wins: a `Return-Path:
 * <bounce-…@mailer>` line ahead of References would become the conversation's identity,
 * collapsing unrelated threads onto one bounce address.
 *
 * RFC 5322 §2.2.3 folds long values onto continuation lines, which begin with whitespace,
 * so those are joined back on.
 *
 * @returns the field's value, or null when the block does not carry that field.
 */
export function extractHeaderField(block: string, fieldName: string): string | null {
  const lines = block.split(/\r?\n/);
  const wanted = fieldName.toLowerCase();
  const collected: string[] = [];
  let inField = false;

  for (const line of lines) {
    const isContinuation = /^[ \t]/.test(line);
    if (inField && isContinuation) {
      collected.push(line.trim());
      continue;
    }
    if (inField) break;

    const separator = line.indexOf(':');
    if (separator === -1) continue;
    if (line.slice(0, separator).trim().toLowerCase() !== wanted) continue;

    collected.push(line.slice(separator + 1).trim());
    inField = true;
  }

  if (collected.length === 0) return null;
  const value = collected.join(' ').trim();
  return value === '' ? null : value;
}

/** The RFC 5322 headers that place a message in a conversation. */
export interface ThreadingHeaders {
  messageId?: string | null;
  inReplyTo?: string | null;
  /** Raw `References` header value: message ids, whitespace-separated. */
  references?: string | null;
}

/**
 * Pulls message ids out of a header value.
 *
 * RFC 5322 folds long headers across lines and permits comments between ids, so this
 * takes the angle-bracketed tokens rather than splitting on whitespace.
 */
function extractMessageIds(headerValue: string): string[] {
  return headerValue.match(/<[^<>]+>/g) ?? [];
}

/**
 * Trims one id and strips its angle brackets.
 *
 * Brackets are stripped independently rather than as a matched pair, which matters on the
 * `In-Reply-To` and `Message-ID` paths: those fall back to the raw value when it carries
 * no matched pair, so `<a@b` would otherwise thread apart from the same id written
 * correctly. Case is preserved — the local part of a message id is case-sensitive, and two
 * spellings really are two conversations.
 */
function normalizeMessageId(raw: string): string | null {
  const normalized = raw.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
  return normalized === '' ? null : normalized;
}

/**
 * Resolves the thread a message belongs to.
 *
 * The first entry of `References` is the conversation's root, which is what makes every
 * reply in a chain agree on one id no matter where in the chain it arrives. `In-Reply-To`
 * is the fallback for clients that omit `References`, and a message that is itself a root
 * threads on its own `Message-ID`.
 *
 * @returns the thread id, or null when the message carries none of the three headers —
 *   the caller decides what identity to give a message that cannot be threaded.
 */
export function resolveThreadId(headers: ThreadingHeaders): string | null {
  if (headers.references) {
    const [root] = extractMessageIds(headers.references);
    const normalized = root ? normalizeMessageId(root) : null;
    if (normalized) return normalized;
  }

  if (headers.inReplyTo) {
    // imapflow's envelope hands this back unbracketed; a raw header keeps its brackets.
    const [bracketed] = extractMessageIds(headers.inReplyTo);
    const normalized = normalizeMessageId(bracketed ?? headers.inReplyTo);
    if (normalized) return normalized;
  }

  if (headers.messageId) {
    const [bracketed] = extractMessageIds(headers.messageId);
    const normalized = normalizeMessageId(bracketed ?? headers.messageId);
    if (normalized) return normalized;
  }

  return null;
}
