/**
 * Connected account controller — request/response shaping for mailbox endpoints.
 * No business logic here; all DB access goes through connectedAccountService.
 */

import type { Request, Response } from 'express';

import { z } from 'zod';

import {
  imapCredentialsSchema,
  oauthProviderSchema,
} from '@minicrm/shared/schemas/connectedAccountSchema.js';

import logger from '../logger.js';

import {
  consumeOAuthFlowState,
  createImapAccount,
  createOAuthFlowState,
  deleteConnectedAccount,
  getConnectedAccountInternal,
  listConnectedAccounts,
  updateAccountStatus,
  upsertOAuthAccount,
} from '../services/connectedAccountService.js';
import { testImapConnection } from '../services/imapConnectionService.js';
import {
  OAUTH_STATE_TTL_MS,
  buildAuthorizationRequest,
  exchangeAuthorizationCode,
  getOAuthCallbackUrl,
  isProviderConfigured,
} from '../services/oauthProviderService.js';

/** Path parameter guard — an unvalidated string reaching a uuid column throws a PG error. */
const accountIdSchema = z.string().uuid();

/** Shape every failure path returns, per the repo-wide error contract. */
function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

/**
 * GET /api/v1/connected-accounts
 * Returns the caller's own connected mailboxes. Credentials are never included.
 */
export async function listConnectedAccountsHandler(req: Request, res: Response): Promise<void> {
  const accounts = await listConnectedAccounts(req.user!.id);
  res.status(200).json({ accounts });
}

/**
 * POST /api/v1/connected-accounts
 * Tests IMAP credentials against the live server, then stores them only if they work.
 */
export async function createConnectedAccountHandler(req: Request, res: Response): Promise<void> {
  const parsed = imapCredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json(errorBody('VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid request'));
    return;
  }

  const attempt = await testImapConnection({
    host: parsed.data.host,
    port: parsed.data.port,
    username: parsed.data.username,
    password: parsed.data.password,
    secure: parsed.data.secure,
  });

  if (!attempt.ok) {
    res.status(400).json(errorBody(attempt.code, attempt.message));
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    const account = await createImapAccount(req.user!.id, parsed.data, actor);
    res.status(201).json({ account });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'CONNECTED_ACCOUNT_DUPLICATE') {
      res.status(409).json(errorBody(code, (err as Error).message));
      return;
    }
    throw err;
  }
}

/**
 * DELETE /api/v1/connected-accounts/:id
 * Removes one of the caller's own mailboxes.
 */
export async function deleteConnectedAccountHandler(req: Request, res: Response): Promise<void> {
  const idParse = accountIdSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json(errorBody('VALIDATION_ERROR', 'Invalid connected account ID'));
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const deleted = await deleteConnectedAccount(idParse.data, req.user!.id, actor);

  if (!deleted) {
    res.status(404).json(errorBody('NOT_FOUND', 'No such connected account'));
    return;
  }

  res.status(204).send();
}

/**
 * POST /api/v1/connected-accounts/:id/test
 * Re-tests a stored mailbox and records the outcome on the row.
 *
 * Always HTTP 200: a remote mail server's refusal is data about that server, not a
 * problem with this request. Matches the SMTP test endpoint's contract.
 */
export async function testConnectedAccountHandler(req: Request, res: Response): Promise<void> {
  const idParse = accountIdSchema.safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json(errorBody('VALIDATION_ERROR', 'Invalid connected account ID'));
    return;
  }

  const account = await getConnectedAccountInternal(idParse.data, req.user!.id);
  if (!account) {
    res.status(404).json(errorBody('NOT_FOUND', 'No such connected account'));
    return;
  }

  if (account.auth.kind !== 'imap') {
    res.status(200).json({ success: false, error: 'Testing this provider is not supported yet.' });
    return;
  }

  const attempt = await testImapConnection({
    host: account.auth.host,
    port: account.auth.port,
    username: account.auth.username,
    password: account.auth.password,
    secure: account.auth.secure,
  });

  await updateAccountStatus(
    account.id,
    req.user!.id,
    attempt.ok ? 'active' : 'error',
    attempt.ok ? null : attempt.message,
  );

  if (attempt.ok) {
    res.status(200).json({ success: true });
    return;
  }
  res.status(200).json({ success: false, error: attempt.message });
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

/** Where the browser lands after either leg of the flow, with a result code. */
const PROFILE_URL = `${process.env.APP_BASE_URL ?? 'http://localhost:5173'}/profile`;

/**
 * Result codes that may appear in a redirect URL.
 *
 * An allowlist, not a passthrough: an unrecognised failure becomes the generic code so a
 * library message or a provider banner can never reach the address bar.
 */
const SAFE_OAUTH_RESULT_CODES = new Set([
  'connected',
  'PROVIDER_NOT_CONFIGURED',
  'OAUTH_STATE_INVALID',
  'PROVIDER_NO_EMAIL',
  'FEATURE_DISABLED',
]);

function redirectToProfile(res: Response, code: string): void {
  const safe = SAFE_OAUTH_RESULT_CODES.has(code) ? code : 'OAUTH_FAILED';
  res.redirect(302, `${PROFILE_URL}?connect=${encodeURIComponent(safe)}`);
}

/**
 * GET /api/v1/connected-accounts/oauth/:provider/start
 * Redirects the browser to the provider's consent screen.
 *
 * Reached by a top-level navigation, so every rejection is a redirect carrying a safe
 * code — a JSON error body would render as a blank page of text with no way back.
 */
export async function startOAuthFlowHandler(req: Request, res: Response): Promise<void> {
  const providerParse = oauthProviderSchema.safeParse(req.params.provider);
  if (!providerParse.success) {
    redirectToProfile(res, 'OAUTH_FAILED');
    return;
  }
  const provider = providerParse.data;

  if (!isProviderConfigured(provider)) {
    redirectToProfile(res, 'PROVIDER_NOT_CONFIGURED');
    return;
  }

  try {
    const request = await buildAuthorizationRequest(provider);
    await createOAuthFlowState({
      state: request.state,
      userId: req.user!.id,
      provider,
      pkceVerifier: request.pkceVerifier,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });
    res.redirect(302, request.authorizationUrl);
  } catch (err) {
    logger.warn({ err, provider }, 'connectedAccountController: could not start OAuth flow');
    redirectToProfile(res, (err as { code?: string }).code ?? 'OAUTH_FAILED');
  }
}

/**
 * GET /api/v1/connected-accounts/oauth/:provider/callback
 * Completes the flow and stores the mailbox.
 *
 * Authorizes on the state row rather than the session: the row names which user began
 * this flow, where a cookie would only name whoever holds the browser now.
 */
export async function oauthCallbackHandler(req: Request, res: Response): Promise<void> {
  const providerParse = oauthProviderSchema.safeParse(req.params.provider);
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  if (!providerParse.success || !state) {
    redirectToProfile(res, 'OAUTH_STATE_INVALID');
    return;
  }

  // Consuming the row is what makes the state single-use: a replay finds nothing.
  const flow = await consumeOAuthFlowState(state);
  if (!flow || flow.provider !== providerParse.data) {
    redirectToProfile(res, 'OAUTH_STATE_INVALID');
    return;
  }

  try {
    const callbackUrl = `${getOAuthCallbackUrl(providerParse.data)}?${new URLSearchParams(
      req.query as Record<string, string>,
    ).toString()}`;

    const result = await exchangeAuthorizationCode(
      providerParse.data,
      callbackUrl,
      state,
      flow.pkceVerifier,
    );

    const actor = { id: flow.userId, name: 'OAuth connect' };
    const account = await upsertOAuthAccount(
      {
        userId: flow.userId,
        provider: providerParse.data,
        emailAddress: result.emailAddress,
        auth: {
          kind: 'oauth',
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
          expires_at: result.expiresAt,
        },
        grantedScopes: result.grantedScopes,
      },
      actor,
    );

    logger.info(
      { accountId: account.id, provider: providerParse.data },
      'connectedAccountController: mailbox connected',
    );
    redirectToProfile(res, 'connected');
  } catch (err) {
    logger.warn({ err }, 'connectedAccountController: OAuth callback failed');
    redirectToProfile(res, (err as { code?: string }).code ?? 'OAUTH_FAILED');
  }
}
