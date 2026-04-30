/**
 * Webhooks API module.
 * Wraps the webhook subscription CRUD and delivery log endpoints. All endpoints are admin-only.
 */

import apiClient from './axiosInstance.js';
import type {
  WebhookSubscriptionResponse,
  WebhookDeliveryLogResponse,
  CreateWebhookSubscriptionInput,
  UpdateWebhookSubscriptionInput,
} from '@shared/schemas/webhookSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

/** React Query cache key for the webhook subscriptions list */
export const WEBHOOKS_QUERY_KEY = ['admin', 'webhooks'] as const;

/** React Query cache key for the delivery logs of a single subscription */
export const WEBHOOK_DELIVERY_LOGS_QUERY_KEY = (id: string) =>
  ['admin', 'webhooks', id, 'logs'] as const;

interface WebhookSubscriptionsResponse {
  subscriptions: WebhookSubscriptionResponse[];
}

interface WebhookSubscriptionCreateResponse {
  subscription: WebhookSubscriptionResponse;
  /** Plaintext signing secret — only present in the create (201) response */
  plaintextSecret: string;
}

interface WebhookSubscriptionSingleResponse {
  subscription: WebhookSubscriptionResponse;
}

/**
 * Returns all webhook subscriptions.
 */
export async function listWebhookSubscriptions(): Promise<WebhookSubscriptionsResponse> {
  const response = await apiClient.get<WebhookSubscriptionsResponse>('/admin/webhooks');
  return response.data;
}

/**
 * Returns a single webhook subscription by UUID.
 *
 * @param id - Subscription UUID
 */
export async function getWebhookSubscription(
  id: string,
): Promise<WebhookSubscriptionSingleResponse> {
  const response = await apiClient.get<WebhookSubscriptionSingleResponse>(`/admin/webhooks/${id}`);
  return response.data;
}

/**
 * Creates a new webhook subscription.
 * The response includes a `plaintextSecret` shown once — save it securely.
 *
 * @param data - Subscription fields (url + events)
 */
export async function createWebhookSubscription(
  data: CreateWebhookSubscriptionInput,
): Promise<WebhookSubscriptionCreateResponse> {
  const response = await apiClient.post<WebhookSubscriptionCreateResponse>('/admin/webhooks', data);
  return response.data;
}

/**
 * Updates a webhook subscription (url, events, or status).
 *
 * @param id - Subscription UUID
 * @param data - Fields to update
 */
export async function updateWebhookSubscription(
  id: string,
  data: UpdateWebhookSubscriptionInput,
): Promise<WebhookSubscriptionSingleResponse> {
  const response = await apiClient.patch<WebhookSubscriptionSingleResponse>(
    `/admin/webhooks/${id}`,
    data,
  );
  return response.data;
}

/**
 * Deletes a webhook subscription and all its delivery logs.
 *
 * @param id - Subscription UUID
 */
export async function deleteWebhookSubscription(id: string): Promise<void> {
  await apiClient.delete(`/admin/webhooks/${id}`);
}

/**
 * Returns paginated delivery logs for a subscription.
 *
 * @param id - Subscription UUID
 * @param params - Optional pagination (page, limit)
 */
export async function listWebhookDeliveryLogs(
  id: string,
  params?: { page?: number; limit?: number },
): Promise<PaginatedResponse<WebhookDeliveryLogResponse>> {
  const response = await apiClient.get<PaginatedResponse<WebhookDeliveryLogResponse>>(
    `/admin/webhooks/${id}/logs`,
    { params },
  );
  return response.data;
}
