/**
 * mailhogClient.ts — Mailhog HTTP API wrapper for E2E email assertions.
 *
 * Wraps the Mailhog v2 message API so E2E tests can assert on transactional
 * email delivery without access to a real SMTP inbox.
 *
 * This helper is intentionally placed in apps/minicrm/ rather than framework/
 * because it is app-specific — framework/ must remain app-domain-free.
 *
 * Mailhog API reference:
 *   GET  /api/v2/messages          — list all captured messages
 *   DELETE /api/v1/messages        — delete all captured messages
 *
 * MINCRM-306
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single MIME header value (Mailhog wraps each header as a string array). */
type HeaderValues = string[];

/** Headers map as returned by the Mailhog API. */
type Headers = Record<string, HeaderValues>;

/** A single captured email message as returned by Mailhog. */
export interface MailhogMessage {
  ID: string;
  From: { Relays: string[] | null; Mailbox: string; Domain: string; Params: string };
  To: Array<{ Relays: string[] | null; Mailbox: string; Domain: string; Params: string }>;
  Content: {
    Headers: Headers;
    Body: string;
    Size: number;
    MIME: unknown | null;
  };
  Created: string;
  MIME: unknown | null;
  Raw: {
    From: string;
    To: string[];
    Data: string;
    Helo: string;
  };
}

/** Response shape from GET /api/v2/messages. */
interface MessagesResponse {
  total: number;
  count: number;
  start: number;
  items: MailhogMessage[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Decodes a quoted-printable encoded string.
 * Removes soft line breaks (=\r\n and =\n) and decodes =XX hex sequences.
 *
 * @param input - The QP-encoded string (e.g. from Content.Body or Raw.Data).
 * @returns The decoded plain text.
 */
export function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r\n/g, '')
    .replace(/=\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

// ── MailhogClient ─────────────────────────────────────────────────────────────

export class MailhogClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8025') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Returns all messages currently captured by Mailhog.
   * Each test should call clearMessages() in its beforeEach to prevent
   * cross-test contamination.
   */
  async getMessages(): Promise<MailhogMessage[]> {
    const response = await fetch(`${this.baseUrl}/api/v2/messages`);
    if (!response.ok) {
      throw new Error(
        `[MailhogClient] getMessages failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as MessagesResponse;
    return data.items;
  }

  /**
   * Deletes all captured messages. Call this in beforeEach to ensure a clean
   * inbox before each test.
   */
  async clearMessages(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/v1/messages`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(
        `[MailhogClient] clearMessages failed: ${response.status} ${response.statusText}`,
      );
    }
  }

  /**
   * Returns all messages sent to a specific recipient address.
   *
   * @param email - The recipient email address to filter by.
   */
  async getMessagesTo(email: string): Promise<MailhogMessage[]> {
    const all = await this.getMessages();
    return all.filter((msg) =>
      msg.To.some(
        (recipient) =>
          `${recipient.Mailbox}@${recipient.Domain}`.toLowerCase() === email.toLowerCase(),
      ),
    );
  }
}
