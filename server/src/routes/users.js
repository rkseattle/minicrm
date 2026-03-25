/**
 * User management routes — admin-gated except for set-password.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  inviteUser,
  listUsers,
  updateUserRole,
  deactivateUser,
  reactivateUser,
  setPassword,
} from '../controllers/userController.js';

const router = Router();

/**
 * POST /api/users/set-password
 * Must be declared before the /:id routes so it is not treated as an ID param.
 * Unauthenticated — used by invited users to activate their account.
 */
router.post('/set-password', setPassword);

/** All routes below require authentication + admin role */
router.use(authenticate, requireRole('admin'));

/** GET /api/users — list all users */
router.get('/', listUsers);

/** POST /api/users/invite — create an invited user */
router.post('/invite', inviteUser);

/** PATCH /api/users/:id/role — change a user's role */
router.patch('/:id/role', updateUserRole);

/** PATCH /api/users/:id/deactivate — deactivate a user */
router.patch('/:id/deactivate', deactivateUser);

/** PATCH /api/users/:id/reactivate — reactivate a user */
router.patch('/:id/reactivate', reactivateUser);

export default router;
