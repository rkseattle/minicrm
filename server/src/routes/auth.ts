/**
 * Auth routes — login, logout, and current-user.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { login, logout, me, changePassword } from '../controllers/authController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

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
router.post('/login', asyncHandler(login));

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
router.post('/logout', logout);

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

export default router;
