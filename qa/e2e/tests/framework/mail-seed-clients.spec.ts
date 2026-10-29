/**
 * Unit tests for the mail seeding clients: MailEmulatorClient against a real emulator on an
 * ephemeral port, and SmtpSeedClient against a minimal SMTP responder that records what it
 * is sent. No test mail server or app is involved.
 */

import { test, expect } from '@framework/fixtures';
import { createServer, type AddressInfo, type Server as NetServer, type Socket } from 'node:net';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createMailProviderEmulator } from '@framework/fakes/mail-provider-emulator';
import { MailEmulatorClient, MailEmulatorError } from '@framework/clients/mail-emulator-client';
import { SmtpSeedClient } from '@framework/clients/smtp-seed-client';

const TOKEN = 'seed-client-token';
const ADDRESS = 'seed@example.test';

function portOf(server: HttpServer | NetServer): number {
  // Safe: a server listening on a TCP port reports an AddressInfo, never a pipe name.
  return (server.address() as AddressInfo).port;
}

test.describe('MailEmulatorClient', () => {
  let emulator: HttpServer;
  let client: MailEmulatorClient;

  test.beforeAll(async () => {
    emulator = createMailProviderEmulator();
    await new Promise<void>((resolve) => emulator.listen(0, resolve));
    client = new MailEmulatorClient(`http://127.0.0.1:${String(portOf(emulator))}/`);
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => emulator.close(() => resolve()));
  });

  test.beforeEach(async () => {
    await client.deleteMailbox(TOKEN);
    await client.registerMailbox({ token: TOKEN, address: ADDRESS });
  });

  test('seeds a message and lists it back with the ids the seed returned', async () => {
    const seeded = await client.seedMessage(TOKEN, {
      raw: 'Subject: hi\r\nMessage-ID: <a@x.test>\r\n\r\nbody',
    });

    const listed = await client.listMessages(TOKEN);

    expect(listed).toEqual([
      expect.objectContaining({ id: seeded.id, threadId: seeded.threadId, folder: 'inbox' }),
    ]);
  });

  test('expires cursors, so a delta link issued before is refused after', async () => {
    const base = `http://127.0.0.1:${String(portOf(emulator))}`;
    const headers = { Authorization: `Bearer ${TOKEN}` };
    // Safe: a JSON object, read only for one link the next lines assert on.
    const before = (await (
      await fetch(`${base}/v1.0/me/mailFolders/inbox/messages/delta`, { headers })
    ).json()) as Record<string, unknown>;

    await client.expireCursors(TOKEN);

    const replay = await fetch(String(before['@odata.deltaLink']), { headers });
    expect(replay.status).toBe(410);
  });

  test('deletes a mailbox, and treats deleting one already gone as done', async () => {
    await client.deleteMailbox(TOKEN);
    await expect(client.deleteMailbox(TOKEN)).resolves.toBeUndefined();
    await expect(client.listMessages(TOKEN)).rejects.toMatchObject({ status: 404 });
  });

  test('raises a MailEmulatorError carrying the status of a refusal', async () => {
    // Safe: deliberately outside the type, to reach the emulator's own validation.
    const refused = client.seedMessage(TOKEN, { raw: 'x', folder: 'archive' as 'inbox' });

    await expect(refused).rejects.toBeInstanceOf(MailEmulatorError);
    await expect(refused).rejects.toMatchObject({ status: 400 });
  });

  test('raises on a re-registration under another address', async () => {
    await expect(
      client.registerMailbox({ token: TOKEN, address: 'other@example.test' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

test.describe('SmtpSeedClient', () => {
  let smtp: NetServer;
  const received: string[] = [];

  /** Speaks just enough SMTP to accept one message per DATA and record it. */
  function respond(socket: Socket): void {
    let inData = false;
    let data = '';
    let buffered = '';
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      let newline = buffered.indexOf('\r\n');
      while (newline !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            received.push(data);
            data = '';
            socket.write('250 queued\r\n');
          } else {
            data += `${line}\r\n`;
          }
        } else if (/^(EHLO|HELO)/i.test(line)) {
          socket.write('250 test\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.end('221 bye\r\n');
        } else {
          socket.write('250 ok\r\n');
        }
        newline = buffered.indexOf('\r\n');
      }
    });
  }

  test.beforeAll(async () => {
    smtp = createServer(respond);
    await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
  });

  test('delivers headers a reply threads on, and returns the Message-ID it used', async () => {
    const client = new SmtpSeedClient(`smtp://127.0.0.1:${String(portOf(smtp))}`);
    try {
      const messageId = await client.deliver({
        from: 'buyer@customer.test',
        to: ADDRESS,
        subject: 'Quote',
        text: 'Can you send a quote?',
        messageId: '<quote@customer.test>',
        inReplyTo: '<earlier@customer.test>',
        references: ['<earlier@customer.test>'],
        date: new Date('2026-01-02T03:04:05Z'),
      });

      expect(messageId).toBe('<quote@customer.test>');
      const sent = received.at(-1) ?? '';
      expect(sent).toMatch(/^Subject: Quote$/m);
      expect(sent).toMatch(/^In-Reply-To: <earlier@customer.test>$/m);
      expect(sent).toMatch(/^References: <earlier@customer.test>$/m);
      expect(sent).toContain('Can you send a quote?');
    } finally {
      client.close();
    }
  });

  test('mints a Message-ID when the caller names none', async () => {
    const client = new SmtpSeedClient(`smtp://127.0.0.1:${String(portOf(smtp))}`);
    try {
      const messageId = await client.deliver({
        from: 'buyer@customer.test',
        to: ADDRESS,
        subject: 'No id',
        text: 'x',
      });

      expect(messageId).toMatch(/^<.+@.+>$/);
    } finally {
      client.close();
    }
  });
});

test.describe('MailEmulatorClient against a misbehaving server', () => {
  let stub: HttpServer;
  let client: MailEmulatorClient;
  let answer: { status: number; body: string } = { status: 200, body: '' };

  test.beforeAll(async () => {
    stub = createHttpServer((_req, res) => {
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(answer.body);
    });
    await new Promise<void>((resolve) => stub.listen(0, resolve));
    client = new MailEmulatorClient(`http://127.0.0.1:${String(portOf(stub))}`);
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  });

  test('refuses a seed answer with no ids, and a list answer with no array', async () => {
    answer = { status: 201, body: '{}' };
    await expect(client.seedMessage(TOKEN, { raw: 'x' })).rejects.toMatchObject({ status: 502 });
    answer = { status: 200, body: '{"messages":"nope"}' };
    await expect(client.listMessages(TOKEN)).rejects.toMatchObject({ status: 502 });
  });

  test('treats an empty success body as no content', async () => {
    answer = { status: 200, body: '' };
    await expect(client.expireCursors(TOKEN)).resolves.toBeUndefined();
  });

  test('rethrows a delete failure other than not-found', async () => {
    answer = { status: 500, body: '{"error":"boom"}' };
    await expect(client.deleteMailbox(TOKEN)).rejects.toMatchObject({ status: 500 });
  });
});
