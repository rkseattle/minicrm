/**
 * Account routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage accounts.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createAccountHandler,
  listAccountsHandler,
  getAccountHandler,
  updateAccountHandler,
  deleteAccountHandler,
} from '../controllers/accountController.js';

const router = Router();

router.get('/', authenticate, asyncHandler(listAccountsHandler));
router.post('/', authenticate, asyncHandler(createAccountHandler));
router.get('/:id', authenticate, asyncHandler(getAccountHandler));
router.patch('/:id', authenticate, asyncHandler(updateAccountHandler));
router.delete('/:id', authenticate, asyncHandler(deleteAccountHandler));

export default router;
