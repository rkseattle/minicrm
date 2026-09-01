/**
 * Saves the signed-in user's navigation layout preference.
 *
 * The nav reads this value through NavLayoutContext, so the mutation seeds that cache
 * key on success rather than waiting for a refetch to bring it back.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setMyNavLayout, MY_NAV_LAYOUT_QUERY_KEY } from '@/api/users.js';
import { NAV_LAYOUT_QUERY_KEY } from '@/api/settings.js';
import type { NavLayout } from '@shared/schemas/settingsSchema.js';

export interface UseNavLayoutPreferenceResult {
  /** Persists the layout, or clears the personal preference when passed null. */
  save: (layout: NavLayout | null) => void;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  reset: () => void;
}

/**
 * @param options.onSaved - Runs after a successful save, for callers holding their own
 *   pending state. Clearing that state before the request settles discards the user's
 *   choice on failure and snaps the control back mid-flight.
 * @returns Handlers and status flags for the nav layout mutation.
 */
export function useNavLayoutPreference(
  options: { onSaved?: () => void } = {},
): UseNavLayoutPreferenceResult {
  const { onSaved } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (layout: NavLayout | null) => setMyNavLayout(layout),
    onSuccess: (saved) => {
      queryClient.setQueryData(MY_NAV_LAYOUT_QUERY_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: MY_NAV_LAYOUT_QUERY_KEY });
      // Clearing falls back to the workspace value, which may be up to five minutes
      // stale — refetch so the nav lands on what the admin has set now.
      if (saved.layout === null) {
        void queryClient.invalidateQueries({ queryKey: NAV_LAYOUT_QUERY_KEY });
      }
      onSaved?.();
    },
  });

  function save(layout: NavLayout | null): void {
    mutation.mutate(layout);
  }

  return {
    save,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    reset: mutation.reset,
  };
}
