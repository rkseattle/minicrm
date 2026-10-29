/**
 * Client for the mail provider emulator's `/__admin` control plane.
 *
 * Test-side only: the system under test talks to the emulator as if it were Gmail or
 * Graph, while a test uses this to register a mailbox, seed what it should find, read back
 * what was sent, expire its cursors, and remove the mailbox afterwards. The routes and
 * bodies are defined in fakes/mail-provider-emulator.ts.
 */

import type {
  AdminMessage,
  RegisterMailbox,
  SeedMessage,
} from '../fakes/mail-provider-emulator.js';

/** One admin call's budget, so a hung emulator fails naming the call, not as a test timeout. */
const REQUEST_TIMEOUT_MS = 10_000;

/** What a seed returns: the provider's ids for the stored message and its thread. */
export interface SeededMessage {
  id: string;
  threadId: string;
}

/** Raised for any non-2xx answer, carrying the status so a caller can branch on it. */
export class MailEmulatorError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MailEmulatorError';
    this.status = status;
  }
}

/** Drives one emulator's admin API; every call throws a MailEmulatorError on refusal. */
export class MailEmulatorClient {
  private readonly baseUrl: string;

  /** @param baseUrl - The emulator's origin, with no trailing slash. */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Creates a mailbox the given bearer token selects.
   *
   * @param mailbox - The token the system under test will send, and the mailbox address.
   */
  async registerMailbox(mailbox: RegisterMailbox): Promise<void> {
    await this.request('POST', '/__admin/mailboxes', mailbox);
  }

  /**
   * Stores one message in a mailbox, as if it had been delivered or sent there.
   *
   * @param token - The mailbox's bearer token.
   * @param message - The message and where it lands.
   * @returns The provider ids the emulator assigned.
   */
  async seedMessage(token: string, message: SeedMessage): Promise<SeededMessage> {
    const body = await this.request('POST', `${this.mailboxPath(token)}/messages`, message);
    // Safe: Partial, and both fields are checked before use.
    const { id, threadId } = body as Partial<SeededMessage>;
    if (typeof id !== 'string' || typeof threadId !== 'string') {
      throw new MailEmulatorError(502, 'seed answered without an id and threadId');
    }
    return { id, threadId };
  }

  /**
   * Every message in a mailbox, drafts included, in the order it stored them.
   *
   * @param token - The mailbox's bearer token.
   */
  async listMessages(token: string): Promise<AdminMessage[]> {
    const body = await this.request('GET', `${this.mailboxPath(token)}/messages`);
    // Safe: the property is read as unknown and checked on the next line.
    const messages = (body as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) {
      throw new MailEmulatorError(502, 'message list answered without a messages array');
    }
    // Safe: the emulator, typed against AdminMessage, is the only producer of this body.
    return messages as AdminMessage[];
  }

  /**
   * Makes every cursor issued for the mailbox so far stale, forcing a resync.
   *
   * @param token - The mailbox's bearer token.
   */
  async expireCursors(token: string): Promise<void> {
    await this.request('POST', `${this.mailboxPath(token)}/expire-cursors`);
  }

  /**
   * Removes one mailbox; a test's teardown. A mailbox already gone is not an error.
   *
   * @param token - The mailbox's bearer token.
   */
  async deleteMailbox(token: string): Promise<void> {
    try {
      await this.request('DELETE', this.mailboxPath(token));
    } catch (err) {
      if (err instanceof MailEmulatorError && err.status === 404) return;
      throw err;
    }
  }

  private mailboxPath(token: string): string {
    return `/__admin/mailboxes/${encodeURIComponent(token)}`;
  }

  private async request(method: string, path: string, body?: object): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new MailEmulatorError(
        response.status,
        `${method} ${path} answered ${String(response.status)}: ${text}`,
      );
    }
    // Safe: typed as unknown, and every caller checks the shape it reads.
    return text ? (JSON.parse(text) as unknown) : {};
  }
}
