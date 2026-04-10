/**
 * Search controller — request/response shaping for the global search endpoint.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { globalSearch, SEARCH_MIN_LENGTH } from '../services/searchService.js';

/** Zod schema for the search query parameters */
const searchQuerySchema = z.object({
  q: z
    .string({ required_error: 'q is required' })
    .trim()
    .min(SEARCH_MIN_LENGTH, `Search query must be at least ${SEARCH_MIN_LENGTH} characters.`),
});

/**
 * GET /api/search?q=<term>
 *
 * Returns contacts, accounts, and deals matching the query string.
 * Requires authentication (handled by middleware in route file).
 *
 * @param req - Express request; expects `req.user` from auth middleware
 * @param res - Express response
 */
export async function globalSearchHandler(req: Request, res: Response): Promise<void> {
  const parsed = searchQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'QUERY_TOO_SHORT',
        message: `Search query must be at least ${SEARCH_MIN_LENGTH} characters.`,
      },
    });
    return;
  }

  const results = await globalSearch(parsed.data.q, {
    userId: req.user!.id,
    role: req.user!.role as 'admin' | 'rep',
  });

  res.json(results);
}
