/**
 * Settings routes.
 * GET is public (needed on app load before auth).
 * PATCH requires authentication + admin role.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getDefaultLanguageHandler,
  setDefaultLanguageHandler,
} from '../controllers/settingsController.js';

const router = Router();

/** GET /api/settings/default-language — public */
router.get('/default-language', asyncHandler(getDefaultLanguageHandler));

/** PATCH /api/settings/default-language — admin only */
router.patch(
  '/default-language',
  authenticate,
  requireRole('admin'),
  asyncHandler(setDefaultLanguageHandler),
);

export default router;
