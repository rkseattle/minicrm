/**
 * Dashboard routes — all endpoints require authentication.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getDashboardSummaryHandler } from '../controllers/dashboardController.js';

const router = Router();

router.get('/summary', authenticate, asyncHandler(getDashboardSummaryHandler));

export default router;
