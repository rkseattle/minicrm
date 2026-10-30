/**
 * Test-only email sync routes. app.ts mounts this router only under isAuthBypassEnv(), so
 * none of these exists in staging or production. Route definitions only; logic lives in
 * the controller.
 */

import { Router } from 'express';

import {
  runEmailSyncNowHandler,
  seedOAuthMailboxHandler,
} from '../controllers/testEmailSyncController.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCapability } from '../middleware/requireRole.js';
import {
  requireFeatureEnabled,
  requireFeatureEnabledOrgWide,
} from '../middleware/requireFeatureEnabled.js';

const router = Router();

// Per route, not router.use: this router shares /api/v1/test with routes it must not gate.
// Org-wide as well as per user: a per-user override must not reach these while sync is off.
const mailboxGuards = [
  authenticate,
  requireFeatureEnabledOrgWide('email_sync'),
  requireFeatureEnabled('email_sync'),
  requireCapability(Capability.ConnectedAccountsManage),
];

/**
 * POST /api/v1/test/connected-accounts/oauth — dev/test only.
 * Stores a Gmail or Microsoft mailbox for the caller without a consent screen, pointing at
 * whatever token the emulator was seeded with. Never available in production.
 */
// eslint-disable-next-line local-openapi/require-openapi-tag -- test-only route, never mounted in production
router.post('/connected-accounts/oauth', ...mailboxGuards, asyncHandler(seedOAuthMailboxHandler));

/**
 * POST /api/v1/test/email-sync/accounts/:id/run — dev/test only.
 * Syncs one of the caller's own mailboxes now, so an E2E run need not wait for a tick.
 * 403 while email sync is off, org-wide or for the caller; 404 for a mailbox that is not the
 * caller's or cannot sync; 409 while another run of it is in progress.
 */
// eslint-disable-next-line local-openapi/require-openapi-tag -- test-only route, never mounted in production
router.post('/email-sync/accounts/:id/run', ...mailboxGuards, asyncHandler(runEmailSyncNowHandler));

export default router;
