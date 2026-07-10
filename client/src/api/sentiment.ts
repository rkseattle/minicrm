/**
 * Sentiment tracking API module. (MINCRM-472)
 * Wraps the contact/account sentiment trend endpoints and the per-activity
 * "flag as inaccurate" action. Requires authentication and the
 * ai_sentiment_tracking feature flag.
 */

import apiClient from './axiosInstance.js';
import type {
  ContactSentimentTrendResponse,
  AccountSentimentTrendResponse,
} from '@shared/schemas/sentimentScoreSchema.js';

export function contactSentimentTrendQueryKey(
  contactId: string,
): readonly [string, string, string] {
  return ['contacts', contactId, 'sentimentTrend'] as const;
}

export function accountSentimentTrendQueryKey(
  accountId: string,
): readonly [string, string, string] {
  return ['accounts', accountId, 'sentimentTrend'] as const;
}

export async function getContactSentimentTrend(
  contactId: string,
): Promise<ContactSentimentTrendResponse> {
  const response = await apiClient.get<ContactSentimentTrendResponse>(
    `/contacts/${contactId}/sentiment-trend`,
  );
  return response.data;
}

export async function getAccountSentimentTrend(
  accountId: string,
): Promise<AccountSentimentTrendResponse> {
  const response = await apiClient.get<AccountSentimentTrendResponse>(
    `/accounts/${accountId}/sentiment-trend`,
  );
  return response.data;
}

export async function flagActivitySentimentInaccurate(
  activityId: string,
): Promise<{ activity_id: string; flagged_inaccurate: boolean }> {
  const response = await apiClient.post<{ activity_id: string; flagged_inaccurate: boolean }>(
    `/activities/${activityId}/sentiment/flag-inaccurate`,
  );
  return response.data;
}
