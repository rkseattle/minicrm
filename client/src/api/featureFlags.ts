/**
 * Feature flags API module.
 * Wraps the admin feature flag endpoints.
 * All calls require admin authentication.
 * (MINCRM-463, MINCRM-488, MINCRM-489)
 */

import apiClient from './axiosInstance.js';
import type {
  FeatureFlagRow,
  MyFeatureFlagsResponse,
  UpdateFeatureFlagInput,
  BetaUserEntry,
} from '@shared/schemas/featureFlagSchema.js';

/** React Query cache key for the feature flags list */
export const FEATURE_FLAGS_QUERY_KEY = ['admin', 'feature-flags'] as const;

/** Shape of the list response from GET /api/v1/admin/feature-flags */
export interface ListFeatureFlagsResponse {
  flags: FeatureFlagRow[];
}

/** Shape of the update response from PATCH /api/v1/admin/feature-flags/:key */
export interface UpdateFeatureFlagResponse {
  flag: FeatureFlagRow;
}

/**
 * Returns all feature flags with active user counts.
 * Admin only.
 */
export async function listFeatureFlags(): Promise<ListFeatureFlagsResponse> {
  const response = await apiClient.get<ListFeatureFlagsResponse>('/admin/feature-flags');
  return response.data;
}

/**
 * Updates the enabled state and/or role overrides for a feature flag.
 * Admin only.
 */
export async function updateFeatureFlag(
  key: string,
  patch: UpdateFeatureFlagInput,
): Promise<UpdateFeatureFlagResponse> {
  const response = await apiClient.patch<UpdateFeatureFlagResponse>(
    `/admin/feature-flags/${key}`,
    patch,
  );
  return response.data;
}

/** React Query cache key for the current user's resolved feature flags */
export const MY_FEATURE_FLAGS_QUERY_KEY = ['feature-flags', 'me'] as const;

/**
 * Returns the resolved enabled state for every feature flag for the calling user's role.
 * Available to all authenticated users.
 */
export async function getMyFeatureFlags(): Promise<{ flags: MyFeatureFlagsResponse }> {
  const response = await apiClient.get<{ flags: MyFeatureFlagsResponse }>('/feature-flags/me');
  return response.data;
}

// ── Beta user endpoints (MINCRM-489) ──────────────────────────────────────────

/** React Query cache key factory for beta users list; scoped per flag key. */
export const betaUsersQueryKey = (flagKey: string) =>
  ['admin', 'feature-flags', flagKey, 'beta-users'] as const;

/** Shape of the GET beta-users response. */
export interface ListBetaUsersResponse {
  users: BetaUserEntry[];
}

/**
 * Returns all users enrolled in the beta for a specific flag.
 * Admin only.
 */
export async function getBetaUsers(flagKey: string): Promise<ListBetaUsersResponse> {
  const response = await apiClient.get<ListBetaUsersResponse>(
    `/admin/feature-flags/${flagKey}/beta-users`,
  );
  return response.data;
}

/**
 * Enrolls a user in the beta for a feature flag.
 * Admin only.
 */
export async function enrollBetaUser(
  flagKey: string,
  userId: string,
): Promise<{ user: BetaUserEntry }> {
  const response = await apiClient.post<{ user: BetaUserEntry }>(
    `/admin/feature-flags/${flagKey}/beta-users`,
    { userId },
  );
  return response.data;
}

/**
 * Removes a user from the beta for a feature flag.
 * Admin only.
 */
export async function removeBetaUser(flagKey: string, userId: string): Promise<void> {
  await apiClient.delete(`/admin/feature-flags/${flagKey}/beta-users/${userId}`);
}
