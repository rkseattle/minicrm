/**
 * Contact routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage contacts.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createContactHandler,
  listContactsHandler,
  getContactHandler,
  updateContactHandler,
  deleteContactHandler,
  listContactDealsHandler,
} from '../controllers/contactController.js';

const router = Router();

router.get('/', authenticate, asyncHandler(listContactsHandler));
router.post('/', authenticate, asyncHandler(createContactHandler));
router.get('/:id', authenticate, asyncHandler(getContactHandler));
router.patch('/:id', authenticate, asyncHandler(updateContactHandler));
router.delete('/:id', authenticate, asyncHandler(deleteContactHandler));
router.get('/:id/deals', authenticate, asyncHandler(listContactDealsHandler));

export default router;
