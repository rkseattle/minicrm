/**
 * Delivers test mail into a real SMTP server — the way a test seeds an IMAP mailbox.
 *
 * Plain SMTP with no TLS and no auth, which is what a local test mail server speaks; a
 * test points this at the server's published port, never at a real relay.
 */

import nodemailer from 'nodemailer';

/** One message to deliver. Ids are angle-bracketed, as they appear in the headers. */
export interface SeedMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** Defaults to a fresh id; set it when a later message must reply to this one. */
  messageId?: string;
  inReplyTo?: string;
  /** Defaults to `[inReplyTo]` when a reply names only that, as a mail client threads one. */
  references?: string[];
  date?: Date;
}

/**
 * The References a seeded message carries: its own, else the message it replies to.
 *
 * @param mail - The message to deliver.
 */
export function referencesOf(mail: SeedMail): string[] | undefined {
  return mail.references ?? (mail.inReplyTo ? [mail.inReplyTo] : undefined);
}

/** Per-phase budget, so a hung server fails naming the delivery, not as a test timeout. */
const SMTP_TIMEOUT_MS = 10_000;

/** Delivers seeded messages over plain SMTP to one test mail server. */
export class SmtpSeedClient {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  /** @param smtpUrl - e.g. `smtp://localhost:3025`. */
  constructor(smtpUrl: string) {
    this.transport = nodemailer.createTransport({
      url: smtpUrl,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
  }

  /**
   * Delivers one message and resolves once the server has accepted it.
   *
   * @param mail - The message to deliver.
   * @returns The Message-ID it was sent with.
   */
  async deliver(mail: SeedMail): Promise<string> {
    const info = await this.transport.sendMail({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      references: referencesOf(mail),
      date: mail.date,
    });
    return info.messageId;
  }

  /** Releases the transport; call once the test no longer needs to deliver. */
  close(): void {
    this.transport.close();
  }
}
