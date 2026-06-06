/**
 * useFeatureFlag / useFeatureFlags hooks.
 * Resolve feature flag enabled state for the current user's role.
 * Backed by a single cached query against GET /api/v1/feature-flags/me.
 */

import { useQuery } from '@tanstack/react-query';
import { getMyFeatureFlags, MY_FEATURE_FLAGS_QUERY_KEY } from '@/api/featureFlags.js';
import type { FeatureFlagKey, MyFeatureFlagsResponse } from '@shared/schemas/featureFlagSchema.js';

/** How long the resolved flag map stays fresh before a background refetch. */
const FLAGS_STALE_TIME = 60_000;

/**
 * Returns the full resolved feature flag map for the current user.
 * While loading, all flags default to `true` so UI doesn't flash-hide features
 * that are about to be confirmed enabled.
 */
export function useFeatureFlags(): {
  flags: MyFeatureFlagsResponse | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: MY_FEATURE_FLAGS_QUERY_KEY,
    queryFn: getMyFeatureFlags,
    staleTime: FLAGS_STALE_TIME,
  });
  return { flags: data?.flags, isLoading };
}

/**
 * Returns the resolved enabled state for a single feature flag.
 * `isLoading` is true while the initial fetch is in flight — callers should
 * show a skeleton rather than hiding or showing the feature optimistically.
 */
export function useFeatureFlag(key: FeatureFlagKey): { enabled: boolean; isLoading: boolean } {
  const { flags, isLoading } = useFeatureFlags();
  // While loading, treat as enabled so content doesn't flash-disappear on load
  const enabled = isLoading ? true : (flags?.[key] ?? true);
  return { enabled, isLoading };
}
