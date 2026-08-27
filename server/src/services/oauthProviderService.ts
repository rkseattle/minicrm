/**
 * OAuth provider registry and authorization-code flow for connecting mailboxes.
 *
 * Follows ssoService's use of openid-client v6, with three deliberate differences,
 * because that flow is a tenant-wide public-client login and this is a per-user
 * confidential-client connect:
 *
 *   1. A client secret is sent — Google and Microsoft require one for web apps, where
 *      the SSO client is declared public.
 *   2. PKCE is on. It is mandatory for Microsoft's v2 endpoint and current IETF BCP for
 *      authorization-code clients; declining it in new code needs a reason.
 *   3. State binds the user. The SSO callback establishes who the user is, so an opaque
 *      nonce suffices there. Here the user is already authenticated at start and the
 *      callback must attach the mailbox to that same account — a cookie would name
 *      whoever holds the browser at callback time, which is how a mailbox ends up on the
 *      wrong account.
 */

import {
  ClientSecretPost,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomPKCECodeVerifier,
  randomState,
  refreshTokenGrant,
} from 'openid-client';

import type { OAuthProvider } from '@minicrm/shared/schemas/connectedAccountSchema.js';

import logger from '../logger.js';

/** Where the provider sends the browser back. Must reach the API server, not the client. */
const CALLBACK_BASE_URL =
  process.env.SSO_CALLBACK_BASE_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3001';

/** How long a started flow may sit before its state row is refused. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface ProviderDefinition {
  issuer: string;
  scopes: string[];
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
}

/**
 * Provider metadata. Credentials are read through thunks rather than captured at module
 * load so a test can set the environment after import, and so a missing variable surfaces
 * as PROVIDER_NOT_CONFIGURED at use rather than a boot crash.
 */
const PROVIDERS: Record<OAuthProvider, ProviderDefinition> = {
  google: {
    issuer: 'https://accounts.google.com',
    scopes: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    clientId: () => process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  },
  microsoft: {
    issuer: `https://login.microsoftonline.com/${process.env.MICROSOFT_OAUTH_TENANT ?? 'common'}/v2.0`,
    scopes: [
      'openid',
      'email',
      'offline_access',
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.Send',
    ],
    clientId: () => process.env.MICROSOFT_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
  },
};

/** Google's token revocation endpoint. Microsoft exposes no per-token equivalent. */
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** Bound on the revocation call, which runs post-commit and must not hang a request. */
const REVOKE_TIMEOUT_MS = 5_000;

/** Bound on a token refresh, which runs while its account row is locked. */
const REFRESH_TIMEOUT_MS = 10_000;

/**
 * Rejects if a promise outlives its budget.
 *
 * openid-client takes no AbortSignal on the grant helpers, so the request itself cannot
 * be cancelled — this bounds how long a caller waits, which is what matters when the
 * caller is holding a lock.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function getOAuthCallbackUrl(provider: OAuthProvider): string {
  return `${CALLBACK_BASE_URL}/api/v1/connected-accounts/oauth/${provider}/callback`;
}

/** True when both halves of a provider's credentials are present. */
export function isProviderConfigured(provider: OAuthProvider): boolean {
  const definition = PROVIDERS[provider];
  return Boolean(definition.clientId() && definition.clientSecret());
}

/** Everything a caller must persist to finish the flow the returned URL begins. */
export interface AuthorizationRequest {
  authorizationUrl: string;
  state: string;
  pkceVerifier: string;
}

async function configurationFor(
  provider: OAuthProvider,
): Promise<Awaited<ReturnType<typeof discovery>>> {
  const definition = PROVIDERS[provider];
  const clientId = definition.clientId();
  const clientSecret = definition.clientSecret();
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error(`${provider} OAuth is not configured`), {
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  }
  return discovery(new URL(definition.issuer), clientId, undefined, ClientSecretPost(clientSecret));
}

/**
 * Begins an authorization-code flow.
 *
 * @returns the provider URL to redirect to, plus the state and PKCE verifier the caller
 *   must store against the user so the callback can prove the flow is the same one.
 */
export async function buildAuthorizationRequest(
  provider: OAuthProvider,
): Promise<AuthorizationRequest> {
  const config = await configurationFor(provider);
  const pkceVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(pkceVerifier);
  const state = randomState();

  const authorizationUrl = buildAuthorizationUrl(config, {
    redirect_uri: getOAuthCallbackUrl(provider),
    scope: PROVIDERS[provider].scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Google returns a refresh token only on the first consent unless both are set.
    access_type: 'offline',
    prompt: 'consent',
  });

  return { authorizationUrl: authorizationUrl.href, state, pkceVerifier };
}

/** The provider's answer to a completed authorization. */
export interface AuthorizationResult {
  emailAddress: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  grantedScopes: string[];
}

/**
 * Exchanges the callback's code for tokens.
 *
 * @param callbackUrl - The full URL the provider redirected to, query string included.
 * @param expectedState - The state read from this flow's stored row.
 * @param pkceVerifier - The verifier stored when the flow began.
 */
export async function exchangeAuthorizationCode(
  provider: OAuthProvider,
  callbackUrl: string,
  expectedState: string,
  pkceVerifier: string,
): Promise<AuthorizationResult> {
  const config = await configurationFor(provider);

  const tokens = await authorizationCodeGrant(config, new URL(callbackUrl), {
    pkceCodeVerifier: pkceVerifier,
    expectedState,
  });

  const claims = tokens.claims();
  const emailAddress = typeof claims?.email === 'string' ? claims.email : null;
  if (!emailAddress) {
    throw Object.assign(new Error('Provider returned no email claim'), {
      code: 'PROVIDER_NO_EMAIL',
    });
  }

  return {
    emailAddress,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
    // What was granted, not what was asked for: a provider may narrow the set, and the
    // sync work needs to fail loudly rather than skip mail it cannot read.
    grantedScopes: tokens.scope ? tokens.scope.split(' ') : [],
  };
}

/** A refreshed token set. `refreshToken` is re-issued by providers that rotate it. */
export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

/**
 * Exchanges a refresh token for a new access token.
 *
 * Bounded, because the caller holds a row lock across this call — the lock is what stops
 * two refreshes from both spending a rotating refresh token, so it cannot be released
 * early, which makes an unbounded provider hang a held lock.
 */
export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
): Promise<RefreshedTokens> {
  const config = await configurationFor(provider);
  const tokens = await withTimeout(
    refreshTokenGrant(config, refreshToken),
    REFRESH_TIMEOUT_MS,
    'oauth token refresh',
  );

  return {
    accessToken: tokens.access_token,
    // Microsoft rotates the refresh token; Google returns none, leaving the old one valid.
    refreshToken: tokens.refresh_token ?? refreshToken,
    expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
  };
}

/**
 * Asks the provider to invalidate a token set.
 *
 * Best-effort by design: the caller has already deleted the row, so the user's intent is
 * satisfied. A provider outage must not strand them connected.
 */
export async function revokeProviderTokens(
  provider: OAuthProvider,
  refreshToken: string | null,
): Promise<void> {
  if (provider !== 'google' || !refreshToken) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVOKE_TIMEOUT_MS);
  try {
    await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      signal: controller.signal,
      redirect: 'manual',
    });
  } catch (err) {
    logger.warn({ err, provider }, 'oauthProviderService: token revocation failed');
  } finally {
    clearTimeout(timer);
  }
}
