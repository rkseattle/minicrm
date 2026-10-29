/**
 * Contracts for the test-only email sync routes, which exist only under development and
 * test so an E2E run can seed an OAuth mailbox and sync one on demand.
 */

import { z } from 'zod';

import { MAX_EMAIL_LENGTH, oauthProviderSchema } from './connectedAccountSchema.js';

/** Longest bearer token the emulator is handed; real provider tokens are far shorter. */
const MAX_ACCESS_TOKEN_LENGTH = 4096;

/** Body of POST /api/v1/test/connected-accounts/oauth. */
export const seedOAuthMailboxSchema = z
  .object({
    provider: oauthProviderSchema,
    email_address: z.string().email().max(MAX_EMAIL_LENGTH),
    access_token: z.string().min(1).max(MAX_ACCESS_TOKEN_LENGTH),
  })
  .strict();

export type SeedOAuthMailboxInput = z.infer<typeof seedOAuthMailboxSchema>;

/** Path params of POST /api/v1/test/email-sync/accounts/:id/run. */
export const syncNowParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Response of POST /api/v1/test/email-sync/accounts/:id/run.
 *
 * A provider failure is an outcome, not an error: it is recorded on the mailbox as a
 * scheduled tick would record it, and `error_code` is the status detail that names it.
 */
export const syncNowResponseSchema = z.object({
  outcome: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('synced'),
      messages_stored: z.number().int().min(0),
      has_more: z.boolean(),
      cursor_invalid: z.boolean(),
    }),
    z.object({ status: z.literal('failed'), error_code: z.string() }),
  ]),
});

export type SyncNowResponse = z.infer<typeof syncNowResponseSchema>;
