import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ImapAuthPayload } from '../services/connectedAccountService.js';
import { createImapProvider } from '../services/mail/imapProvider.js';

/**
 * The IMAP provider against a real server.
 *
 * Every other test in this area drives a hand-written `ImapFlow` fake, and that fake is the
 * load-bearing risk: several defects here were invisible because it disagreed with the
 * library rather than because the provider was wrong. GreenMail speaks real IMAP, so what
 * this suite asserts is observed rather than reasoned.
 *
 * A server test rather than an E2E spec: nothing triggers a sync over HTTP, there is no read
 * API for stored messages, and CI never invokes Compose. This calls the provider directly.
 *
 * Skipped when GreenMail is not running, so a developer who did not start the test stack
 * gets a skip rather than a red build.
 */

const IMAP_HOST = process.env.GREENMAIL_HOST ?? '127.0.0.1';
const IMAP_PORT = Number(process.env.GREENMAIL_IMAP_PORT ?? 3143);
const SMTP_PORT = Number(process.env.GREENMAIL_SMTP_PORT ?? 3025);

// The login is the local part, not the address: GreenMail reads
// `rep:secret-pass-12@example.com` as user `rep` in domain `example.com`.
const MAILBOX_LOGIN = 'rep';
const MAILBOX_PASSWORD = 'secret-pass-12';
const MAILBOX_ADDRESS = 'rep@example.com';

const AUTH: ImapAuthPayload = {
  kind: 'imap',
  host: IMAP_HOST,
  port: IMAP_PORT,
  username: MAILBOX_LOGIN,
  password: MAILBOX_PASSWORD,
  secure: false,
};

/** GreenMail is on a private address, which the SSRF guard refuses by design. */
const allowPrivateHost = (): Promise<void> => Promise.resolve();

async function connects(): Promise<boolean> {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: false,
    auth: { user: MAILBOX_LOGIN, pass: MAILBOX_PASSWORD },
    logger: false,
  });
  try {
    await client.connect();
    await client.logout();
    return true;
  } catch {
    return false;
  }
}

/**
 * Waits for the server, because a service container is not always listening the instant
 * the job starts. Returns false rather than throwing so a developer without the test
 * stack gets a skip.
 */
async function greenmailIsUp(attempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await connects()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

// CI declares GreenMail as a service, so a skip there means the service is broken — which
// is exactly the silence this suite exists to remove. Locally an absent stack is ordinary,
// so it skips instead.
const inCi = process.env.CI === 'true';
const reachable = await greenmailIsUp(inCi ? 30 : 1);
if (inCi && !reachable) {
  throw new Error(
    `imapProviderLive: GreenMail is declared as a CI service but nothing answered on ${IMAP_HOST}:${String(IMAP_PORT)}`,
  );
}

describe.skipIf(!reachable)('imapProvider against a real IMAP server', () => {
  beforeAll(async () => {
    const transport = nodemailer.createTransport({
      host: IMAP_HOST,
      port: SMTP_PORT,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    await transport.sendMail({
      from: 'alice@partner.test',
      to: MAILBOX_ADDRESS,
      subject: 'A plain message',
      text: 'Body delivered over a real wire.',
    });
    await transport.sendMail({
      from: 'bob@partner.test',
      to: MAILBOX_ADDRESS,
      subject: 'A message with an attachment',
      text: 'See attached.',
      attachments: [{ filename: 'note.txt', content: 'attached bytes' }],
    });
  });

  afterAll(async () => {
    // Each run delivers its own messages, so the mailbox is emptied rather than left to
    // accumulate across runs and change what a UID assertion means.
    const client = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: false,
      auth: { user: MAILBOX_LOGIN, pass: MAILBOX_PASSWORD },
      logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      await client.messageDelete('1:*', { uid: false });
    } finally {
      lock.release();
      await client.logout();
    }
  });

  const since = new Date(Date.now() - 60 * 60 * 1000);

  it('reads bodies the fake could only assert it had synthesized', async () => {
    const provider = createImapProvider(MAILBOX_ADDRESS, undefined, allowPrivateHost);

    const page = await provider.fetchSince(AUTH, null, since);

    const plain = page.messages.find((message) => message.subject === 'A plain message');
    expect(plain).toBeDefined();
    expect(plain?.bodyText).toContain('Body delivered over a real wire.');
    expect(plain?.fromAddress).toBe('alice@partner.test');
    expect(plain?.direction).toBe('inbound');
    expect(plain?.hasAttachments).toBe(false);
  });

  it('reports a real attachment, structure and all', async () => {
    const provider = createImapProvider(MAILBOX_ADDRESS, undefined, allowPrivateHost);

    const page = await provider.fetchSince(AUTH, null, since);

    const withAttachment = page.messages.find(
      (message) => message.subject === 'A message with an attachment',
    );
    expect(withAttachment).toBeDefined();
    expect(withAttachment?.hasAttachments).toBe(true);
    expect(withAttachment?.bodyText).toContain('See attached.');
  });

  it('advances the cursor and returns nothing new on a re-sync', async () => {
    const provider = createImapProvider(MAILBOX_ADDRESS, undefined, allowPrivateHost);

    const first = await provider.fetchSince(AUTH, null, since);
    expect(first.messages.length).toBeGreaterThanOrEqual(2);
    expect(first.cursor).not.toBeNull();
    expect(first.cursorInvalid).toBe(false);

    // The ingest is idempotent, but a cursor that does not advance would re-deliver the
    // whole mailbox every tick — which the fake cannot demonstrate either way.
    const second = await provider.fetchSince(AUTH, first.cursor, since);
    expect(second.messages).toHaveLength(0);
    expect(second.cursorInvalid).toBe(false);
  });

  it('treats a cursor from a different mailbox generation as invalid', async () => {
    const provider = createImapProvider(MAILBOX_ADDRESS, undefined, allowPrivateHost);

    // The cursor is keyed by mailbox path; a uidValidity the server will not match is what
    // a recreated mailbox looks like.
    const stale = JSON.stringify({ INBOX: { uidValidity: '1', uidNext: 1 } });
    const page = await provider.fetchSince(AUTH, stale, since);

    expect(page.cursorInvalid).toBe(true);
    expect(page.cursor).toBeNull();
  });
});
