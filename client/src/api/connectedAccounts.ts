/**
 * Connected accounts API module.
 * Wraps the per-user mailbox endpoints.
 */

import type {
  ConnectedAccountResponse,
  ConnectionTestResult,
  ImapCredentialsInput,
  OAuthProvider,
} from '@shared/schemas/connectedAccountSchema.js';

import apiClient from './axiosInstance.js';

// ── Query keys ────────────────────────────────────────────────────────────────

/** React Query cache key for the caller's connected mailboxes */
export const CONNECTED_ACCOUNTS_QUERY_KEY = ['connected-accounts'] as const;

// ── Response types ────────────────────────────────────────────────────────────

export interface ListConnectedAccountsResponse {
  accounts: ConnectedAccountResponse[];
}

// ── API functions ─────────────────────────────────────────────────────────────

/** Returns the calling user's connected mailboxes. Credentials are never included. */
export async function getConnectedAccounts(): Promise<ListConnectedAccountsResponse> {
  const response = await apiClient.get<ListConnectedAccountsResponse>('/connected-accounts');
  return response.data;
}

/** Connects a mailbox by IMAP. The server tests the credentials before storing them. */
export async function createImapAccount(
  input: ImapCredentialsInput,
): Promise<{ account: ConnectedAccountResponse }> {
  const response = await apiClient.post<{ account: ConnectedAccountResponse }>(
    '/connected-accounts',
    input,
  );
  return response.data;
}

/** Disconnects a mailbox and revokes its token where the provider supports it. */
export async function deleteConnectedAccount(id: string): Promise<void> {
  await apiClient.delete(`/connected-accounts/${id}`);
}

/** Re-tests a stored mailbox. Always resolves — the outcome is in the payload. */
export async function testConnectedAccount(id: string): Promise<ConnectionTestResult> {
  const response = await apiClient.post<ConnectionTestResult>(`/connected-accounts/${id}/test`);
  return response.data;
}

/**
 * The URL that begins an OAuth connect.
 *
 * A full page navigation rather than an XHR: the provider's consent screen has to render
 * in the browser, and it will not load in a fetch.
 */
export function oauthStartUrl(provider: OAuthProvider): string {
  return `/api/v1/connected-accounts/oauth/${provider}/start`;
}
