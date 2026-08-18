/**
 * SSO auth routes — SAML 2.0 / OIDC single sign-on.
 * Route definitions + @openapi JSDoc only — no logic, no service imports.
 *
 * Mounted at /api/v1/auth/sso in app.ts.
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  initiateSsoLogin,
  handleSsoCallback,
  getSamlMetadata,
} from '../controllers/ssoController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/auth/sso/login:
 *   get:
 *     tags: [SSO]
 *     operationId: initiateSsoLogin
 *     summary: Initiate SSO login — redirect to IdP
 *     description: >
 *       Reads the configured SSO protocol from system_settings, builds the
 *       appropriate IdP redirect (SAML AuthnRequest or OIDC authorization URL),
 *       sets a relay-state cookie for CSRF protection, and issues a 302 redirect.
 *       No authentication required.
 *     security: []
 *     responses:
 *       302:
 *         description: Redirect to the IdP login page
 *       400:
 *         description: SSO is not enabled or not configured
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/login', asyncHandler(initiateSsoLogin));

/**
 * @openapi
 * /api/v1/auth/sso/callback:
 *   get:
 *     tags: [SSO]
 *     operationId: handleOidcCallback
 *     summary: OIDC authorization code callback
 *     description: >
 *       Exchanges the OIDC authorization code for tokens, validates the ID token,
 *       resolves or JIT-provisions the user, issues a JWT cookie, and redirects to
 *       the application. On failure redirects to /login?sso_error=<code>.
 *       No authentication required.
 *     security: []
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirect to app on success, or /login?sso_error=<code> on failure
 *   post:
 *     tags: [SSO]
 *     operationId: handleSamlCallback
 *     summary: SAML POST binding callback
 *     description: >
 *       Validates the SAML assertion, resolves or JIT-provisions the user, issues a
 *       JWT cookie, and redirects to the application.
 *       No authentication required.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [SAMLResponse]
 *             properties:
 *               SAMLResponse:
 *                 type: string
 *                 description: Base64-encoded SAML assertion
 *               RelayState:
 *                 type: string
 *     responses:
 *       302:
 *         description: Redirect to app on success, or /login?sso_error=<code> on failure
 */
router.get('/callback', asyncHandler(handleSsoCallback));

/**
 * @openapi
 * /api/v1/auth/sso/callback#post:
 *   post:
 *     tags: [SSO]
 *     operationId: handleSamlCallbackPost
 *     summary: SAML POST binding callback (see GET variant for full docs)
 *     security: []
 *     responses:
 *       302:
 *         description: Redirect to app on success, or /login?sso_error=<code> on failure
 */
router.post('/callback', asyncHandler(handleSsoCallback));

/**
 * @openapi
 * /api/v1/auth/sso/metadata:
 *   get:
 *     tags: [SSO]
 *     operationId: getSamlSpMetadata
 *     summary: SAML SP metadata XML
 *     description: >
 *       Returns the SAML Service Provider metadata XML document. IdPs fetch this
 *       during initial setup to discover the SP entity ID, callback URL, and
 *       signing certificate. Public endpoint — no authentication required.
 *     security: []
 *     responses:
 *       200:
 *         description: SAML SP metadata XML
 *         content:
 *           application/xml:
 *             schema:
 *               type: string
 */
router.get('/metadata', asyncHandler(getSamlMetadata));

export default router;
