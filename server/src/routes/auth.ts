/**
 * Auth routes — login, logout, and current-user.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { login, logout, me } from '../controllers/authController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

/** POST /api/auth/login — authenticate with email + password */
router.post('/login', asyncHandler(login));

/** POST /api/auth/logout — clear the auth cookie */
router.post('/logout', logout);

/** GET /api/auth/me — return the currently authenticated user */
router.get('/me', authenticate, asyncHandler(me));

export default router;
