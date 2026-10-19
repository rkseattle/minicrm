/**
 * Which grants can send, decided in one place for the drivers and for the account
 * response the compose modal reads.
 *
 * Kept free of the OAuth client and the drivers, so the account service can ask without
 * loading either.
 */

import type { ConnectedAccountProvider } from '@minicrm/shared/schemas/connectedAccountSchema.js';

/**
 * The scope a driver needs to send through Gmail.
 *
 * Required exactly as the consent flow requests it: two copies drifting apart is a mailbox
 * that consented to sending and is refused anyway, with nothing to explain it.
 */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/**
 * The Graph permission a driver needs to send through a mailbox.
 *
 * Matched loosely — Microsoft may echo a bare `Mail.Send` rather than the resource URI that
 * was requested.
 */
export const GRAPH_MAIL_SEND_SCOPE = 'https://graph.microsoft.com/Mail.Send';

/**
 * The Graph permission a send needs beside `Mail.Send`.
 *
 * `sendMail` returns no message id, so a send creates a draft and sends that instead —
 * Microsoft's documented way to know the Sent Items copy's immutable id. Creating the draft
 * is a write. Matched loosely, like the other Graph scopes.
 */
export const GRAPH_MAIL_READWRITE_SCOPE = 'https://graph.microsoft.com/Mail.ReadWrite';

/** True when a granted scope list carries `wanted`, compared the way Microsoft echoes it. */
export function grantsGraphScope(grantedScopes: readonly string[], wanted: string): boolean {
  const bare = wanted.slice(wanted.lastIndexOf('/') + 1).toLowerCase();
  return grantedScopes.some(
    (scope) => scope.replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase() === bare,
  );
}

/** True when a Gmail grant can send. Google's consent screen lets a user untick send alone. */
export function grantsGmailSend(grantedScopes: readonly string[]): boolean {
  return grantedScopes.includes(GMAIL_SEND_SCOPE);
}

/**
 * True when a Graph grant can send: `Mail.Send` to submit, and `Mail.ReadWrite` to create the
 * draft whose immutable id the stored row carries.
 */
export function grantsGraphSend(grantedScopes: readonly string[]): boolean {
  return (
    grantsGraphScope(grantedScopes, GRAPH_MAIL_SEND_SCOPE) &&
    grantsGraphScope(grantedScopes, GRAPH_MAIL_READWRITE_SCOPE)
  );
}

/**
 * True when a mailbox can send. IMAP cannot: SMTP submission returns no message id, so no
 * IMAP driver defines a send.
 */
export function canSendFrom(
  provider: ConnectedAccountProvider,
  grantedScopes: readonly string[],
): boolean {
  if (provider === 'google') return grantsGmailSend(grantedScopes);
  if (provider === 'microsoft') return grantsGraphSend(grantedScopes);
  return false;
}
