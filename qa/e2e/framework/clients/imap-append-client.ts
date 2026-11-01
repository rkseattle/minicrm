/**
 * Stores test mail straight into a real IMAP mailbox with IMAP APPEND (RFC 3501 §6.3.11).
 *
 * SMTP delivery stamps a message's internal date with its arrival time, so it can only
 * seed mail dated now. APPEND carries the internal date the server records, which is the
 * date `SEARCH SINCE` compares — the one way to seed mail older than a sync window.
 *
 * Plain IMAP with no TLS, against a local test server; never point it at a real mailbox.
 */

import { ImapFlow } from 'imapflow';

/** Per-phase budget, so a hung server fails naming the append, not as a test timeout. */
const IMAP_TIMEOUT_MS = 10_000;

/** Where every append lands; the mailbox every IMAP server has. */
const INBOX = 'INBOX';

/** Where the test IMAP server listens, and the password its login accepts. */
export interface ImapAppendTarget {
  host: string;
  port: number;
  password: string;
}

/** Appends seeded messages into mailboxes on one test IMAP server. */
export class ImapAppendClient {
  constructor(private readonly target: ImapAppendTarget) {}

  /**
   * Appends one message to a mailbox's INBOX with the given internal date.
   *
   * @param user - The mailbox's login, which on a test server is its address.
   * @param raw - The whole RFC 5322 message.
   * @param internalDate - The date the server records the message as received.
   * @throws When the server refuses the login or the append.
   */
  async append(user: string, raw: string, internalDate: Date): Promise<void> {
    const client = new ImapFlow({
      host: this.target.host,
      port: this.target.port,
      secure: false,
      doSTARTTLS: false,
      auth: { user, pass: this.target.password },
      // imapflow logs the whole conversation, LOGIN included, at info level.
      logger: false,
      connectionTimeout: IMAP_TIMEOUT_MS,
      greetingTimeout: IMAP_TIMEOUT_MS,
      socketTimeout: IMAP_TIMEOUT_MS,
    });
    await client.connect();
    try {
      const appended = await client.append(INBOX, raw, [], internalDate);
      if (appended === false) {
        throw new Error(`IMAP APPEND to ${user} was refused`);
      }
    } finally {
      try {
        await client.logout();
      } catch (err) {
        // LOGOUT can fail on a socket already gone; close() always frees it.
        console.warn(`IMAP LOGOUT for ${user} failed; closing the connection`, err);
        client.close();
      }
    }
  }
}
