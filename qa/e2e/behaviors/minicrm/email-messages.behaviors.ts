/**
 * Email message behaviors for MiniCRM.
 *
 * REST API helpers for the synced-mail read and filing endpoints. Behaviors do NOT
 * contain assertions (no expect() calls) — they return typed results, or the status of a
 * refusal, for the spec to assert against.
 */

import { RestClientError, type RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// API data types
// ---------------------------------------------------------------------------

/** One thread as the read endpoints return it. */
export interface TestEmailThread {
  thread_id: string;
  connected_account_id: string;
  messages: Array<{ id: string; subject: string | null; snippet: string | null }>;
}

/** A page of threads. */
export interface TestEmailThreadPage {
  data: TestEmailThread[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

/**
 * Reads the caller's own mail that no record claims yet.
 *
 * @param restClient - The authenticated client whose mailboxes are read.
 * @returns One page of unmatched threads.
 */
export async function listUnmatchedMail(restClient: RestClient): Promise<TestEmailThreadPage> {
  const res = await restClient.get<TestEmailThreadPage>('/api/v1/email-messages/unmatched');
  return res.body;
}

/**
 * Attempts to read the unmatched inbox, reporting the refusal rather than throwing.
 *
 * The endpoint sits behind three gates — authentication, the `email_sync` flag, and the
 * ConnectedAccountsManage capability — and a spec asserting on a gate needs the status
 * code, which the client otherwise raises as an error.
 *
 * @param restClient - The authenticated client to attempt the read as.
 * @returns The HTTP status, whether the request succeeded or was refused.
 */
export async function statusOfUnmatchedMailRequest(restClient: RestClient): Promise<number> {
  try {
    const res = await restClient.get<TestEmailThreadPage>('/api/v1/email-messages/unmatched');
    return res.status;
  } catch (err) {
    if (err instanceof RestClientError) {
      return err.status;
    }
    throw err;
  }
}

/**
 * Reads the mail linked to one record.
 *
 * @param restClient - The authenticated client whose mailboxes are read.
 * @param recordType - The record type to read the timeline of.
 * @param recordId - That record's id.
 * @returns One page of threads linked to the record.
 */
export async function listMailForRecord(
  restClient: RestClient,
  recordType: 'contact' | 'lead' | 'account' | 'deal',
  recordId: string,
): Promise<TestEmailThreadPage> {
  const res = await restClient.get<TestEmailThreadPage>(
    `/api/v1/email-messages?record_type=${recordType}&record_id=${recordId}`,
  );
  return res.body;
}
