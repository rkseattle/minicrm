/**
 * Search controller — request/response shaping for the global search endpoint.
 */

import type { Request, Response } from 'express';
import { globalSearch, SEARCH_MIN_LENGTH } from '../services/searchService.js';

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
  const rawQuery = req.query.q;
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';

  if (query.length < SEARCH_MIN_LENGTH) {
    res.status(400).json({
      error: {
        code: 'QUERY_TOO_SHORT',
        message: `Search query must be at least ${SEARCH_MIN_LENGTH} characters.`,
      },
    });
    return;
  }

  const results = await globalSearch(query, {
    userId: req.user!.id,
    role: req.user!.role as 'admin' | 'rep',
  });

  res.json(results);
}
