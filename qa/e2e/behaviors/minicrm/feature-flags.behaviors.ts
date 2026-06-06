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
  patch: { enabled: boolean; role_overrides?: Record<string, boolean> | null },
): Promise<TestFeatureFlag> {
  const res = await restClient.patch<{ flag: TestFeatureFlag }>(
    `/api/v1/admin/feature-flags/${key}`,
    patch,
  );
  return res.body.flag;
}
