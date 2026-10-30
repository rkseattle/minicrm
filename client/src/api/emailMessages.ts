/**
 * Email messages API module.
 * Wraps listing a record's threads, reading message bodies, and sending through a
 * connected mailbox.
 */

import {
  IDEMPOTENCY_KEY_HEADER,
  type EmailLinkRecordType,
  type EmailMessageDetail,
  type EmailMessageEnvelope,
  type EmailThreadPage,
  type SendEmailInput,
  type SendEmailResponse,
  type ThreadPrivacyResponse,
} from '@shared/schemas/emailMessageSchema.js';

import apiClient from './axiosInstance.js';

/** React Query cache key for lists of synced and sent mail; a send invalidates it. */
export const EMAIL_MESSAGES_QUERY_KEY = ['email-messages'] as const;

/**
 * Cache key for one message's bodies. Its own root, so list queries never match it; a later
 * sync can fill in or replace a body, so it goes stale like any other query.
 */
export const EMAIL_MESSAGE_BODY_QUERY_KEY = ['email-message-body'] as const;

/**
 * Sends one message through one of the caller's connected mailboxes.
 *
 * @param idempotencyKey - One per compose, reused on every retry of it, so a retry never
 *   mails the recipient twice.
 */
export async function sendEmailMessage(
  input: SendEmailInput,
  idempotencyKey: string,
): Promise<SendEmailResponse> {
  const response = await apiClient.post<SendEmailResponse>('/email-messages/send', input, {
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });
  return response.data;
}

/** One page of the conversations linked to a record, latest first. */
export async function listRecordEmailThreads(params: {
  recordType: EmailLinkRecordType;
  recordId: string;
  page: number;
  limit: number;
}): Promise<EmailThreadPage> {
  const response = await apiClient.get<EmailThreadPage>('/email-messages', {
    params: {
      record_type: params.recordType,
      record_id: params.recordId,
      page: params.page,
      limit: params.limit,
    },
  });
  return response.data;
}

/** One message with its bodies. The HTML is unsanitized: render it only through EmailBodyFrame. */
export async function getEmailMessage(id: string): Promise<EmailMessageDetail> {
  const response = await apiClient.get<EmailMessageEnvelope>(`/email-messages/${id}`);
  return response.data.message;
}

/**
 * Marks the whole thread a message belongs to private, or visible again, in the caller's
 * own mailbox.
 */
export async function setThreadPrivacy(
  messageId: string,
  isPrivate: boolean,
): Promise<ThreadPrivacyResponse> {
  const response = await apiClient.patch<ThreadPrivacyResponse>(
    `/email-messages/${messageId}/thread-privacy`,
    { is_private: isPrivate },
  );
  return response.data;
}
