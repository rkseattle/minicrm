/**
 * Shared Zod schemas for connected mailbox accounts.
 * Imported by both the server (request validation) and the client (form validation).
 *
 * The stored credentials themselves never appear in any schema here: they are encrypted
 * at rest and no API returns them, so there is nothing for a shared contract to describe.
 */

import { z } from 'zod';

/** Mailbox providers a user can connect. */
export const CONNECTED_ACCOUNT_PROVIDERS = ['google', 'microsoft', 'imap'] as const;

/** Providers reached through an OAuth authorization-code flow rather than a credential form. */
export const OAUTH_PROVIDERS = ['google', 'microsoft'] as const;

/**
 * Reasons a mailbox can be in error, as stored in `status_detail` and returned by the
 * connection test.
 *
 * A closed set because the client renders these by translating them: an unlisted value
 * reaches a user as a raw token or a generic fallback, and a database error code or a
 * transport errno is exactly what would otherwise leak here. Both sides import this list
 * rather than restating it, so a rename cannot silently degrade every mailbox to the
 * generic reason.
 */
export const CONNECTED_ACCOUNT_STATUS_DETAILS = [
  'INSUFFICIENT_SCOPE',
  'PROVIDER_AUTH_EXPIRED',
  'CONNECTION_FAILED',
  'UNTESTABLE_PROVIDER',
  'TEST_REQUEST_FAILED',
  'SYNC_FAILED',
] as const;

export type ConnectedAccountStatusDetail = (typeof CONNECTED_ACCOUNT_STATUS_DETAILS)[number];

// Each is typed to the union rather than to its own literal, so renaming an entry in the
// list above is a compile error at every name below instead of a silent divergence.

/** Recorded when a failure carries no reason of its own. */
export const SYNC_FAILED_DETAIL: ConnectedAccountStatusDetail = 'SYNC_FAILED';

/** Reported when a provider has no connection test of its own. */
export const UNTESTABLE_PROVIDER: ConnectedAccountStatusDetail = 'UNTESTABLE_PROVIDER';

/** Reported when the request to MiniCRM failed, so the provider was never asked. */
export const TEST_REQUEST_FAILED: ConnectedAccountStatusDetail = 'TEST_REQUEST_FAILED';

/** Reported when a mailbox did not grant the scope its driver needs to read mail. */
export const INSUFFICIENT_SCOPE: ConnectedAccountStatusDetail = 'INSUFFICIENT_SCOPE';

/** Reported when the stored credential is no longer usable and needs a person. */
export const PROVIDER_AUTH_EXPIRED: ConnectedAccountStatusDetail = 'PROVIDER_AUTH_EXPIRED';

/** Reported when the provider could not be reached at all. */
export const CONNECTION_FAILED: ConnectedAccountStatusDetail = 'CONNECTION_FAILED';

/** True when a value is one of the reasons a client knows how to render. */
export function isStatusDetail(value: unknown): value is ConnectedAccountStatusDetail {
  return (
    typeof value === 'string' &&
    (CONNECTED_ACCOUNT_STATUS_DETAILS as readonly string[]).includes(value)
  );
}

/**
 * Lifecycle states a connected account can be in.
 *
 * `disconnected` has no writer yet — disconnecting deletes the row outright. It is in the
 * CHECK constraint and here for the sync work, which needs to retire a mailbox without
 * discarding its cursor. Until then it is unreachable, so no user-facing surface claims it.
 */
export const CONNECTED_ACCOUNT_STATUSES = ['active', 'error', 'disconnected'] as const;

export type ConnectedAccountProvider = (typeof CONNECTED_ACCOUNT_PROVIDERS)[number];
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export type ConnectedAccountStatus = (typeof CONNECTED_ACCOUNT_STATUSES)[number];

/** Highest valid TCP port, used to bound the IMAP port. */
const MAX_TCP_PORT = 65535;

/** Longest legal hostname, per RFC 1035. */
const MAX_HOSTNAME_LENGTH = 253;

/** Longest legal email address, per RFC 5321. */
const MAX_EMAIL_LENGTH = 254;

/** Upper bound on a stored IMAP password, generous enough for app-specific passwords. */
const MAX_PASSWORD_LENGTH = 1024;

export const oauthProviderSchema = z.enum(OAUTH_PROVIDERS);

/**
 * IMAP credentials supplied when connecting a mailbox by hand.
 * Validated at the boundary, then tested against the live server before anything is
 * persisted — a mailbox that cannot be reached is never stored.
 */
export const imapCredentialsSchema = z.object({
  email_address: z.string().email().max(MAX_EMAIL_LENGTH),
  host: z.string().min(1).max(MAX_HOSTNAME_LENGTH),
  port: z.number().int().min(1).max(MAX_TCP_PORT),
  username: z.string().min(1).max(MAX_EMAIL_LENGTH),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  /** TLS on connect. Plain-text IMAP is accepted only because self-hosted servers still use STARTTLS on 143. */
  secure: z.boolean().default(true),
});

export type ImapCredentialsInput = z.infer<typeof imapCredentialsSchema>;

/**
 * A connected account as returned by the API.
 * Carries no credential material: `auth_encrypted` and `key_version` are deliberately
 * absent rather than masked, so there is no field for a future change to start populating.
 */
export const connectedAccountResponseSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(CONNECTED_ACCOUNT_PROVIDERS),
  email_address: z.string(),
  granted_scopes: z.array(z.string()),
  status: z.enum(CONNECTED_ACCOUNT_STATUSES),
  status_detail: z.string().nullable(),
  last_sync_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ConnectedAccountResponse = z.infer<typeof connectedAccountResponseSchema>;

/** Result of testing a stored or candidate mailbox connection. */
export const connectionTestResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;
