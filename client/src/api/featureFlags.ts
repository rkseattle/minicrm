/**
 * Feature flags API module.
 * Wraps the admin feature flag endpoints.
 * All calls require admin authentication.
 * (MINCRM-463, MINCRM-488, MINCRM-489, MINCRM-490, MINCRM-491, MINCRM-492)
 */

import apiClient from './axiosInstance.js';
import type {
  FeatureFlagRow,
  MyFeatureFlagsResponse,
  UpdateFeatureFlagInput,
  BetaUserEntry,
  UserOverrideEntry,
  UpsertUserOverrideInput,
  FlagGroupRow,
  GroupBetaUserEntry,
  CreateFlagGroupInput,
  UpdateFlagGroupInput,
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

// ── Per-user overrides (MINCRM-492) ──────────────────────────────────────────

/** React Query cache key factory for user overrides list; scoped per flag key. */
export const userOverridesQueryKey = (flagKey: string) =>
  ['admin', 'feature-flags', flagKey, 'overrides'] as const;

/** Shape of the GET overrides response. */
export interface ListUserOverridesResponse {
  overrides: UserOverrideEntry[];
}

/**
 * Returns all per-user overrides for a specific flag.
 * Admin only.
 */
export async function listUserOverrides(flagKey: string): Promise<ListUserOverridesResponse> {
  const response = await apiClient.get<ListUserOverridesResponse>(
    `/admin/feature-flags/${flagKey}/overrides`,
  );
  return response.data;
}

/**
 * Upserts a per-user override (force_enabled or force_disabled) for a feature flag.
 * If an override already exists for this user+flag, it is replaced.
 * Admin only.
 */
export async function upsertUserOverride(
  flagKey: string,
  userId: string,
  body: UpsertUserOverrideInput,
): Promise<{ override: UserOverrideEntry }> {
  const response = await apiClient.put<{ override: UserOverrideEntry }>(
    `/admin/feature-flags/${flagKey}/overrides/${userId}`,
    body,
  );
  return response.data;
}

/**
 * Removes a per-user override for a feature flag.
 * Admin only.
 */
export async function deleteUserOverride(flagKey: string, userId: string): Promise<void> {
  await apiClient.delete(`/admin/feature-flags/${flagKey}/overrides/${userId}`);
}

// ── Flag group endpoints (MINCRM-491) ─────────────────────────────────────────

/** React Query cache key for the flag groups list. */
export const FLAG_GROUPS_QUERY_KEY = ['admin', 'feature-flags', 'groups'] as const;

/** React Query cache key factory for group beta users; scoped per group key. */
export const groupBetaUsersQueryKey = (groupKey: string) =>
  ['admin', 'feature-flags', 'groups', groupKey, 'beta-users'] as const;

/** Shape of the GET /groups response. */
export interface ListFlagGroupsResponse {
  groups: FlagGroupRow[];
}

/** Shape of the POST /groups response. */
export interface CreateFlagGroupResponse {
  group: FlagGroupRow;
}

/** Shape of the PATCH /groups/:key response. */
export interface UpdateFlagGroupResponse {
  group: FlagGroupRow;
}

/**
 * Returns all flag groups with member_count and beta_user_count.
 * Admin only.
 */
export async function listFlagGroups(): Promise<ListFlagGroupsResponse> {
  const response = await apiClient.get<ListFlagGroupsResponse>('/admin/feature-flags/groups');
  return response.data;
}

/**
 * Creates a new flag group.
 * Admin only.
 */
export async function createFlagGroup(
  input: CreateFlagGroupInput,
): Promise<CreateFlagGroupResponse> {
  const response = await apiClient.post<CreateFlagGroupResponse>(
    '/admin/feature-flags/groups',
    input,
  );
  return response.data;
}

/**
 * Updates a flag group's enabled state, enable_at, label, or description.
 * Admin only.
 */
export async function updateFlagGroup(
  groupKey: string,
  patch: UpdateFlagGroupInput,
): Promise<UpdateFlagGroupResponse> {
  const response = await apiClient.patch<UpdateFlagGroupResponse>(
    `/admin/feature-flags/groups/${groupKey}`,
    patch,
  );
  return response.data;
}

/**
 * Deletes a flag group. The server returns 409 if the group still has member flags.
 * Admin only.
 */
export async function deleteFlagGroup(groupKey: string): Promise<void> {
  await apiClient.delete(`/admin/feature-flags/groups/${groupKey}`);
}

/** Shape of GET /groups/:key/beta-users response. */
export interface ListGroupBetaUsersResponse {
  users: GroupBetaUserEntry[];
}

/**
 * Returns all users enrolled in a group's beta.
 * Admin only.
 */
export async function getGroupBetaUsers(groupKey: string): Promise<ListGroupBetaUsersResponse> {
  const response = await apiClient.get<ListGroupBetaUsersResponse>(
    `/admin/feature-flags/groups/${groupKey}/beta-users`,
  );
  return response.data;
}

/**
 * Enrolls a user in a group's beta list.
 * Admin only.
 */
export async function enrollGroupBetaUser(
  groupKey: string,
  userId: string,
): Promise<{ user: GroupBetaUserEntry }> {
  const response = await apiClient.post<{ user: GroupBetaUserEntry }>(
    `/admin/feature-flags/groups/${groupKey}/beta-users`,
    { userId },
  );
  return response.data;
}

/**
 * Removes a user from a group's beta list.
 * Admin only.
 */
export async function removeGroupBetaUser(groupKey: string, userId: string): Promise<void> {
  await apiClient.delete(`/admin/feature-flags/groups/${groupKey}/beta-users/${userId}`);
}
