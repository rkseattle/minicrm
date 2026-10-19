/**
 * Email messages API module.
 * Wraps sending through a connected mailbox.
 */

import {
  IDEMPOTENCY_KEY_HEADER,
  type SendEmailInput,
  type SendEmailResponse,
} from '@shared/schemas/emailMessageSchema.js';

import apiClient from './axiosInstance.js';

/** React Query cache key for synced and sent mail; a send through a mailbox invalidates it. */
export const EMAIL_MESSAGES_QUERY_KEY = ['email-messages'] as const;

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
