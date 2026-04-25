/**
 * Auth routes — login, logout, and current-user.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import {
  login,
  logout,
  me,
  changePassword,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

// In E2E/test environments the BVT suite submits multiple logins per run from a
// single IP. Disable the limiter so the suite does not exhaust the window during
// a normal run. The NODE_ENV !== 'production' guard ensures this bypass can never
// activate in production regardless of how E2E is set (e.g. copied .env file).
const isE2E =
  process.env.NODE_ENV !== 'production' &&
  (process.env.NODE_ENV === 'test' || process.env.E2E === 'true');

// TEST_RATE_LIMIT=true overrides the E2E bypass so rate-limiter unit tests can
// verify the limiters actually fire. Never set in production (the isE2E check
// above already makes this unreachable when NODE_ENV === 'production').
const shouldSkip = (): boolean => isE2E && process.env.TEST_RATE_LIMIT !== 'true';

/** 10 login attempts per IP per 15-minute window (skipped in test/e2e) */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  // express-rate-limit v7: max:0 blocks all requests, not unlimited.
  // Use skip() to bypass the limiter entirely in E2E/test environments.
  skip: shouldSkip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts, please try again later.',
    },
  },
});

/** 5 forgot-password attempts per IP per 15-minute window (skipped in test/e2e) */
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: shouldSkip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many password reset requests, please try again later.',
    },
  },
});

/** 10 reset-password attempts per IP per 15-minute window (skipped in test/e2e) */
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: shouldSkip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many password reset attempts, please try again later.',
    },
  },
});

const router = Router();

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     operationId: login
 *     summary: Authenticate with email and password
 *     description: >
 *       Validates credentials and sets an httpOnly minicrm_token cookie containing
 *       a signed JWT valid for 8 hours. No authentication required.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           example:
 *             email: admin@example.com
 *             password: Secret123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *             example:
 *               user:
 *                 id: u1b2c3d4-0000-0000-0000-000000000001
 *                 email: jane.smith@acme.com
 *                 name: Jane Smith
 *                 role: rep
 *                 status: active
 *                 must_change_password: false
 *                 preferred_language: en
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *               mustChangePassword: false
 *       400:
 *         description: Validation error (missing or invalid fields)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: Email is required
 *       401:
 *         description: Invalid email or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: INVALID_CREDENTIALS
 *                 message: Invalid email or password
 *       403:
 *         description: Account deactivated or not yet activated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: ACCOUNT_INACTIVE
 *                 message: Your account has been deactivated
 */
router.post('/login', loginLimiter, asyncHandler(login));

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     operationId: logout
 *     summary: Log out and clear the auth cookie
 *     description: >
 *       Clears the minicrm_token httpOnly cookie. No authentication required.
 *       This endpoint is idempotent — calling it without a cookie still returns 200.
 *     security: []
 *     responses:
 *       200:
 *         description: Logged out successfully (also returned when no cookie was present)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Logged out successfully
 *             example:
 *               message: Logged out successfully
 */
router.post('/logout', authenticate, asyncHandler(logout));

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     operationId: getCurrentUser
 *     summary: Return the currently authenticated user
 *     description: >
 *       Refreshes user data from the database to reflect the latest role and status.
 *       Requires a valid JWT cookie.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *             example:
 *               user:
 *                 id: u1b2c3d4-0000-0000-0000-000000000001
 *                 email: jane.smith@acme.com
 *                 name: Jane Smith
 *                 role: rep
 *                 status: active
 *                 must_change_password: false
 *                 preferred_language: en
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *       401:
 *         description: Missing, invalid, or expired token; or user was deactivated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Token expired or invalid
 */
router.get('/me', authenticate, asyncHandler(me));

/**
 * @openapi
 * /api/auth/change-password:
 *   post:
 *     tags: [Auth]
 *     operationId: changePassword
 *     summary: Change the authenticated user's own password
 *     description: >
 *       Verifies the current password, then updates it to the new value.
 *       Clears the must_change_password flag on success.
 *       Requires a valid JWT cookie.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordRequest'
 *           example:
 *             currentPassword: OldPass1
 *             newPassword: NewPass2
 *     responses:
 *       200:
 *         description: Password changed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Password changed successfully
 *             example:
 *               message: Password changed successfully
 *       400:
 *         description: Validation error or password does not meet complexity requirements
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: Password must be at least 8 characters
 *       401:
 *         description: Missing/invalid token or current password is incorrect
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: INVALID_CREDENTIALS
 *                 message: Current password is incorrect
 */
router.post('/change-password', authenticate, asyncHandler(changePassword));

/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     operationId: forgotPassword
 *     summary: Request a password reset link
 *     description: >
 *       Accepts an email address and sends a reset link if a matching active
 *       user exists. Always returns 200 to prevent user enumeration (MINCRM-156).
 *       Rate-limited to 5 requests per 15 minutes per IP.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *     responses:
 *       200:
 *         description: Request accepted (same response whether or not email matched)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *             example:
 *               message: If an account with that email exists, a reset link has been sent.
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/forgot-password', forgotPasswordLimiter, asyncHandler(forgotPassword));

/**
 * @openapi
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     operationId: resetPassword
 *     summary: Set a new password using a reset token
 *     description: >
 *       Validates the token, updates the user's password, invalidates the token,
 *       and sets a new session cookie (MINCRM-157). All existing sessions for the
 *       user are invalidated via password_changed_at.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:
 *                 type: string
 *                 example: abc123...
 *               password:
 *                 type: string
 *                 example: NewPass1
 *     responses:
 *       200:
 *         description: Password reset successful — user is now logged in
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Token invalid, expired, or password fails complexity
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: RESET_TOKEN_INVALID
 *                 message: This reset link is invalid or has expired.
 */
router.post('/reset-password', resetPasswordLimiter, asyncHandler(resetPassword));

// ── Dev/test-only endpoint ───────────────────────────────────────────────────
// Returns a plaintext reset token for a given email address.
// Only available when NODE_ENV !== 'production'.
// Used by E2E tests to bypass the email delivery step. (MINCRM-156)
if (process.env.NODE_ENV !== 'production') {
  /**
   * POST /api/auth/dev/reset-token — dev/test only.
   * Creates and returns a plaintext reset token for a given email address.
   * Used by E2E tests to bypass the email delivery step. Never available in production.
   */
  router.post(
    '/dev/reset-token',
    asyncHandler(async (req, res) => {
      const { email } = req.body as { email?: unknown };
      if (typeof email !== 'string' || !email) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'email required' } });
        return;
      }
      const { findUserByEmail, createPasswordResetToken } =
        await import('../services/userService.js');
      const user = await findUserByEmail(email);
      if (!user || user.status !== 'active') {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
        return;
      }
      const { plaintextToken } = await createPasswordResetToken(user.id);
      res.status(200).json({ token: plaintextToken });
    }),
  );
}

export default router;
