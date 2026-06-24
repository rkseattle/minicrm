/**
 * Feature flags behaviors for MiniCRM.
 *
 * Provides REST API helpers for reading and updating feature flags in E2E tests.
 * Behaviors do NOT contain assertions (no expect() calls).
 *
 * MINCRM-463
 */

import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// API data types
// ---------------------------------------------------------------------------

/** Shape of a feature flag row returned from the API. */
export interface TestFeatureFlag {
  flag_key: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  role_overrides: Record<string, boolean> | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string;
  system_flag: boolean;
  active_user_count: number;
  enable_at: string | null;
  beta_user_count: number;
  rollout_percentage: number | null;
  rollout_stages: Array<{ percentage: number; scheduled_at: string }> | null;
  override_count: { force_enabled: number; force_disabled: number };
}

/** Shape of a beta user enrollment entry. */
export interface TestBetaUserEntry {
  id: string;
  user_id: string;
  name: string;
  email: string;
  added_at: string;
}

// ---------------------------------------------------------------------------
// REST API behaviors
// ---------------------------------------------------------------------------

/**
 * Lists all feature flags.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @returns Array of feature flag rows.
 */
export async function listFeatureFlags(restClient: RestClient): Promise<TestFeatureFlag[]> {
  const res = await restClient.get<{ flags: TestFeatureFlag[] }>('/api/v1/admin/feature-flags');
  return res.body.flags;
}

/**
 * Updates a feature flag's enabled state and/or role overrides.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param key - The flag key to update.
 * @param patch - The fields to update.
 * @returns The updated feature flag row.
 */
export async function updateFeatureFlag(
  restClient: RestClient,
  key: string,
  patch: {
    enabled: boolean;
    role_overrides?: Record<string, boolean> | null;
    enable_at?: string | null;
  },
): Promise<TestFeatureFlag> {
  const res = await restClient.patch<{ flag: TestFeatureFlag }>(
    `/api/v1/admin/feature-flags/${key}`,
    patch,
  );
  return res.body.flag;
}

/**
 * Enrolls a user in the beta for a feature flag.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param flagKey - The flag key.
 * @param userId - The user ID to enroll.
 * @returns The new enrollment entry.
 */
export async function enrollBetaUser(
  restClient: RestClient,
  flagKey: string,
  userId: string,
): Promise<TestBetaUserEntry> {
  const res = await restClient.post<{ user: TestBetaUserEntry }>(
    `/api/v1/admin/feature-flags/${flagKey}/beta-users`,
    { userId },
  );
  return res.body.user;
}

/**
 * Removes a user from the beta for a feature flag.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param flagKey - The flag key.
 * @param userId - The user ID to remove.
 */
export async function removeBetaUser(
  restClient: RestClient,
  flagKey: string,
  userId: string,
): Promise<void> {
  await restClient.delete(`/api/v1/admin/feature-flags/${flagKey}/beta-users/${userId}`);
}

/**
 * Returns the list of beta users enrolled for a feature flag.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param flagKey - The flag key.
 * @returns Array of beta user entries.
 */
export async function listBetaUsers(
  restClient: RestClient,
  flagKey: string,
): Promise<TestBetaUserEntry[]> {
  const res = await restClient.get<{ users: TestBetaUserEntry[] }>(
    `/api/v1/admin/feature-flags/${flagKey}/beta-users`,
  );
  return res.body.users;
}

/**
 * Returns the resolved feature flag map for the calling user.
 * { flagKey: boolean }
 */
export async function getMyFeatureFlags(restClient: RestClient): Promise<Record<string, boolean>> {
  const res = await restClient.get<{ flags: Record<string, boolean> }>('/api/v1/feature-flags/me');
  return res.body.flags;
}

// ---------------------------------------------------------------------------
// Rollout REST behaviors (MINCRM-490)
// ---------------------------------------------------------------------------

/**
 * Updates the rollout_percentage and/or rollout_stages for a flag.
 * The PATCH endpoint requires `enabled` — callers must supply the current
 * flag's enabled state alongside the rollout fields.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param flagKey - The flag key to update.
 * @param patch - Must include `enabled` plus any rollout fields to change.
 * @returns The updated feature flag row.
 */
export async function updateFeatureFlagRollout(
  restClient: RestClient,
  flagKey: string,
  patch: {
    enabled: boolean;
    rollout_percentage?: number | null;
    rollout_stages?: Array<{ percentage: number; scheduled_at: string }> | null;
  },
): Promise<TestFeatureFlag> {
  const res = await restClient.patch<{ flag: TestFeatureFlag }>(
    `/api/v1/admin/feature-flags/${flagKey}`,
    patch,
  );
  return res.body.flag;
}

// ---------------------------------------------------------------------------
// User override REST behaviors (MINCRM-492)
// ---------------------------------------------------------------------------

/** Shape of a per-user override entry returned from the API. */
export interface TestUserOverrideEntry {
  id: string;
  flag_key: string;
  user_id: string;
  name: string;
  email: string;
  override: 'force_enabled' | 'force_disabled';
  reason: string | null;
  added_at: string;
}

/**
 * Lists all per-user overrides for a feature flag.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param flagKey - The flag key to query.
 * @returns Array of override entries.
 */
export async function listUserOverrides(
  restClient: RestClient,
  flagKey: string,
): Promise<TestUserOverrideEntry[]> {
  const res = await restClient.get<{ overrides: TestUserOverrideEntry[] }>(
    `/api/v1/admin/feature-flags/${flagKey}/overrides`,
  );
  return res.body.overrides;
}

/**
 * Upserts a per-user override for a feature flag.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param flagKey - The flag key.
 * @param userId - The target user ID.
 * @param override - 'force_enabled' or 'force_disabled'.
 * @param reason - Optional reason string.
 * @returns The upserted override entry.
 */
export async function upsertUserOverride(
  restClient: RestClient,
  flagKey: string,
  userId: string,
  override: 'force_enabled' | 'force_disabled',
  reason?: string | null,
): Promise<TestUserOverrideEntry> {
  const res = await restClient.put<{ override: TestUserOverrideEntry }>(
    `/api/v1/admin/feature-flags/${flagKey}/overrides/${userId}`,
    { override, reason: reason ?? null },
  );
  return res.body.override;
}

/**
 * Deletes a per-user override for a feature flag.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param flagKey - The flag key.
 * @param userId - The target user ID.
 */
export async function deleteUserOverride(
  restClient: RestClient,
  flagKey: string,
  userId: string,
): Promise<void> {
  await restClient.delete(`/api/v1/admin/feature-flags/${flagKey}/overrides/${userId}`);
}

// ---------------------------------------------------------------------------
// Flag group REST behaviors (MINCRM-491)
// ---------------------------------------------------------------------------

/** Shape of a flag group row returned from the API. */
export interface TestFlagGroupRow {
  group_key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  enable_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string;
  member_count: number;
  beta_user_count: number;
}

/** Shape of a group beta user entry. */
export interface TestGroupBetaUserEntry {
  id: string;
  user_id: string;
  name: string;
  email: string;
  added_at: string;
}

/**
 * Creates a new flag group.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param input - group_key, label, description.
 * @returns The created group row.
 */
export async function createFlagGroup(
  restClient: RestClient,
  input: { group_key: string; label: string; description?: string },
): Promise<TestFlagGroupRow> {
  const res = await restClient.post<{ group: TestFlagGroupRow }>(
    '/api/v1/admin/feature-flags/groups',
    input,
  );
  return res.body.group;
}

/**
 * Updates a flag group.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param groupKey - The group key to update.
 * @param patch - Fields to update (enabled, label, description, enable_at).
 * @returns The updated group row.
 */
export async function updateFlagGroup(
  restClient: RestClient,
  groupKey: string,
  patch: {
    enabled?: boolean;
    label?: string;
    description?: string | null;
    enable_at?: string | null;
  },
): Promise<TestFlagGroupRow> {
  const res = await restClient.patch<{ group: TestFlagGroupRow }>(
    `/api/v1/admin/feature-flags/groups/${groupKey}`,
    patch,
  );
  return res.body.group;
}

/**
 * Deletes a flag group.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param groupKey - The group key to delete.
 */
export async function deleteFlagGroup(restClient: RestClient, groupKey: string): Promise<void> {
  await restClient.delete(`/api/v1/admin/feature-flags/groups/${groupKey}`);
}

/**
 * Enrolls a user in a flag group's beta list.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param groupKey - The group key.
 * @param userId - The user to enroll.
 * @returns The new enrollment entry.
 */
export async function enrollGroupBetaUser(
  restClient: RestClient,
  groupKey: string,
  userId: string,
): Promise<TestGroupBetaUserEntry> {
  const res = await restClient.post<{ user: TestGroupBetaUserEntry }>(
    `/api/v1/admin/feature-flags/groups/${groupKey}/beta-users`,
    { userId },
  );
  return res.body.user;
}

/**
 * Removes a user from a flag group's beta list.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param groupKey - The group key.
 * @param userId - The user ID to remove.
 */
export async function removeGroupBetaUser(
  restClient: RestClient,
  groupKey: string,
  userId: string,
): Promise<void> {
  await restClient.delete(`/api/v1/admin/feature-flags/groups/${groupKey}/beta-users/${userId}`);
}
