/**
 * Shared pagination schema and types.
 * Used by both server (query param validation) and client (API response types).
 */

import { z } from 'zod';

/** Maximum number of records that may be requested in a single page */
export const PAGINATION_MAX_LIMIT = 100;

/** Default number of records returned when no limit is specified */
export const PAGINATION_DEFAULT_LIMIT = 50;

/**
 * Zod schema for pagination query parameters.
 * Coerces string query params to numbers and clamps to valid range.
 */
export const paginationParamsSchema = z.object({
  /** 1-based page number */
  page: z.coerce.number().int().min(1).default(1),
  /** Records per page; clamped to [1, PAGINATION_MAX_LIMIT] */
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
});

/** Validated pagination input */
export type PaginationParams = z.infer<typeof paginationParamsSchema>;

/**
 * Generic paginated response envelope returned by all list endpoints.
 *
 * @template T - The shape of each record in the `data` array
 */
export interface PaginatedResponse<T> {
  /** The page of records */
  data: T[];
  /** Total number of records matching the current filters (used to compute page count) */
  total: number;
  /** Current 1-based page number */
  page: number;
  /** Max records per page as requested */
  limit: number;
}
