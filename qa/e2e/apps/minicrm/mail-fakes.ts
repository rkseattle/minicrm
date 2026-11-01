/**
 * Where this app's email sync specs find the fake mail providers, and clients for them.
 *
 * Defaults match docker-compose.test.yml; CI's e2e-serial job and TIA record mode set each
 * variable themselves.
 * See docs/dev/email-sync.md for how the server is pointed at the same fakes.
 */

import { ImapAppendClient } from '@framework/clients/imap-append-client.js';
import { MailEmulatorClient } from '@framework/clients/mail-emulator-client.js';
import {
  referencesOf,
  SmtpSeedClient,
  type SeedMail,
} from '@framework/clients/smtp-seed-client.js';
import MailComposer from 'nodemailer/lib/mail-composer';
import { mailFakeCoordinates } from '@minicrm/shared/testing/testStackMailFakes.js';

const COORDINATES = mailFakeCoordinates(process.env);

/** GreenMail's SMTP port as the test runner reaches it, for delivering seeded mail. */
export const GREENMAIL_SMTP_URL = COORDINATES.greenmailSmtpUrl;

/** The IMAP host the server dials: the Compose service name locally, localhost in CI. */
export const IMAP_HOST_FOR_SERVER = process.env['E2E_IMAP_HOST_FOR_SERVER'] || 'greenmail';

/** GreenMail's plain IMAP port, published on the host as-is; nothing here uses TLS. */
export const GREENMAIL_IMAP_PORT = 3143;

/** GreenMail's IMAP login takes any password once auth is disabled; one fixed value is enough. */
export const GREENMAIL_PASSWORD = 'any-password-1';

/** The mail provider emulator's admin API as the test runner reaches it. */
export const MAIL_EMULATOR_URL = COORDINATES.emulatorUrl;

/** A client for the emulator's admin API. */
export function mailEmulator(): MailEmulatorClient {
  return new MailEmulatorClient(MAIL_EMULATOR_URL);
}

/** A client that delivers seeded mail into GreenMail; close it when done. */
export function greenMailSmtp(): SmtpSeedClient {
  return new SmtpSeedClient(GREENMAIL_SMTP_URL);
}

/** A client that appends dated mail into GreenMail over IMAP, on the host SMTP reaches. */
export function greenMailImap(): ImapAppendClient {
  return new ImapAppendClient({
    host: new URL(GREENMAIL_SMTP_URL).hostname,
    port: GREENMAIL_IMAP_PORT,
    password: GREENMAIL_PASSWORD,
  });
}

/**
 * Builds an RFC 5322 message the emulator stores as a provider would.
 *
 * Built by nodemailer's MailComposer, the same library that delivers SMTP seeds, so
 * headers are encoded and folded as a real mail client would write them.
 *
 * @param mail - The message; a fresh Message-ID is minted unless one is given.
 * @returns The whole message, headers and body, as text.
 */
export async function rfc822Message(mail: SeedMail): Promise<string> {
  const composer = new MailComposer({
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: referencesOf(mail),
    date: mail.date,
  });
  const built = await composer.compile().build();
  return built.toString('utf8');
}
