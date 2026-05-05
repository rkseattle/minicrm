/**
 * usePagination — manages page and limit state for paginated list views.
 * Resetting `limit` automatically resets `page` to 1.
 */

import { useState } from 'react';
import { PAGINATION_DEFAULT_LIMIT } from '@shared/schemas/paginationSchema.js';

export interface UsePaginationResult {
  page: number;
  limit: number;
  setPage: (page: number) => void;
  handleLimitChange: (newLimit: number) => void;
}

export function usePagination(): UsePaginationResult {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGINATION_DEFAULT_LIMIT);

  function handleLimitChange(newLimit: number): void {
    setLimit(newLimit);
    setPage(1);
  }

  return { page, limit, setPage, handleLimitChange };
}
