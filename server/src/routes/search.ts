/**
 * Search routes — global cross-entity search endpoint. Requires authentication.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { globalSearchHandler } from '../controllers/searchController.js';

const router = Router();

/**
 * @openapi
 * /api/search:
 *   get:
 *     tags: [Search]
 *     operationId: globalSearch
 *     summary: Cross-entity search
 *     description: >
 *       Searches contacts, accounts, and deals in parallel for the given query string.
 *       Returns up to 10 results per entity type. Case-insensitive, partial-word matching.
 *       Admins see all records; reps see only records they own.
 *       Minimum query length: 2 characters.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Search term (minimum 2 characters)
 *     responses:
 *       200:
 *         description: Search results grouped by entity type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contacts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       first_name: { type: string }
 *                       last_name: { type: string }
 *                       email: { type: string }
 *                 accounts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       name: { type: string }
 *                 deals:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       name: { type: string }
 *                       stage: { type: string }
 *       400:
 *         description: Query too short
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: QUERY_TOO_SHORT
 *                 message: Search query must be at least 2 characters.
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 */
router.get('/', authenticate, asyncHandler(globalSearchHandler));

export default router;
