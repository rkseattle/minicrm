/**
 * Activity routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage activities.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createActivityHandler,
  listActivitiesHandler,
  getActivityHandler,
  updateActivityHandler,
  deleteActivityHandler,
} from '../controllers/activityController.js';

const router = Router();

router.get('/', authenticate, asyncHandler(listActivitiesHandler));
router.post('/', authenticate, asyncHandler(createActivityHandler));
router.get('/:id', authenticate, asyncHandler(getActivityHandler));
router.patch('/:id', authenticate, asyncHandler(updateActivityHandler));
router.delete('/:id', authenticate, asyncHandler(deleteActivityHandler));

export default router;
