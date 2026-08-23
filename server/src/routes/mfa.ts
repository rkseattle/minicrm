/**
 * MFA routes — TOTP two-factor authentication.
 * Route definitions + @openapi JSDoc only — no logic, no service imports.
 */

import { Router } from 'express';
import { isAuthBypassEnv } from '../utils/nodeEnv.js';
import { authenticate } from '../middleware/auth.js';
import {
  getMfaStatus,
  setupMfa,
  verifyMfaSetup,
  disableMfa,
  verifyMfaLogin,
  verifyMfaRecoveryLogin,
} from '../controllers/mfaController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

/**
 * @openapi
 * /api/v1/auth/mfa/status:
 *   get:
 *     tags: [MFA]
 *     operationId: getMfaStatus
 *     summary: Get MFA status for the authenticated user
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: MFA status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                 recoveryCodesRemaining:
 *                   type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/status', authenticate, asyncHandler(getMfaStatus));

/**
 * @openapi
 * /api/v1/auth/mfa/setup:
 *   post:
 *     tags: [MFA]
 *     operationId: setupMfa
 *     summary: Initiate MFA setup — returns QR code data URL
 *     description: >
 *       Generates a new TOTP secret and stores it as a pending secret.
 *       Returns a QR code data URL for the user to scan with an authenticator app.
 *       MFA is not enabled until the user verifies the code via /verify-setup.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: QR code data URL and otpauth URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 otpauthUrl:
 *                   type: string
 *                 qrDataUrl:
 *                   type: string
 *       409:
 *         description: MFA already enabled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/setup', authenticate, asyncHandler(setupMfa));

/**
 * @openapi
 * /api/v1/auth/mfa/verify-setup:
 *   post:
 *     tags: [MFA]
 *     operationId: verifyMfaSetup
 *     summary: Verify TOTP code and enable MFA
 *     description: >
 *       Verifies a 6-digit TOTP code against the pending secret and enables MFA.
 *       Returns 8 single-use recovery codes — shown once only.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code:
 *                 type: string
 *                 example: '123456'
 *     responses:
 *       200:
 *         description: MFA enabled — recovery codes returned once
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recoveryCodes:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         description: Invalid TOTP code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/verify-setup', authenticate, asyncHandler(verifyMfaSetup));

/**
 * @openapi
 * /api/v1/auth/mfa/disable:
 *   post:
 *     tags: [MFA]
 *     operationId: disableMfa
 *     summary: Disable MFA (requires current password confirmation)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: MFA disabled
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         description: Invalid password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/disable', authenticate, asyncHandler(disableMfa));

/**
 * @openapi
 * /api/v1/auth/mfa/verify-login:
 *   post:
 *     tags: [MFA]
 *     operationId: verifyMfaLogin
 *     summary: Complete login using TOTP code
 *     description: >
 *       After a successful password check, the server returns an mfaToken and
 *       mfaRequired:true instead of a session cookie. The client submits the
 *       mfaToken + 6-digit TOTP code here to receive the session cookie.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mfaToken, code]
 *             properties:
 *               mfaToken:
 *                 type: string
 *               code:
 *                 type: string
 *                 example: '123456'
 *     responses:
 *       200:
 *         description: Login complete — session cookie set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         description: Invalid or expired MFA token, or invalid TOTP code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/verify-login', asyncHandler(verifyMfaLogin));

/**
 * @openapi
 * /api/v1/auth/mfa/recovery-login:
 *   post:
 *     tags: [MFA]
 *     operationId: verifyMfaRecoveryLogin
 *     summary: Complete login using a single-use recovery code
 *     description: >
 *       Alternative to TOTP when the user cannot access their authenticator app.
 *       Consumes one recovery code on success (burn-on-use).
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mfaToken, recoveryCode]
 *             properties:
 *               mfaToken:
 *                 type: string
 *               recoveryCode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login complete — session cookie set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         description: Invalid or expired MFA token, or invalid recovery code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/recovery-login', asyncHandler(verifyMfaRecoveryLogin));

// ── Dev/test-only endpoint ──────────────────────────────────────────────────
// Returns the current TOTP code for the authenticated user's active secret.
// Only available in development and test — never staging or production.
// Used by E2E tests to complete the MFA login flow without a real authenticator
// app. Follows the same pattern as /auth/dev/reset-token.
if (isAuthBypassEnv()) {
  /**
   * GET /api/v1/auth/mfa/dev/totp-code — dev/test only.
   * Returns the current TOTP code for the authenticated user's active or pending
   * MFA secret. Used by E2E tests to complete the MFA flow without a real
   * authenticator app. Never available in production.
   */
  // eslint-disable-next-line local-openapi/require-openapi-tag -- test-only route, never mounted in production
  router.get(
    '/dev/totp-code',
    authenticate,
    asyncHandler(async (req, res) => {
      const { generateCurrentTotpCode } = await import('../services/mfaService.js');
      const code = await generateCurrentTotpCode(req.user!.id);
      if (!code) {
        res.status(400).json({
          error: { code: 'MFA_NOT_ENABLED', message: 'MFA is not enabled for this user.' },
        });
        return;
      }
      res.status(200).json({ code });
    }),
  );
}

export default router;
