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
 *
 * `flags` is undefined until the query resolves. Callers must treat that as
 * "no feature is confirmed enabled" rather than as "everything is on" — see
 * useFeatureFlag below for why that direction is the safe one.
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
 *
 * **A feature is hidden until its flag is affirmatively confirmed on.** Unknown
 * is not "on": while the query is in flight, after it errors, and when the
 * server's map does not carry the key at all, `enabled` is `false`.
 *
 * This inverts the hook's original behavior, which returned `true` while loading
 * (so features would not "flash-hide") and `true` for an absent map or missing
 * key. Three problems with that, in increasing order of severity:
 *
 *  1. **It renders features the operator switched off.** Every flag-gated panel
 *     appeared on first paint regardless of its flag, then disappeared once the
 *     map arrived. The flash went in the wrong direction: users saw features
 *     they do not have, including ones deliberately disabled for their role.
 *  2. **It fails OPEN on error.** A failed or aborted flag request left `flags`
 *     undefined, which resolved to `true` — so a control whose entire job is
 *     keeping a feature hidden defaulted to showing it exactly when it could not
 *     verify anything. `?? true` on a missing key did the same for a flag the
 *     server has never heard of.
 *  3. **It made "unknown" and "on" indistinguishable in the DOM**, so nothing
 *     outside the app could tell them apart. That is what made F7-DH3 fail
 *     intermittently in CI under --workers=4 (run 30751352481): the deal-health
 *     panel rendered during the pre-resolution window and the assertion could
 *     not tell that from the flag genuinely being on. Three separate E2E wait
 *     strategies were attempted against it and none could work, because no wait
 *     can distinguish two states that produce identical output.
 *
 * Defaulting off makes all three go away at once, and it is the correct default
 * on its own merits: a feature flag is permission to show something, and absence
 * of permission is not permission.
 *
 * `isLoading` is still returned so callers that want a skeleton — rather than
 * the feature simply appearing when confirmed — can render one. Callers that
 * ignore it now get the safe behavior by default instead of the unsafe one.
 */
export function useFeatureFlag(key: FeatureFlagKey): { enabled: boolean; isLoading: boolean } {
  const { flags, isLoading } = useFeatureFlags();
  const enabled = flags?.[key] === true;
  return { enabled, isLoading };
}
