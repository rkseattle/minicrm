/**
 * In-app notification feed API module. (MINCRM-469)
 * Requires authentication only — no feature flag, generic infrastructure.
 */

import apiClient from './axiosInstance.js';
import type { NotificationFeedResponse } from '@shared/schemas/notificationFeedSchema.js';

export const NOTIFICATION_FEED_QUERY_KEY = ['notification_feed'] as const;

export async function getNotificationFeed(): Promise<NotificationFeedResponse> {
  const response = await apiClient.get<NotificationFeedResponse>('/notifications');
  return response.data;
}

export async function markNotificationRead(id: string): Promise<NotificationFeedResponse> {
  const response = await apiClient.post<NotificationFeedResponse>(`/notifications/${id}/read`);
  return response.data;
}

export async function markAllNotificationsRead(): Promise<NotificationFeedResponse> {
  const response = await apiClient.post<NotificationFeedResponse>('/notifications/read-all');
  return response.data;
}
