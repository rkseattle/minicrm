/**
 * Connected account controller — request/response shaping for mailbox endpoints.
 * No business logic here; all DB access goes through connectedAccountService.
 */

import type { Request, Response } from 'express';

import type { AuditActor } from '../services/auditService.js';

import { z } from 'zod';

import {
  CONNECTION_FAILED,
  imapCredentialsSchema,
  oauthProviderSchema,
  UNTESTABLE_PROVIDER,
} from '@minicrm/shared/schemas/connectedAccountSchema.js';

import logger from '../logger.js';
import { profileRedirectUrl } from '../utils/oauthRedirect.js';

import {
  consumeOAuthFlowState,
  createImapAccount,
  createOAuthFlowState,
  deleteConnectedAccount,
  type ConnectedAccountInternal,
  getConnectedAccountInternal,
  getUsableAccessToken,
  listConnectedAccounts,
  updateAccountStatus,
  upsertOAuthAccount,
} from '../services/connectedAccountService.js';
import { PROVIDER_AUTH_EXPIRED, testImapConnection } from '../services/imapConnectionService.js';
import { REJECTED_CREDENTIAL_MESSAGE, testGmailAccess } from '../services/mail/gmailProvider.js';
import type { MailboxTestResult } from '../services/mail/mailProvider.js';
import {
  OAUTH_STATE_TTL_MS,
  buildAuthorizationRequest,
  exchangeAuthorizationCode,
  getOAuthCallbackUrl,
  isProviderConfigured,
  refreshAccessToken,
  revokeProviderTokens,
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

  // After the commit and never awaited, like every other third-party call in this repo:
  // the row is already gone, so the user's intent is satisfied, and a provider outage
  // must not fail a disconnect or hold a connection open while the request waits.
  const oauthProvider = oauthProviderSchema.safeParse(deleted.provider);
  if (deleted.auth?.kind === 'oauth' && oauthProvider.success) {
    void revokeProviderTokens(oauthProvider.data, deleted.auth.refresh_token);
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

  // A provider with no test of its own is reported without touching the row: writing
  // 'error' would flip a healthy mailbox to a badge nothing ever clears, since no sync
  // runs for a provider that has no driver.
  if (account.auth.kind === 'oauth' && account.provider !== 'google') {
    res.status(200).json({ success: false, error: UNTESTABLE_PROVIDER });
    return;
  }

  const attempt =
    account.auth.kind === 'imap'
      ? await testImapConnection({
          host: account.auth.host,
          port: account.auth.port,
          username: account.auth.username,
          password: account.auth.password,
          secure: account.auth.secure,
        })
      : // Refreshed first: a mailbox retires after hours of failures, so the token it
        // stored is reliably expired by the time a user clicks Test — probing it raw
        // would fail exactly the accounts this endpoint exists to rescue.
        await testStoredGmailCredential(account, { id: req.user!.id, name: req.user!.name });

  await updateAccountStatus(
    account.id,
    req.user!.id,
    attempt.ok ? 'active' : 'error',
    // The code, not the message: the panel translates this column, so prose would
    // arrive as a key no locale file matches and degrade to a generic reason.
    attempt.ok ? null : attempt.code,
  );

  if (attempt.ok) {
    res.status(200).json({ success: true });
    return;
  }
  res.status(200).json({ success: false, error: attempt.code });
}

/**
 * Refreshes a Gmail mailbox's token, then asks whether it can still read mail.
 *
 * The refresh and the probe live in different modules on purpose — one owns the row lock,
 * the other owns Google's API — so this is where they meet.
 */
async function testStoredGmailCredential(
  account: ConnectedAccountInternal,
  actor: AuditActor,
): Promise<MailboxTestResult> {
  let accessToken: string | null;
  try {
    accessToken = await getUsableAccessToken(account.id, account.userId, actor, refreshAccessToken);
  } catch (err) {
    // The refresh rethrows anything it cannot call a dead grant, which is right for the
    // scheduler — its backoff needs the throw. On this path it would be a 500 on a handler
    // documented to always answer 200, and would skip the status write that a retired
    // mailbox depends on to recover.
    logger.warn({ err, accountId: account.id }, 'connectedAccount: Gmail refresh failed on test');
    return { ok: false, code: CONNECTION_FAILED, message: 'Could not reach Gmail.' };
  }
  if (accessToken === null) {
    return { ok: false, code: PROVIDER_AUTH_EXPIRED, message: REJECTED_CREDENTIAL_MESSAGE };
  }
  return testGmailAccess(accessToken, account.grantedScopes);
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

function redirectToProfile(res: Response, code: string): void {
  res.redirect(302, profileRedirectUrl(code));
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

  // Both halves are required, and they guard opposite directions. The state row stops a
  // mailbox landing on whoever holds the browser at callback time; this stops the mirror
  // case, where someone who obtained a victim's state — it travels in a redirect URL, so
  // it reaches browser history, Referer headers, and proxy logs — replays it from their
  // own session to graft their mailbox onto the victim's account.
  if (flow.userId !== req.user!.id) {
    logger.warn(
      { flowUserId: flow.userId, sessionUserId: req.user!.id },
      'connectedAccountController: OAuth state replayed from a different session',
    );
    redirectToProfile(res, 'OAUTH_STATE_INVALID');
    return;
  }

  try {
    // Safe despite qs yielding string | string[]: an array stringifies to "a,b", and
    // openid-client re-validates state and code against the values we stored anyway.
    const callbackUrl = `${getOAuthCallbackUrl(providerParse.data)}?${new URLSearchParams(
      req.query as Record<string, string>,
    ).toString()}`;

    const result = await exchangeAuthorizationCode(
      providerParse.data,
      callbackUrl,
      state,
      flow.pkceVerifier,
    );

    const actor = { id: req.user!.id, name: req.user!.name };
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
