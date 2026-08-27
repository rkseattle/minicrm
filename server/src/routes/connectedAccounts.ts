/**
 * Connected account routes — per-user linked mailboxes.
 * Route definitions and OpenAPI annotations only; logic lives in the controller.
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import {
  createConnectedAccountHandler,
  deleteConnectedAccountHandler,
  listConnectedAccountsHandler,
  oauthCallbackHandler,
  startOAuthFlowHandler,
  testConnectedAccountHandler,
} from '../controllers/connectedAccountController.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

/**
 * Runs `authenticate`, turning its JSON 401 into a redirect.
 *
 * The OAuth legs are entered by top-level browser navigation, where the middleware's
 * `{"error":{"code":"AUTH_MISSING_TOKEN"}}` body renders as a page of text with no way
 * back — a real outcome for anyone whose idle window lapsed while the panel sat open.
 * The session is still required: `req.user` is assigned nowhere else, and the state row
 * has to bind to a real user.
 */
function authenticateOrRedirect(req: Request, res: Response, next: NextFunction): void {
  // A throwaway response collects authenticate's verdict without writing to the real one,
  // so the 401 body it would have sent is never emitted.
  const probe = Object.create(res) as Response & { statusCode: number };
  let rejected = false;
  probe.status = (code: number) => {
    if (code === 401 || code === 403) rejected = true;
    return { json: () => probe } as unknown as Response;
  };

  void authenticate(req, probe, () => {
    next();
  }).then(() => {
    if (!rejected) return;
    const profileUrl = `${process.env.APP_BASE_URL ?? 'http://localhost:5173'}/profile`;
    res.redirect(302, `${profileUrl}?connect=SESSION_EXPIRED`);
  });
}

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
router.get('/oauth/:provider/start', authenticateOrRedirect, asyncHandler(startOAuthFlowHandler));

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
router.get('/oauth/:provider/callback', authenticateOrRedirect, asyncHandler(oauthCallbackHandler));

router.use(authenticate);

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
router.post('/', asyncHandler(createConnectedAccountHandler));

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
router.post('/:id/test', asyncHandler(testConnectedAccountHandler));

export default router;
