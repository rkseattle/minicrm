/**
 * Unit tests for apps/minicrm/mail-fakes.ts's rfc822Message builder, which every emulator
 * seed in the email sync specs is built with. No server involved.
 */

import { test, expect } from '@framework/fixtures';
import { rfc822Message } from '@apps/minicrm/mail-fakes';

const BASE = { from: 'a@x.test', to: 'b@y.test', subject: 'Hello', text: 'Body line' };

async function split(mail: Parameters<typeof rfc822Message>[0]) {
  const raw = await rfc822Message(mail);
  const separator = raw.indexOf('\r\n\r\n');
  return { headers: raw.slice(0, separator), body: raw.slice(separator + 4) };
}

test.describe('rfc822Message', () => {
  test('writes the addresses, subject and body, separated by one CRLF blank line', async () => {
    const { headers, body } = await split(BASE);

    expect(headers).toMatch(/^From: a@x\.test$/m);
    expect(headers).toMatch(/^To: b@y\.test$/m);
    expect(headers).toMatch(/^Subject: Hello$/m);
    expect(body.trim()).toBe('Body line');
  });

  test('mints a fresh angle-bracketed Message-ID when none is given, and keeps a given one', async () => {
    const first = (await split(BASE)).headers.match(/^Message-ID: (.+)$/m)?.[1];
    const second = (await split(BASE)).headers.match(/^Message-ID: (.+)$/m)?.[1];
    const given = (await split({ ...BASE, messageId: '<given@x.test>' })).headers;

    expect(first).toMatch(/^<[^<>\s]+@[^<>\s]+>$/);
    expect(second).not.toBe(first);
    expect(given).toMatch(/^Message-ID: <given@x\.test>$/m);
  });

  test('adds In-Reply-To and References only for a reply', async () => {
    const original = (await split(BASE)).headers;
    const reply = (await split({ ...BASE, inReplyTo: '<parent@x.test>' })).headers;

    expect(original).not.toMatch(/^(In-Reply-To|References):/m);
    expect(reply).toMatch(/^In-Reply-To: <parent@x\.test>$/m);
    expect(reply).toMatch(/^References: <parent@x\.test>$/m);
  });

  test('encodes a non-ASCII subject, and cannot be made to inject a header', async () => {
    const encoded = (await split({ ...BASE, subject: 'Résumé 履歴書' })).headers;
    const hostile = (await split({ ...BASE, subject: 'Hi\r\nBcc: victim@x.test' })).headers;

    expect(encoded).toMatch(/^Subject: =\?UTF-8\?/m);
    expect(hostile).not.toMatch(/^Bcc:/m);
  });
});
