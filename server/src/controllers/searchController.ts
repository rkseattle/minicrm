/**
 * Search controller — request/response shaping for the global search endpoint.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { typeErrorMessages } from '@minicrm/shared/schemas/typeErrorMessages.js';
import { globalSearch, SEARCH_MIN_LENGTH } from '../services/searchService.js';

/** Zod schema for the search query parameters */
const searchQuerySchema = z.object({
  q: z
    .string(typeErrorMessages({ required: 'q is required' }))
    .trim()
    .min(SEARCH_MIN_LENGTH, `Search query must be at least ${SEARCH_MIN_LENGTH} characters.`),
});

/**
 * GET /api/v1/search?q=<term>
 *
 * Returns contacts, accounts, deals, leads, and the caller's own email matching the query string.
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
    // Safe: authenticate runs before this handler and sets req.user.
    userId: req.user!.id,
    // Safe: as above.
    role: req.user!.role,
  });

  res.json(results);
}
