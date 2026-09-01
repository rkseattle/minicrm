/**
 * RFC 5322 thread resolution. Pure logic, no database and no provider.
 *
 * The rule matters because every reply in a chain must land on the same thread id no
 * matter which message arrives first, and clients disagree about which headers they send.
 */

import { extractHeaderField, resolveThreadId } from '../services/mail/threading.js';

describe('resolveThreadId', () => {
  it('threads on the first entry of References, which is the conversation root', () => {
    expect(
      resolveThreadId({
        messageId: '<reply-3@example.com>',
        inReplyTo: '<reply-2@example.com>',
        references: '<root@example.com> <reply-1@example.com> <reply-2@example.com>',
      }),
    ).toBe('root@example.com');
  });

  it('gives every message in a chain the same thread id regardless of arrival order', () => {
    const root = resolveThreadId({ messageId: '<root@example.com>' });
    const reply = resolveThreadId({
      messageId: '<reply-1@example.com>',
      inReplyTo: '<root@example.com>',
      references: '<root@example.com>',
    });
    const later = resolveThreadId({
      messageId: '<reply-2@example.com>',
      inReplyTo: '<reply-1@example.com>',
      references: '<root@example.com> <reply-1@example.com>',
    });

    expect(reply).toBe(root);
    expect(later).toBe(root);
  });

  it('falls back to In-Reply-To when the client sent no References', () => {
    expect(
      resolveThreadId({
        messageId: '<reply@example.com>',
        inReplyTo: '<root@example.com>',
      }),
    ).toBe('root@example.com');
  });

  it('falls back to the message own id when it starts a conversation', () => {
    expect(resolveThreadId({ messageId: '<root@example.com>' })).toBe('root@example.com');
  });

  it('accepts ids that arrive without angle brackets', () => {
    expect(resolveThreadId({ messageId: 'root@example.com' })).toBe('root@example.com');
    expect(resolveThreadId({ inReplyTo: 'root@example.com' })).toBe('root@example.com');
  });

  it('reads a References header folded across lines', () => {
    expect(
      resolveThreadId({
        messageId: '<reply@example.com>',
        references: '<root@example.com>\r\n\t<reply-1@example.com>',
      }),
    ).toBe('root@example.com');
  });

  it('skips a malformed References and uses the next usable header', () => {
    expect(
      resolveThreadId({
        messageId: '<reply@example.com>',
        inReplyTo: '<root@example.com>',
        references: 'not-a-message-id-at-all',
      }),
    ).toBe('root@example.com');
  });

  it('ignores an empty or whitespace-only header', () => {
    expect(
      resolveThreadId({
        messageId: '<root@example.com>',
        inReplyTo: '   ',
        references: '',
      }),
    ).toBe('root@example.com');
  });

  it('ignores empty angle brackets, which some clients emit for a missing id', () => {
    expect(
      resolveThreadId({
        messageId: '<root@example.com>',
        references: '<>',
      }),
    ).toBe('root@example.com');
  });

  it('returns null when the message carries none of the three headers', () => {
    expect(resolveThreadId({})).toBeNull();
    expect(resolveThreadId({ messageId: null, inReplyTo: null, references: null })).toBeNull();
  });
});

describe('malformed message ids', () => {
  it('threads an unclosed id with its well-formed spelling', () => {
    // A client that drops the closing bracket must not split one conversation in two.
    expect(resolveThreadId({ messageId: '<a@example.net' })).toBe('a@example.net');
    expect(resolveThreadId({ messageId: '<a@example.net>' })).toBe('a@example.net');
  });

  it('threads an id missing its opening bracket the same way', () => {
    expect(resolveThreadId({ messageId: 'a@example.net>' })).toBe('a@example.net');
  });

  it('still rejects an id that is nothing but brackets', () => {
    expect(resolveThreadId({ messageId: '<>' })).toBeNull();
    expect(resolveThreadId({ messageId: '<<>>' })).toBeNull();
  });
});

describe('extractHeaderField', () => {
  const BLOCK =
    'Return-Path: <bounce@mailer.example.net>\r\n' +
    'References: <root@example.net> <mid@example.net>\r\n' +
    'Subject: hello\r\n';

  it('returns the named field, not the first one in the block', () => {
    expect(extractHeaderField(BLOCK, 'references')).toBe('<root@example.net> <mid@example.net>');
  });

  it('matches the field name case-insensitively, as RFC 5322 requires', () => {
    expect(extractHeaderField(BLOCK, 'REFERENCES')).toBe('<root@example.net> <mid@example.net>');
  });

  it('joins a value folded across continuation lines', () => {
    const folded = 'References: <root@example.net>\r\n\t<mid@example.net>\r\n';
    expect(extractHeaderField(folded, 'references')).toBe('<root@example.net> <mid@example.net>');
  });

  it('does not run one field value into the next', () => {
    expect(extractHeaderField(BLOCK, 'return-path')).toBe('<bounce@mailer.example.net>');
  });

  it('takes the first occurrence when a field is repeated, not a merge of both', () => {
    // A repeated References is malformed but real. Reading past the first one would
    // concatenate two conversations' ids into a single value.
    const repeated =
      'References: <first@example.net>\r\n' +
      'Subject: hello\r\n' +
      'References: <second@example.net>\r\n';
    expect(extractHeaderField(repeated, 'references')).toBe('<first@example.net>');
  });

  it('returns null when the block does not carry the field', () => {
    expect(extractHeaderField(BLOCK, 'in-reply-to')).toBeNull();
  });

  it('returns null for a field present but empty', () => {
    expect(extractHeaderField('References:\r\n', 'references')).toBeNull();
  });

  it('does not match a field name appearing inside another value', () => {
    const tricky = 'Subject: about References: nothing\r\n';
    expect(extractHeaderField(tricky, 'references')).toBeNull();
  });
});

describe('RFC 5322 comments in a References header', () => {
  it('does not thread on an address hidden inside a comment', () => {
    // A comment is legal between ids and may contain a bracketed address. Taking it as
    // the root would thread unrelated conversations together.
    expect(resolveThreadId({ references: '(comment <fake@evil.net>) <root@example.net>' })).toBe(
      'root@example.net',
    );
  });

  it('handles a nested comment, which no regex can match', () => {
    expect(
      resolveThreadId({ references: '(outer (inner <fake@evil.net>)) <root@example.net>' }),
    ).toBe('root@example.net');
  });

  it('keeps an id when a comment follows it', () => {
    expect(resolveThreadId({ references: '<root@example.net> (trailing note)' })).toBe(
      'root@example.net',
    );
  });
});
