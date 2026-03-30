/**
 * User management routes — admin-gated except for set-password.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  inviteUser,
  listActiveUsersHandler,
  listUsers,
  updateUserRole,
  deactivateUser,
  reactivateUser,
  setPassword,
  adminSetPassword,
} from '../controllers/userController.js';

const router = Router();

/**
 * POST /api/users/set-password
 * Must be declared before the /:id routes so it is not treated as an ID param.
 * Unauthenticated — used by invited users to activate their account.
 */
router.post('/set-password', asyncHandler(setPassword));

/**
 * GET /api/users/active
 * Must be declared before the admin-gated router.use() block so it is not
 * subject to the requireRole('admin') check. Requires authentication only.
 */
router.get('/active', authenticate, asyncHandler(listActiveUsersHandler));

/** All routes below require authentication + admin role */
router.use(authenticate, requireRole('admin'));

/** GET /api/users — list all users */
router.get('/', asyncHandler(listUsers));

/** POST /api/users/invite — create an invited user */
router.post('/invite', asyncHandler(inviteUser));

/** PATCH /api/users/:id/role — change a user's role */
router.patch('/:id/role', asyncHandler(updateUserRole));

/** PATCH /api/users/:id/deactivate — deactivate a user */
router.patch('/:id/deactivate', asyncHandler(deactivateUser));

/** PATCH /api/users/:id/reactivate — reactivate a user */
router.patch('/:id/reactivate', asyncHandler(reactivateUser));

/** POST /api/users/:id/admin-set-password — admin sets a user's password directly */
router.post('/:id/admin-set-password', asyncHandler(adminSetPassword));

export default router;
