/**
 * Deal routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage deals.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createDealHandler,
  listDealsHandler,
  getDealHandler,
  updateDealHandler,
  deleteDealHandler,
} from '../controllers/dealController.js';

const router = Router();

router.get('/', authenticate, asyncHandler(listDealsHandler));
router.post('/', authenticate, asyncHandler(createDealHandler));
router.get('/:id', authenticate, asyncHandler(getDealHandler));
router.patch('/:id', authenticate, asyncHandler(updateDealHandler));
router.delete('/:id', authenticate, asyncHandler(deleteDealHandler));

export default router;
