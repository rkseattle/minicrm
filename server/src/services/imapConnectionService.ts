/**
 * IMAP connection testing.
 *
 * Validates candidate credentials against the live server before anything is persisted,
 * so a mailbox that cannot be reached is never stored. Nothing here reads mail — the
 * session is opened, authenticated, and closed.
 *
 * Errors never escape as library objects: every failure maps to one of two domain codes
 * so a caller cannot leak a stack trace or a server banner into a response.
 */

import { ImapFlow } from 'imapflow';

import {
  CONNECTION_FAILED,
  PROVIDER_AUTH_EXPIRED,
} from '@minicrm/shared/schemas/connectedAccountSchema.js';

import logger from '../logger.js';
import { UrlNotSafeError, assertHostnameIsSafe } from '../utils/urlSafetyUtils.js';

/** Candidate IMAP credentials, before they are trusted enough to store. */
export interface ImapConnectionCandidate {
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
}

// Re-exported from the shared list rather than restated: both reach status_detail, which
// the client renders by translating, so a copy that drifts degrades the mailbox to the
// generic reason instead of failing loudly.
export { PROVIDER_AUTH_EXPIRED, CONNECTION_FAILED };

/** Outcome of a connection attempt. `code` is absent only when the attempt succeeded. */
export type ImapConnectionResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof CONNECTION_FAILED | typeof PROVIDER_AUTH_EXPIRED;
      message: string;
    };

/**
 * Time budget for the whole attempt.
 *
 * imapflow takes no AbortSignal — it is a TCP/TLS client, not fetch — so the bound comes
 * from its own three timers. They are deliberately short: a user is waiting on this
 * synchronously in a form submit, where imapflow's 90s connection default reads as a hang.
 */
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 8_000;
const SOCKET_TIMEOUT_MS = 15_000;

/** imapflow's authentication failures carry this response code. */
const AUTH_FAILURE_CODE = 'AUTHENTICATIONFAILED';

/**
 * Distinguishes bad credentials from an unreachable server.
 *
 * The distinction is what the user acts on: a wrong password is theirs to fix, an
 * unreachable host usually is not. imapflow signals auth failure through
 * `authenticationFailed` or an `AUTHENTICATIONFAILED` response code; everything else —
 * DNS, TLS, refused connection, timeout — is a reachability problem.
 */
export function classifyImapError(
  err: unknown,
): typeof CONNECTION_FAILED | typeof PROVIDER_AUTH_EXPIRED {
  const candidate = err as { authenticationFailed?: boolean; responseText?: string; code?: string };
  if (candidate.authenticationFailed === true) return PROVIDER_AUTH_EXPIRED;
  if (candidate.code === AUTH_FAILURE_CODE) return PROVIDER_AUTH_EXPIRED;
  return CONNECTION_FAILED;
}

/** Timeouts one caller supplies, because a background sync and a form submit differ. */
export interface ImapClientTimeouts {
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}

/**
 * Builds a client for a set of credentials.
 *
 * Shared so the `logger: false` stays in one place: imapflow logs the entire IMAP
 * conversation at info level, the AUTH exchange included, and a copy of this construction
 * that omits it writes plaintext credentials to the log.
 */
export function createImapClient(
  candidate: ImapConnectionCandidate,
  timeouts: ImapClientTimeouts,
): ImapFlow {
  return new ImapFlow({
    host: candidate.host,
    port: candidate.port,
    secure: candidate.secure,
    auth: { user: candidate.username, pass: candidate.password },
    logger: false,
    ...timeouts,
  });
}

/**
 * Ends a session, guaranteeing the socket is released.
 *
 * logout() negotiates a clean IMAP BYE and can itself hang or throw on a socket that is
 * already gone; close() is unconditional and is what actually frees the fd.
 */
export async function closeImapClient(client: ImapFlow): Promise<void> {
  try {
    await client.logout();
  } catch {
    client.close();
  }
}

/**
 * Opens an authenticated IMAP session and closes it again.
 *
 * @param candidate - Credentials to try. Never persisted by this function.
 * @returns ok on a successful authenticated connection, otherwise a domain error code.
 */
export async function testImapConnection(
  candidate: ImapConnectionCandidate,
): Promise<ImapConnectionResult> {
  // The host is attacker-chosen on every call, so without this the endpoint is a port
  // scanner for loopback, RFC 1918, and cloud metadata. Resolved here rather than against
  // the submitted form value, so the check runs on what the name resolves to now.
  // imapflow then resolves independently, so this narrows the rebinding window without
  // closing it — the same limitation every fetch-based caller in this repo has.
  try {
    await assertHostnameIsSafe(candidate.host);
  } catch (err) {
    if (err instanceof UrlNotSafeError) {
      logger.warn(
        { host: candidate.host, reason: err.reason },
        'imapConnectionService: refused an unsafe mail server address',
      );
      return {
        ok: false,
        code: CONNECTION_FAILED,
        message: 'Could not reach that mail server.',
      };
    }
    throw err;
  }

  const client = createImapClient(candidate, {
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });

  try {
    await client.connect();
    return { ok: true };
  } catch (err) {
    const code = classifyImapError(err);
    logger.warn(
      { err, host: candidate.host, code },
      'imapConnectionService: connection test failed',
    );
    return {
      ok: false,
      code,
      message:
        code === PROVIDER_AUTH_EXPIRED
          ? 'The mail server rejected those credentials.'
          : 'Could not reach that mail server.',
    };
  } finally {
    await closeImapClient(client);
  }
}
