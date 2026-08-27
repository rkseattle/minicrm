/**
 * Connected account routes — per-user linked mailboxes.
 * Route definitions and OpenAPI annotations only; logic lives in the controller.
 */

import { Router } from 'express';
import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

import {
  createConnectedAccountHandler,
  deleteConnectedAccountHandler,
  listConnectedAccountsHandler,
  oauthCallbackHandler,
  startOAuthFlowHandler,
  testConnectedAccountHandler,
} from '../controllers/connectedAccountController.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCapability } from '../middleware/requireRole.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { profileRedirectUrl } from '../utils/oauthRedirect.js';
import { isAuthBypassEnv } from '../utils/nodeEnv.js';

const router = Router();

const isE2E = isAuthBypassEnv() && (process.env.NODE_ENV === 'test' || process.env.E2E === 'true');
const shouldSkip = (): boolean => isE2E && process.env.TEST_RATE_LIMIT !== 'true';

/**
 * 20 outbound dial attempts per user per 15 minutes.
 *
 * Both routes below open a TCP/TLS connection to a host the caller chooses. The SSRF
 * guard keeps that off the internal network, but nothing otherwise stops an authenticated
 * rep using this instance to probe or flood *external* hosts at request rate. Keyed by
 * user rather than IP, since every caller here is authenticated and a shared office IP
 * would otherwise throttle a whole team.
 */
const outboundDialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anonymous',
  skip: shouldSkip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many connection attempts, please try again later.',
    },
  },
});

/**
 * Wraps a guard so its JSON rejection becomes a redirect to the profile page.
 *
 * The OAuth legs are entered by top-level browser navigation, where a middleware's
 * `{"error":{"code":"AUTH_MISSING_TOKEN"}}` body renders as a page of text with no way
 * back — a real outcome for anyone whose idle window lapsed while the panel sat open.
 * The guards themselves still run unchanged: `req.user` is assigned nowhere but
 * `authenticate`, and the state row has to bind to a real user.
 */
function redirectRejectionsToProfile(guard: RequestHandler, code: string): RequestHandler {
  return (req, res, next) => {
    // Intercepting json() rather than probing status(): a guard rejects by writing a
    // body, so this catches every rejection path including ones added later.
    const sendJson = res.json.bind(res);
    const restore = (): void => {
      res.json = sendJson;
    };

    res.json = (body: unknown) => {
      restore();
      if (res.statusCode >= 400) {
        res.redirect(302, profileRedirectUrl(code));
        return res;
      }
      return sendJson(body);
    };

    // Unconditional, because the override is only self-clearing on the path where the
    // guard rejects. When it passes, the override would otherwise outlive it for the
    // whole request and rewrite the error handler's own 500 or 503 as a permission
    // redirect — telling a user they lack access when the database is down.
    const proceed = (err?: unknown): void => {
      restore();
      next(err);
    };

    void Promise.resolve(guard(req, res, proceed)).catch(proceed);
  };
}

/** Both OAuth legs are entered by top-level navigation, so a JSON body would render as the page. */
const authenticateOrRedirect = redirectRejectionsToProfile(authenticate, 'SESSION_EXPIRED');
const requireOAuthCapability = redirectRejectionsToProfile(
  requireCapability(Capability.ConnectedAccountsManage),
  'INSUFFICIENT_CAPABILITY',
);
const requireOAuthFeature = redirectRejectionsToProfile(
  requireFeatureEnabled('email_sync'),
  'FEATURE_DISABLED',
);

/**
 * @openapi
 * /api/v1/connected-accounts/oauth/{provider}/start:
 *   get:
 *     tags: [Connected Accounts]
 *     operationId: startConnectedAccountOAuth
 *     summary: Begin connecting a Google or Microsoft mailbox
 *     description: >
 *       Redirects the browser to the provider's consent screen. Entered by top-level
 *       navigation, so every outcome — including an expired session or an unconfigured
 *       provider — is a 302 back to the profile page carrying a result code, never a JSON
 *       error body.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [google, microsoft] }
 *     responses:
 *       302:
 *         description: Redirect to the provider, or back to the profile page with a result code
 */
router.get(
  '/oauth/:provider/start',
  authenticateOrRedirect,
  requireOAuthFeature,
  requireOAuthCapability,
  asyncHandler(startOAuthFlowHandler),
);

/**
 * @openapi
 * /api/v1/connected-accounts/oauth/{provider}/callback:
 *   get:
 *     tags: [Connected Accounts]
 *     operationId: completeConnectedAccountOAuth
 *     summary: Complete a mailbox connection
 *     description: >
 *       Exchanges the authorization code for tokens and stores the mailbox against the
 *       user who started the flow. Authorization rests on the single-use state row, which
 *       records that user — a session cookie names only whoever holds the browser now.
 *       Always redirects back to the profile page with a result code.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [google, microsoft] }
 *       - in: query
 *         name: code
 *         schema: { type: string }
 *       - in: query
 *         name: state
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       302:
 *         description: Redirect to the profile page with a result code
 */
router.get(
  '/oauth/:provider/callback',
  authenticateOrRedirect,
  requireOAuthFeature,
  requireOAuthCapability,
  asyncHandler(oauthCallbackHandler),
);

router.use(authenticate);
router.use(requireFeatureEnabled('email_sync'));
router.use(requireCapability(Capability.ConnectedAccountsManage));

/**
 * @openapi
 * /api/v1/connected-accounts:
 *   get:
 *     tags: [Connected Accounts]
 *     operationId: listConnectedAccounts
 *     summary: List your connected mailboxes
 *     description: >
 *       Returns the calling user's own connected mailboxes. Stored credentials are never
 *       included in the response for any provider.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The caller's connected mailboxes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accounts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       provider: { type: string, enum: [google, microsoft, imap] }
 *                       email_address: { type: string }
 *                       granted_scopes: { type: array, items: { type: string } }
 *                       status: { type: string, enum: [active, error, disconnected] }
 *                       status_detail: { type: string, nullable: true }
 *                       last_sync_at: { type: string, format: date-time, nullable: true }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/', asyncHandler(listConnectedAccountsHandler));

/**
 * @openapi
 * /api/v1/connected-accounts:
 *   post:
 *     tags: [Connected Accounts]
 *     operationId: createConnectedAccount
 *     summary: Connect a mailbox with IMAP credentials
 *     description: >
 *       Tests the supplied credentials against the mail server and stores them only if the
 *       connection succeeds. The password is encrypted at rest and never returned.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email_address, host, port, username, password]
 *             properties:
 *               email_address: { type: string, format: email }
 *               host: { type: string }
 *               port: { type: integer, minimum: 1, maximum: 65535 }
 *               username: { type: string }
 *               password: { type: string }
 *               secure: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: The mailbox was connected
 *       400:
 *         description: Validation failed, or the mail server refused the connection (CONNECTION_FAILED, PROVIDER_AUTH_EXPIRED)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       409:
 *         description: That mailbox is already connected to this account
 */
router.post('/', outboundDialLimiter, asyncHandler(createConnectedAccountHandler));

/**
 * @openapi
 * /api/v1/connected-accounts/{id}:
 *   delete:
 *     tags: [Connected Accounts]
 *     operationId: deleteConnectedAccount
 *     summary: Disconnect one of your mailboxes
 *     description: >
 *       Removes the mailbox and its stored credentials. Only the owning user may delete a
 *       connected account; an administrator cannot.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: The mailbox was disconnected
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete('/:id', asyncHandler(deleteConnectedAccountHandler));

/**
 * @openapi
 * /api/v1/connected-accounts/{id}/test:
 *   post:
 *     tags: [Connected Accounts]
 *     operationId: testConnectedAccount
 *     summary: Re-test a stored mailbox connection
 *     description: >
 *       Re-checks a stored mailbox and records the outcome on the account. The HTTP status
 *       is always 200 — the mail server's answer is in the payload.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The test result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 error: { type: string }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post('/:id/test', outboundDialLimiter, asyncHandler(testConnectedAccountHandler));

export default router;
