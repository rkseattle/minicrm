/**
 * MIME parsing tests over fixture documents.
 *
 * The fixtures are raw MIME rather than a mocked parser: every rule worth testing here —
 * which part becomes the body, how a charset is decoded, what a malformed document
 * produces — is decided by the parser reading real bytes, so a mock would test the mock.
 */

import { describe, it, expect } from 'vitest';

import { EMPTY_MESSAGE_BODY, parseMessageBody, snippetOf } from '../services/mail/messageBody.js';

/** Builds a document from raw header and body text, with the CRLF line endings MIME uses. */
function mime(...lines: string[]): Buffer {
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

describe('parseMessageBody — body selection', () => {
  it('reads a plain-text-only message', async () => {
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Subject: Plain',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Hello plain world.',
        '',
      ),
    );

    expect(body.bodyText?.trim()).toBe('Hello plain world.');
    expect(body.bodyHtml).toBeNull();
    expect(body.snippet).toBe('Hello plain world.');
  });

  it('prefers the text part of a multipart/alternative message', async () => {
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: multipart/alternative; boundary="B"',
        '',
        '--B',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'the plain part',
        '--B',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>the html part</p>',
        '--B--',
        '',
      ),
    );

    expect(body.bodyText?.trim()).toBe('the plain part');
    expect(body.bodyHtml).toContain('the html part');
    expect(body.snippet).toBe('the plain part');
  });

  it('converts HTML to text for a single-part HTML message', async () => {
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>Alpha</p><p>Beta &amp; gamma</p>',
        '',
      ),
    );

    expect(body.bodyText).toContain('Alpha');
    expect(body.bodyText).toContain('Beta & gamma');
    expect(body.snippet).toBe('Alpha Beta & gamma');
  });

  it('converts HTML to text for a multipart-wrapped HTML message', async () => {
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>Alpha</p><p>Beta &amp; gamma</p>',
        '--B--',
        '',
      ),
    );

    // mailparser derives `text` itself only for the single-part shape above, so without
    // the explicit conversion this message would store no body at all.
    expect(body.bodyText).toContain('Alpha');
    expect(body.snippet).toBe('Alpha Beta & gamma');
  });

  it('stores no body when HTML converts to nothing but whitespace', async () => {
    // A signature-only reply or a tracking pixel converts to a few newlines. Storing that
    // puts text in the column with no snippet beside it, and the upsert's COALESCE would
    // then never replace it with a real body.
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>&nbsp;</p><br><br>',
        '',
      ),
    );

    expect(body.bodyText).toBeNull();
    expect(body.snippet).toBeNull();
  });

  it('stores no body when HTML converts to an empty string', async () => {
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<div> </div>',
        '',
      ),
    );

    expect(body.bodyText).toBeNull();
    expect(body.snippet).toBeNull();
  });

  it('stores no body for a message carrying neither a text nor an HTML part', async () => {
    const body = await parseMessageBody(
      mime('From: sender@example.com', 'Subject: Headers only', '', ''),
    );

    expect(body).toEqual(EMPTY_MESSAGE_BODY);
  });
});

describe('parseMessageBody — transfer encodings and charsets', () => {
  it('decodes a non-UTF-8 charset', async () => {
    const body = await parseMessageBody(
      Buffer.concat([
        Buffer.from(
          ['From: sender@example.com', 'Content-Type: text/plain; charset=iso-8859-1', '', ''].join(
            '\r\n',
          ),
          'ascii',
        ),
        // "Café naïve" in ISO-8859-1, which is not valid UTF-8.
        Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x6e, 0x61, 0xef, 0x76, 0x65]),
      ]),
    );

    expect(body.bodyText?.trim()).toBe('Café naïve');
  });

  it('decodes quoted-printable, including a soft line break', async () => {
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'Caf=C3=A9 =3D sign and a line that so=',
        'ft wraps here.',
        '',
      ),
    );

    expect(body.bodyText?.trim()).toBe('Café = sign and a line that soft wraps here.');
  });

  it('decodes base64', async () => {
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('Base64 decoded body ✓', 'utf8').toString('base64'),
        '',
      ),
    );

    expect(body.bodyText?.trim()).toBe('Base64 decoded body ✓');
  });
});

describe('parseMessageBody — structures a part-selector would get wrong', () => {
  it('does not take a text/plain attachment as the body', async () => {
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>the real body</p>',
        '--B',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Disposition: attachment; filename="notes.txt"',
        '',
        'attachment contents',
        '--B--',
        '',
      ),
    );

    expect(body.bodyText).toContain('the real body');
    expect(body.bodyText).not.toContain('attachment contents');
  });

  it('does not take a forwarded message as the body', async () => {
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'my own text',
        '--B',
        'Content-Type: message/rfc822',
        '',
        'From: inner@example.com',
        'Content-Type: text/plain',
        '',
        'the forwarded text',
        '--B--',
        '',
      ),
    );

    expect(body.bodyText?.trim()).toBe('my own text');
    expect(body.bodyText).not.toContain('the forwarded text');
  });

  it('reads an alternative nested inside a mixed container', async () => {
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: multipart/mixed; boundary="A"',
        '',
        '--A',
        'Content-Type: multipart/alternative; boundary="B"',
        '',
        '--B',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'nested plain',
        '--B',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>nested html</p>',
        '--B--',
        '--A--',
        '',
      ),
    );

    expect(body.bodyText?.trim()).toBe('nested plain');
    expect(body.bodyHtml).toContain('nested html');
  });
});

describe('parseMessageBody — malformed input', () => {
  it('reports lost text for a document of raw bytes', async () => {
    // simpleParser does not reject these: it returns no text and no HTML, so the outcome
    // is all the caller gets — which is why it is reported rather than thrown.
    const body = await parseMessageBody(Buffer.from([0x00, 0xff, 0xfe, 0x42, 0x00, 0x99]));

    expect(body.lostText).toBe(true);
  });

  it('stores no body for a document of raw bytes', async () => {
    const body = await parseMessageBody(Buffer.from([0x00, 0xff, 0xfe, 0x42, 0x00, 0x99]));

    expect(body).toEqual(EMPTY_MESSAGE_BODY);
  });

  it('reports lost text when the parser rejects the input outright', async () => {
    // The failure has to be logged where it is caught: parseMessageBody never throws, so
    // a caller cannot log it, and a silently-null body is indistinguishable from a
    // message that carried none.
    const notADocument = 42 as unknown as Buffer;

    const body = await parseMessageBody(notADocument);

    expect(body.lostText).toBe(true);
  });

  it('stores no body when the HTML converter overflows on deep nesting', async () => {
    // simpleParser succeeds here and yields no text, so the conversion runs and throws a
    // RangeError. A 220 KB document reaches this, well inside the fetch cap, so the try
    // has to cover the conversion and not just the parse — and the HTML the parser had
    // already returned is kept, since only the text derivation failed.
    const depth = 20000;
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<div>'.repeat(depth) + 'deep' + '</div>'.repeat(depth),
        '--B--',
        '',
      ),
    );

    expect(body.bodyText).toBeNull();
    expect(body.snippet).toBeNull();
    expect(body.bodyHtml).toContain('<div>');
    // The HTML survived but the text did not, and a null text column is the loss the
    // caller reports — keeping the HTML must not make it look like nothing was lost.
    expect(body.lostText).toBe(true);
  });

  it('drops a NUL byte, which a text column cannot store', async () => {
    const nul = String.fromCharCode(0);
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: text/plain; charset=utf-8',
        '',
        `before${nul}after`,
        '',
      ),
    );

    // Postgres rejects NUL with SQLSTATE 22021, which is unmapped and would fail the
    // whole page rather than the one message.
    expect(body.bodyText).not.toContain(nul);
    expect(body.bodyText?.trim()).toBe('beforeafter');
  });

  it('still reads the body of a message whose boundary is never closed', async () => {
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'body with no closing boundary',
      ),
    );

    expect(body.bodyText?.trim()).toBe('body with no closing boundary');
  });
});

describe('snippetOf', () => {
  it('collapses runs of whitespace', () => {
    expect(snippetOf('Line one.\n\n\nLine   two\twith\ttabs.\n   Indented.')).toBe(
      'Line one. Line two with tabs. Indented.',
    );
  });

  it('cuts to 200 characters', () => {
    const snippet = snippetOf('x'.repeat(250));

    expect(snippet).toHaveLength(200);
  });

  it('keeps a body of exactly 200 characters whole', () => {
    const snippet = snippetOf('y'.repeat(200));

    expect(snippet).toHaveLength(200);
  });

  it('does not cut an astral character in half at the boundary', () => {
    // The emoji straddles index 199, so a plain slice would keep a lone high surrogate
    // and the column would receive a replacement character.
    const snippet = snippetOf('z'.repeat(199) + String.fromCodePoint(0x1f600) + 'tail');

    expect(snippet).toHaveLength(199);
    expect(snippet?.endsWith('z')).toBe(true);
  });

  it('is null for a body that is only whitespace', () => {
    // Such a body parses to a non-empty string, so the emptiness test has to come after
    // the collapse rather than before it.
    expect(snippetOf('   \n\t\n   ')).toBeNull();
  });

  it('is null when there is no body', () => {
    expect(snippetOf(null)).toBeNull();
  });
});

describe('the stored body bound', () => {
  it('cuts an over-long body without splitting an astral character', async () => {
    // The emoji straddles the 65536-character bound, so a plain slice would leave a lone
    // high surrogate and the column would receive a replacement character.
    const body = await parseMessageBody(
      mime(
        'From: sender@example.com',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'a'.repeat(65_535) + String.fromCodePoint(0x1f600) + 'tail',
        '',
      ),
    );

    expect(body.bodyText).toHaveLength(65_535);
    expect(body.bodyText?.endsWith('a')).toBe(true);
  });
});
