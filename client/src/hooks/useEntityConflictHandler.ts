/**
 * useEntityConflictHandler — encapsulates the three-way optimistic-locking
 * conflict state and OPTIMISTIC_LOCK_CONFLICT error handling shared across
 * all four entity detail pages. (MINCRM-406)
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface UseEntityConflictHandlerOptions {
  /**
   * The key used to access the entity within the query cache data object.
   * e.g. 'contact' for { contact: ContactRow }, 'account' for { account: AccountRow }
   */
  entityCacheKey: string;
  entityQueryKey: readonly unknown[];
}

export interface EntityConflictHandler<TValues = Record<string, unknown>> {
  conflictBase: Record<string, unknown> | null;
  conflictTheirs: Record<string, unknown> | null;
  conflictPendingValues: TValues | null;
  /**
   * Call inside useMutation onError when the error code may be OPTIMISTIC_LOCK_CONFLICT.
   * Returns true if the error was a conflict (caller should return early); false otherwise.
   */
  handleConflict: (error: unknown, variables: { values: TValues }) => boolean;
  /** Resets all three conflict state vars to null */
  clearConflict: () => void;
}

type ApiError = {
  response?: {
    data?: {
      error?: {
        code?: string;
        current?: Record<string, unknown>;
      };
    };
  };
};

export function useEntityConflictHandler<TValues = Record<string, unknown>>({
  entityCacheKey,
  entityQueryKey,
}: UseEntityConflictHandlerOptions): EntityConflictHandler<TValues> {
  const queryClient = useQueryClient();
  const [conflictBase, setConflictBase] = useState<Record<string, unknown> | null>(null);
  const [conflictTheirs, setConflictTheirs] = useState<Record<string, unknown> | null>(null);
  const [conflictPendingValues, setConflictPendingValues] = useState<TValues | null>(null);

  function handleConflict(error: unknown, variables: { values: TValues }): boolean {
    const apiErr = error as ApiError;
    const code = apiErr.response?.data?.error?.code;
    if (code !== 'OPTIMISTIC_LOCK_CONFLICT') return false;

    const cached = queryClient.getQueryData<Record<string, Record<string, unknown>>>(
      entityQueryKey as unknown[],
    );
    setConflictBase(cached?.[entityCacheKey] ?? {});
    setConflictPendingValues(variables.values);
    setConflictTheirs(apiErr.response?.data?.error?.current ?? null);
    void queryClient.invalidateQueries({ queryKey: entityQueryKey as unknown[] });
    return true;
  }

  function clearConflict(): void {
    setConflictBase(null);
    setConflictTheirs(null);
    setConflictPendingValues(null);
  }

  return { conflictBase, conflictTheirs, conflictPendingValues, handleConflict, clearConflict };
}
