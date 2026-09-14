/**
 * Outbound MIME construction and thread resolution.
 *
 * The threading assertions are the point of this suite: a reply that does not carry
 * In-Reply-To lands outside the recipient's conversation, and one stored under the wrong
 * thread_id splits a conversation in our own timeline. Neither failure is visible without
 * reading the headers a provider actually receives, so these parse the built document
 * rather than trusting the builder's return value alone.
 */

import { describe, expect, it } from 'vitest';
import { simpleParser } from 'mailparser';

import {
  buildOutboundDocument,
  type OutboundMessage,
  type ParentMessage,
} from '../services/mail/outboundMessage.js';

const BASE_MESSAGE: OutboundMessage = {
  fromAddress: 'rep@example.com',
  toAddresses: ['contact@example.com'],
  ccAddresses: [],
  subject: 'Quarterly review',
  bodyHtml: '<p>Attached.</p>',
};

/** Reads the headers a recipient's client would actually see. */
async function headersOf(mime: Buffer): Promise<Record<string, string>> {
  const parsed = await simpleParser(mime);
  const headers: Record<string, string> = {};
  for (const [key, value] of parsed.headers) {
    headers[key] = Array.isArray(value) ? value.join(' ') : String(value);
  }
  return headers;
}

describe('buildOutboundDocument', () => {
  it('builds a document carrying the addresses and subject it was given', async () => {
    const document = await buildOutboundDocument(BASE_MESSAGE, null);
    const parsed = await simpleParser(document.mime);

    expect(parsed.subject).toBe('Quarterly review');
    expect(parsed.from?.text).toContain('rep@example.com');
    expect(parsed.html).toContain('Attached.');
  });

  it('generates a Message-ID and reports it bare, not bracketed', async () => {
    const document = await buildOutboundDocument(BASE_MESSAGE, null);

    expect(document.rfcMessageId).not.toMatch(/^</);
    expect(document.rfcMessageId).not.toMatch(/>$/);
    expect(document.rfcMessageId).toContain('@');

    // The document itself must carry the bracketed form RFC 5322 requires.
    const headers = await headersOf(document.mime);
    expect(headers['message-id']).toBe(`<${document.rfcMessageId}>`);
  });

  it('threads a message with no parent on its own Message-ID', async () => {
    const document = await buildOutboundDocument(BASE_MESSAGE, null);

    expect(document.threadId).toBe(document.rfcMessageId);
  });

  it('sets In-Reply-To and References so a reply joins the recipient thread', async () => {
    const parent: ParentMessage = {
      threadId: 'root-abc@example.net',
      rfcMessageId: 'parent-123@example.net',
      references: null,
    };

    const document = await buildOutboundDocument(BASE_MESSAGE, parent);
    const headers = await headersOf(document.mime);

    expect(headers['in-reply-to']).toBe('<parent-123@example.net>');
    expect(headers['references']).toContain('<parent-123@example.net>');
  });

  it('stores a reply under its parent thread, not a newly derived one', async () => {
    const parent: ParentMessage = {
      threadId: 'root-abc@example.net',
      rfcMessageId: 'parent-123@example.net',
      references: null,
    };

    const document = await buildOutboundDocument(BASE_MESSAGE, parent);

    // The parent's stored thread wins over anything derivable from the new headers: the
    // parent already threaded through resolveThreadId on ingest, and re-deriving here
    // would split the conversation whenever it threaded on something other than its own id.
    expect(document.threadId).toBe('root-abc@example.net');
    expect(document.threadId).not.toBe(document.rfcMessageId);
  });

  it('extends the parent References chain rather than restarting it', async () => {
    // A three-deep chain: root R, then P1, then the parent P2 we are replying to.
    const parent: ParentMessage = {
      threadId: 'root-R@example.net',
      rfcMessageId: 'parent-P2@example.net',
      references: '<root-R@example.net> <mid-P1@example.net>',
    };

    const document = await buildOutboundDocument(BASE_MESSAGE, parent);
    const headers = await headersOf(document.mime);
    const ids = headers['references']?.match(/<[^<>]+>/g) ?? [];

    expect(ids).toEqual([
      '<root-R@example.net>',
      '<mid-P1@example.net>',
      '<parent-P2@example.net>',
    ]);
  });

  /**
   * Only ids that name a real message may reach the wire, whatever shape the parent takes.
   *
   * `thread_id` is a storage key: `boundIndexedId` may reduce it to a `sha256:` digest,
   * which names no message any party has seen. The recipient's client threads on these ids
   * alone, so a synthetic entry splits the reply from the conversation it answers.
   */
  it.each([
    ['a parent with no References chain', null, 'root-abc@example.net'],
    ['a parent with a chain', '<root-R@example.net> <mid-P1@example.net>', 'root-R@example.net'],
    [
      'a parent whose chain already names itself',
      '<root-R@example.net> <parent-P2@example.net>',
      'root-R@example.net',
    ],
    [
      'a thread id long enough to be digested',
      '<realroot@example.net> <mid@example.net>',
      `${'a'.repeat(600)}@example.net`,
    ],
  ])('emits only real message ids: %s', async (_case, references, threadId) => {
    const document = await buildOutboundDocument(BASE_MESSAGE, {
      threadId,
      rfcMessageId: 'parent-P2@example.net',
      references,
    });

    const headers = await headersOf(document.mime);
    const ids = headers['references']?.match(/<[^<>]+>/g) ?? [];

    for (const id of ids) {
      expect(id).not.toContain('sha256:');
      expect(id).toContain('@');
    }
    // The parent is always the last entry, per RFC 5322 §3.6.4.
    expect(ids.at(-1)).toBe('<parent-P2@example.net>');
  });

  it('carries the parent inherited chain ahead of the parent itself', async () => {
    const document = await buildOutboundDocument(BASE_MESSAGE, {
      threadId: `${'a'.repeat(600)}@example.net`,
      rfcMessageId: 'parent-P2@example.net',
      references: '<realroot@example.net> <mid@example.net>',
    });

    const headers = await headersOf(document.mime);
    const ids = headers['references']?.match(/<[^<>]+>/g) ?? [];

    // Ancestry in order, and the digested storage key nowhere in it.
    expect(ids).toEqual(['<realroot@example.net>', '<mid@example.net>', '<parent-P2@example.net>']);
  });

  it('keeps the inherited chain when the parent has no stored Message-ID', async () => {
    const document = await buildOutboundDocument(BASE_MESSAGE, {
      threadId: 'root-abc@example.net',
      rfcMessageId: null,
      references: '<root-abc@example.net> <mid@example.net>',
    });

    const headers = await headersOf(document.mime);
    const ids = headers['references']?.match(/<[^<>]+>/g) ?? [];

    // The chain alone still threads the reply on the recipient's side; dropping it because
    // the parent's own id was never stored would leave the reply conversationless there.
    expect(ids).toEqual(['<root-abc@example.net>', '<mid@example.net>']);
    expect(headers['in-reply-to']).toBeUndefined();
  });

  it('does not take a bracketed address inside a comment as a message id', async () => {
    const document = await buildOutboundDocument(BASE_MESSAGE, {
      threadId: 'root-R@example.net',
      rfcMessageId: 'parent-P2@example.net',
      references: '(see <evil@attacker.net>) <root-R@example.net>',
    });

    const headers = await headersOf(document.mime);
    const ids = headers['references']?.match(/<[^<>]+>/g) ?? [];

    // RFC 5322 permits comments between ids, and one may contain a bracketed address.
    // Taking it would thread the reply onto a conversation the sender chose.
    expect(ids).not.toContain('<evil@attacker.net>');
    expect(ids[0]).toBe('<root-R@example.net>');
  });

  it('does not list the parent twice when its own chain already names it', async () => {
    const parent: ParentMessage = {
      threadId: 'root-R@example.net',
      rfcMessageId: 'parent-P2@example.net',
      references: '<root-R@example.net> <parent-P2@example.net>',
    };

    const document = await buildOutboundDocument(BASE_MESSAGE, parent);
    const headers = await headersOf(document.mime);
    const ids = headers['references']?.match(/<[^<>]+>/g) ?? [];

    expect(ids).toEqual(['<root-R@example.net>', '<parent-P2@example.net>']);
  });

  it('uses an injected message-id generator when one is given', async () => {
    const document = await buildOutboundDocument(BASE_MESSAGE, null, () => 'pinned-id@example.com');

    const headers = await headersOf(document.mime);
    expect(document.rfcMessageId).toBe('pinned-id@example.com');
    expect(headers['message-id']).toBe('<pinned-id@example.com>');
  });

  it('generates an id in the sender own domain, not the running host', async () => {
    const document = await buildOutboundDocument(
      { ...BASE_MESSAGE, fromAddress: 'rep@acme.example' },
      null,
    );

    // RFC 5322 §3.6.4 wants a domain the sender controls; taking the process hostname
    // would leak an internal name to every recipient.
    expect(document.rfcMessageId.split('@')[1]).toBe('acme.example');
  });

  it('refuses a message with no recipient at all', async () => {
    await expect(
      buildOutboundDocument({ ...BASE_MESSAGE, toAddresses: [], ccAddresses: [] }, null),
    ).rejects.toMatchObject({ code: 'NO_RECIPIENT' });
  });

  it('accepts a message addressed only by cc', async () => {
    const document = await buildOutboundDocument(
      { ...BASE_MESSAGE, toAddresses: [], ccAddresses: ['manager@example.com'] },
      null,
    );

    const parsed = await simpleParser(document.mime);
    const cc = Array.isArray(parsed.cc) ? parsed.cc[0] : parsed.cc;
    expect(cc?.text).toContain('manager@example.com');
  });

  it('bounds an overlong subject rather than putting it all in a header', async () => {
    const document = await buildOutboundDocument(
      { ...BASE_MESSAGE, subject: 'A'.repeat(5000) },
      null,
    );

    const parsed = await simpleParser(document.mime);
    // The same bound every other writer into email_messages.subject applies.
    expect(parsed.subject?.length).toBeLessThanOrEqual(998);
  });

  it('normalizes a parent id that arrives already bracketed', async () => {
    const parent: ParentMessage = {
      threadId: 'root-abc@example.net',
      rfcMessageId: '<parent-123@example.net>',
      references: null,
    };

    const document = await buildOutboundDocument(BASE_MESSAGE, parent);
    const headers = await headersOf(document.mime);

    // Doubling the brackets would make the reference unparseable, so the reply would
    // thread nowhere in the recipient's client.
    expect(headers['in-reply-to']).toBe('<parent-123@example.net>');
  });

  it('still joins the parent thread when the parent carries no stored Message-ID', async () => {
    const parent: ParentMessage = {
      threadId: 'root-abc@example.net',
      rfcMessageId: null,
      references: null,
    };

    const document = await buildOutboundDocument(BASE_MESSAGE, parent);
    const headers = await headersOf(document.mime);

    expect(document.threadId).toBe('root-abc@example.net');
    expect(headers['in-reply-to']).toBeUndefined();
  });

  it('bounds a parent thread id that would overflow the btree index', async () => {
    const parent: ParentMessage = {
      threadId: `${'a'.repeat(600)}@example.net`,
      rfcMessageId: 'parent-123@example.net',
      references: null,
    };

    const document = await buildOutboundDocument(BASE_MESSAGE, parent);

    expect(document.threadId).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('keeps two long thread ids distinct once digested', async () => {
    const first = await buildOutboundDocument(BASE_MESSAGE, {
      threadId: `${'a'.repeat(600)}-one@example.net`,
      rfcMessageId: 'p1@example.net',
      references: null,
    });
    const second = await buildOutboundDocument(BASE_MESSAGE, {
      threadId: `${'a'.repeat(600)}-two@example.net`,
      rfcMessageId: 'p2@example.net',
      references: null,
    });

    // A truncating bound would collapse these onto one key, and the ingest's ON CONFLICT
    // would then overwrite one conversation with the other.
    expect(first.threadId).not.toBe(second.threadId);
  });

  it('encodes a non-ASCII subject rather than putting raw bytes in a header', async () => {
    const document = await buildOutboundDocument(
      { ...BASE_MESSAGE, subject: 'Réunion trimestrielle — 日本' },
      null,
    );

    const raw = document.mime.toString('utf8');
    const headerBlock = raw.slice(0, raw.indexOf('\r\n\r\n'));
    expect(headerBlock).toMatch(/Subject: =\?/);

    const parsed = await simpleParser(document.mime);
    expect(parsed.subject).toBe('Réunion trimestrielle — 日本');
  });

  it('carries cc recipients', async () => {
    const document = await buildOutboundDocument(
      { ...BASE_MESSAGE, ccAddresses: ['manager@example.com'] },
      null,
    );

    const parsed = await simpleParser(document.mime);
    const cc = Array.isArray(parsed.cc) ? parsed.cc[0] : parsed.cc;
    expect(cc?.text).toContain('manager@example.com');
  });

  it('strips NUL from a subject, which a text column cannot hold', async () => {
    // Escapes, not literal control bytes: a raw NUL in source survives no reformatting or
    // copy-paste reliably, and if it were lost this assertion would read
    // `not.toContain('')` — trivially false, or trivially true, but never the rule.
    const document = await buildOutboundDocument(
      { ...BASE_MESSAGE, subject: 'Quarterly  review' },
      null,
    );

    const parsed = await simpleParser(document.mime);
    expect(parsed.subject).not.toContain(' ');
    expect(parsed.subject).toBe('Quarterly review');
  });

  it('neutralizes a CRLF injection attempt through the from address', async () => {
    const document = await buildOutboundDocument(
      { ...BASE_MESSAGE, fromAddress: 'rep@example.com\r\nBcc: evil@attacker.net' },
      null,
    );

    const raw = document.mime.toString('utf8');
    const headerBlock = raw.slice(0, raw.indexOf('\r\n\r\n'));

    // The builder delegates encoding to MailComposer, so this pins the behavior rather
    // than the implementation: a dependency bump that stopped folding the injected CRLF
    // would smuggle a Bcc header past every caller, invisibly.
    expect(headerBlock).not.toMatch(/^Bcc:/im);
  });
});
