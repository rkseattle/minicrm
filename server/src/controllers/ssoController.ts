/**
 * SSO controller — request/response shaping for SAML 2.0 / OIDC SSO. (MINCRM-399)
 * No business logic here; all protocol work goes through ssoService.
 *
 * The SSO flow is:
 *   1. GET /api/v1/auth/sso/login    → redirect to IdP
 *   2. GET|POST /api/v1/auth/sso/callback → validate assertion/code → issue JWT cookie → redirect to app
 *   3. GET /api/v1/auth/sso/metadata  → SAML SP metadata XML (public, for IdP registration)
 */

import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import {
  initiateSamlLogin,
  initiateOidcLogin,
  validateSamlResponse,
  validateOidcCallback,
  buildSamlSpMetadata,
  findOrProvisionSsoUser,
} from '../services/ssoService.js';
import { getSsoConfigInternal } from '../services/ssoSettingsService.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';
import logger from '../logger.js';
import {
  JWT_IDLE_EXPIRY_SECONDS,
  setSessionCookie,
  AUTH_COOKIE_ATTRIBUTES,
} from '../auth/sessionCookie.js';

/** App base URL for post-SSO redirect */
const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:5173';

/**
 * Name of the signed relay-state cookie used for CSRF protection.
 * HttpOnly, SameSite=Lax, Max-Age=5 minutes.
 */
const RELAY_STATE_COOKIE = 'sso_relay_state';

/** Relay state cookie lifetime — must outlive the round-trip to the IdP */
const RELAY_STATE_MAX_AGE_MS = 5 * 60 * 1000;

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/sso/login
 * Initiates the SSO login flow by redirecting to the configured IdP.
 * Protocol (SAML vs OIDC) is determined from system_settings.
 */
export async function initiateSsoLogin(req: Request, res: Response): Promise<void> {
  let result: { redirectUrl: string; relayState: string };
  try {
    const config = await getSsoConfigInternal();
    if (!config.enabled) {
      res.status(400).json({ error: { code: 'SSO_NOT_ENABLED', message: 'SSO is not enabled' } });
      return;
    }

    if (config.protocol === 'saml') {
      result = await initiateSamlLogin();
    } else if (config.protocol === 'oidc') {
      result = await initiateOidcLogin();
    } else {
      res.status(400).json({
        error: { code: 'SSO_NOT_CONFIGURED', message: 'SSO protocol is not configured' },
      });
      return;
    }
  } catch (err) {
    logger.error({ err }, 'ssoController: failed to initiate SSO login');
    res
      .status(500)
      .json({ error: { code: 'SSO_INITIATION_FAILED', message: 'Failed to initiate SSO login' } });
    return;
  }

  // Store relay state in a signed httpOnly cookie for CSRF validation on callback.
  res.cookie(RELAY_STATE_COOKIE, result.relayState, {
    ...AUTH_COOKIE_ATTRIBUTES,
    maxAge: RELAY_STATE_MAX_AGE_MS,
  });

  res.redirect(302, result.redirectUrl);
}

/**
 * POST /api/v1/auth/sso/callback  (SAML POST binding)
 * GET  /api/v1/auth/sso/callback  (OIDC authorization code)
 *
 * Validates the IdP response, resolves/provisions the user, and issues a JWT cookie.
 * On success redirects to the app. On failure redirects to /login?sso_error=<code>.
 */
export async function handleSsoCallback(req: Request, res: Response): Promise<void> {
  const config = await getSsoConfigInternal().catch((err) => {
    logger.error({ err }, 'ssoController: failed to read SSO config during callback');
    return null;
  });

  if (!config?.enabled) {
    res.redirect(302, `${APP_BASE_URL}/login?sso_error=SSO_NOT_ENABLED`);
    return;
  }

  // Known domain error codes thrown by ssoService — safe to forward to the browser.
  // All other exceptions are mapped to SSO_CALLBACK_FAILED to avoid leaking
  // library internals (stack paths, assertion XML, IdP URLs) via the redirect URL.
  const SAFE_SSO_ERROR_CODES = new Set([
    'SSO_NOT_CONFIGURED',
    'SSO_MISSING_RESPONSE',
    'SSO_CSRF_MISMATCH',
    'SSO_EMPTY_PROFILE',
    'SSO_MISSING_SUBJECT',
    'SSO_MISSING_EMAIL',
    'SSO_EMPTY_CLAIMS',
    'SSO_CERTIFICATE_REQUIRED',
    'SSO_USER_INACTIVE',
    'SSO_PROVISION_FAILED',
  ]);

  const toSafeCode = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : '';
    return SAFE_SSO_ERROR_CODES.has(msg) ? msg : 'SSO_CALLBACK_FAILED';
  };

  let claims: Awaited<ReturnType<typeof validateSamlResponse>>;
  try {
    if (config.protocol === 'saml') {
      const samlResponse = req.body?.SAMLResponse as string | undefined;
      if (!samlResponse) {
        res.redirect(302, `${APP_BASE_URL}/login?sso_error=SSO_MISSING_RESPONSE`);
        return;
      }

      // CSRF protection: verify the RelayState in the POST body matches the
      // relay-state cookie set during initiation.
      const cookieRelayState = req.cookies?.[RELAY_STATE_COOKIE] as string | undefined;
      const bodyRelayState = req.body?.RelayState as string | undefined;
      if (!cookieRelayState || !bodyRelayState || cookieRelayState !== bodyRelayState) {
        res.redirect(302, `${APP_BASE_URL}/login?sso_error=SSO_CSRF_MISMATCH`);
        return;
      }

      claims = await validateSamlResponse(samlResponse);
    } else if (config.protocol === 'oidc') {
      // packedRelayState contains "<state>:<nonce>" — validateOidcCallback unpacks both.
      const packedRelayState = req.cookies?.[RELAY_STATE_COOKIE] as string | undefined;
      if (!packedRelayState) {
        res.redirect(302, `${APP_BASE_URL}/login?sso_error=SSO_CSRF_MISMATCH`);
        return;
      }

      // Build the full callback URL including query params for openid-client.
      const callbackUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      claims = await validateOidcCallback(callbackUrl, packedRelayState);
    } else {
      res.redirect(302, `${APP_BASE_URL}/login?sso_error=SSO_NOT_CONFIGURED`);
      return;
    }
  } catch (err) {
    logger.warn({ err }, 'ssoController: SSO callback validation failed');
    res.redirect(302, `${APP_BASE_URL}/login?sso_error=${toSafeCode(err)}`);
    return;
  }

  // Clear relay-state cookie — single use.
  // Same attribute set it was written with — a clearCookie whose attributes
  // differ leaves this single-use CSRF value in the jar, available for replay.
  res.clearCookie(RELAY_STATE_COOKIE, AUTH_COOKIE_ATTRIBUTES);

  let user: Awaited<ReturnType<typeof findOrProvisionSsoUser>>;
  try {
    // Non-null assertion: config.protocol is 'saml'|'oidc' by this point.
    user = await findOrProvisionSsoUser(config.protocol!, claims);
  } catch (err) {
    logger.warn({ err, email: claims.email }, 'ssoController: SSO user provisioning failed');
    res.redirect(302, `${APP_BASE_URL}/login?sso_error=${toSafeCode(err)}`);
    return;
  }

  if (user.status !== 'active') {
    res.redirect(302, `${APP_BASE_URL}/login?sso_error=SSO_USER_INACTIVE`);
    return;
  }

  // Issue the same JWT the password-login flow produces. (MINCRM-365)
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    login_at: nowSeconds,
  };

  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET ?? '', {
    expiresIn: JWT_IDLE_EXPIRY_SECONDS,
  });

  setSessionCookie(res, token);

  void writeAuditEntryBestEffort({
    recordType: 'user',
    recordId: user.id,
    recordName: user.name,
    eventType: 'sso_login',
    changedById: user.id,
    changedByName: user.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write SSO login audit entry'));

  res.redirect(302, `${APP_BASE_URL}/`);
}

/**
 * GET /api/v1/auth/sso/metadata
 * Returns the SAML SP metadata XML for IdP registration.
 * Public endpoint — no authentication required.
 */
export async function getSamlMetadata(_req: Request, res: Response): Promise<void> {
  try {
    const xml = await buildSamlSpMetadata();
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(xml);
  } catch (err) {
    logger.error({ err }, 'ssoController: failed to build SAML SP metadata');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to generate SP metadata' },
    });
  }
}
