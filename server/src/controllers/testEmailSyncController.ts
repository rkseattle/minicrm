/**
 * Test-only email sync handlers, reachable only where the routes are mounted: development
 * and test. They let an E2E run do what a person and the scheduler otherwise would — grant
 * an OAuth mailbox and wait for a tick — on demand.
 */

import type { Request, Response } from 'express';

import {
  seedOAuthMailboxSchema,
  syncNowParamsSchema,
  type SyncNowResponse,
} from '@minicrm/shared/schemas/testEmailSyncSchema.js';
import { upsertOAuthAccount } from '../services/connectedAccountService.js';
import {
  SCHEDULER_RUNNING,
  SYNC_IN_PROGRESS,
  syncAccountNow,
  type SyncNowResult,
} from '../services/emailSyncService.js';
import { requestedScopes } from '../services/oauthProviderService.js';
import { errorBody } from '../utils/errorBody.js';
import { thrownCode } from '../utils/errorCode.js';
import { respondValidationError } from '../utils/validationError.js';

/**
 * POST /api/v1/test/connected-accounts/oauth
 * Stores a Gmail or Graph mailbox for the caller as a completed consent would, with the
 * scopes real consent requests, a token that never expires, and no refresh token to revoke.
 */
export async function seedOAuthMailboxHandler(req: Request, res: Response): Promise<void> {
  const parsed = seedOAuthMailboxSchema.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }

  // Safe: authenticate runs first on this router and always sets req.user.
  const user = req.user!;
  const account = await upsertOAuthAccount(
    {
      userId: user.id,
      provider: parsed.data.provider,
      emailAddress: parsed.data.email_address,
      auth: {
        kind: 'oauth',
        access_token: parsed.data.access_token,
        refresh_token: null,
        expires_at: null,
      },
      grantedScopes: [...requestedScopes(parsed.data.provider)],
    },
    { id: user.id, name: user.name },
  );
  res.status(201).json({ account });
}

/**
 * POST /api/v1/test/email-sync/accounts/:id/run
 * Runs one scheduler tick's worth of sync for one of the caller's own mailboxes.
 */
export async function runEmailSyncNowHandler(req: Request, res: Response): Promise<void> {
  const parsed = syncNowParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }

  // Safe: authenticate runs first on this router and always sets req.user.
  const userId = req.user!.id;
  let result: SyncNowResult | null;
  try {
    result = await syncAccountNow(parsed.data.id, userId);
  } catch (err) {
    const code = thrownCode(err);
    if (code === SYNC_IN_PROGRESS) {
      res.status(409).json(errorBody(SYNC_IN_PROGRESS, 'This mailbox is already syncing.'));
      return;
    }
    if (code === SCHEDULER_RUNNING) {
      res
        .status(409)
        .json(
          errorBody(SCHEDULER_RUNNING, 'Run-now needs EMAIL_SYNC_SCHEDULER=off on the server.'),
        );
      return;
    }
    throw err;
  }

  if (!result) {
    res.status(404).json(errorBody('NOT_FOUND', 'No mailbox of yours with that id can sync now'));
    return;
  }

  res.status(200).json(toSyncNowResponse(result));
}

/** The wire form of one run-now result. */
export function toSyncNowResponse(result: SyncNowResult): SyncNowResponse {
  return result.status === 'synced'
    ? {
        outcome: {
          status: 'synced',
          messages_stored: result.outcome.messagesStored,
          has_more: result.outcome.hasMore,
          cursor_invalid: result.outcome.cursorInvalid,
        },
      }
    : { outcome: { status: 'failed', error_code: result.errorCode } };
}
