/**
 * User management routes — admin-gated except for set-password.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  inviteUser,
  listActiveUsersHandler,
  listUsers,
  updateUserRole,
  deactivateUser,
  reactivateUser,
  setPassword,
  adminSetPassword,
  getMyPreferredLanguage,
  setMyPreferredLanguage,
} from '../controllers/userController.js';

const router = Router();

/**
 * @openapi
 * /api/users/set-password:
 *   post:
 *     tags: [Users]
 *     operationId: setPassword
 *     summary: Activate an invited account by setting a password
 *     description: >
 *       Used by invited users to activate their account. Accepts the invite JWT
 *       token from the invitation email and the desired password.
 *       No authentication required.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SetPasswordRequest'
 *           example:
 *             token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *             password: MySecurePass1
 *     responses:
 *       200:
 *         description: Password set successfully; account is now active
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Password set successfully
 *             example:
 *               message: Password set successfully
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
 *         description: Invalid or expired invite token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Invite token is invalid or has expired
 */
router.post('/set-password', asyncHandler(setPassword));

/**
 * @openapi
 * /api/users/active:
 *   get:
 *     tags: [Users]
 *     operationId: listActiveUsers
 *     summary: List all active users
 *     description: >
 *       Returns all users with status 'active'. Used to populate owner-assignment
 *       dropdowns. Requires authentication; no admin role required.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of active users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *             example:
 *               users:
 *                 - id: u1b2c3d4-0000-0000-0000-000000000001
 *                   email: jane.smith@acme.com
 *                   name: Jane Smith
 *                   role: rep
 *                   status: active
 *                   must_change_password: false
 *                   preferred_language: en
 *                   created_at: '2025-03-15T09:00:00.000Z'
 *       400:
 *         description: Invalid query parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: Invalid query parameter
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 */
router.get('/active', authenticate, asyncHandler(listActiveUsersHandler));

/**
 * @openapi
 * /api/users/me/language:
 *   get:
 *     tags: [Users]
 *     operationId: getMyLanguage
 *     summary: Get the authenticated user's language preference
 *     description: >
 *       Returns the user's stored preferred language, or null if none is set
 *       (in which case the system default applies). Requires authentication.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: User's preferred language (or null)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 language:
 *                   type: string
 *                   enum: [en, zh-Hans, es, fr, de]
 *                   nullable: true
 *             example:
 *               language: en
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 */
router.get('/me/language', authenticate, asyncHandler(getMyPreferredLanguage));

/**
 * @openapi
 * /api/users/me/language:
 *   patch:
 *     tags: [Users]
 *     operationId: setMyLanguage
 *     summary: Set the authenticated user's language preference
 *     description: >
 *       Persists the user's preferred language. Pass null to clear the preference
 *       and fall back to the system default. Requires authentication.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateLanguageRequest'
 *           example:
 *             language: fr
 *     responses:
 *       200:
 *         description: Language preference updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 language:
 *                   type: string
 *                   enum: [en, zh-Hans, es, fr, de]
 *                   nullable: true
 *             example:
 *               language: fr
 *       400:
 *         description: Invalid language value
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: language must be one of en, zh-Hans, es, fr, de
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 */
router.patch('/me/language', authenticate, asyncHandler(setMyPreferredLanguage));

/** All routes below require authentication + admin role */
router.use(authenticate, requireRole('admin'));

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags: [Users]
 *     operationId: listUsers
 *     summary: List all users (admin only)
 *     description: Returns all users regardless of status. Requires admin role.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of all users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *             example:
 *               users:
 *                 - id: u1b2c3d4-0000-0000-0000-000000000001
 *                   email: jane.smith@acme.com
 *                   name: Jane Smith
 *                   role: rep
 *                   status: active
 *                   must_change_password: false
 *                   preferred_language: en
 *                   created_at: '2025-03-15T09:00:00.000Z'
 *       400:
 *         description: Invalid query parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: Invalid query parameter
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 *       403:
 *         description: Insufficient role (admin required)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: Admin role required
 */
router.get('/', asyncHandler(listUsers));

/**
 * @openapi
 * /api/users/invite:
 *   post:
 *     tags: [Users]
 *     operationId: inviteUser
 *     summary: Invite a new user (admin only)
 *     description: >
 *       Creates a user with status 'invited' and returns an invite token. The
 *       invited user must call POST /api/users/set-password to activate their account.
 *       Requires admin role.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InviteUserRequest'
 *           example:
 *             email: jane.smith@acme.com
 *             name: Jane Smith
 *             role: rep
 *     responses:
 *       201:
 *         description: User invited successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 inviteToken:
 *                   type: string
 *                   description: JWT invite token to send to the user
 *             example:
 *               user:
 *                 id: u1b2c3d4-0000-0000-0000-000000000001
 *                 email: jane.smith@acme.com
 *                 name: Jane Smith
 *                 role: rep
 *                 status: invited
 *                 must_change_password: true
 *                 preferred_language: null
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *               inviteToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       400:
 *         description: Validation error or email already in use
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: CONFLICT
 *                 message: A user with this email already exists
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 *       403:
 *         description: Insufficient role (admin required)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: Admin role required
 */
router.post('/invite', asyncHandler(inviteUser));

/**
 * @openapi
 * /api/users/{id}/role:
 *   patch:
 *     tags: [Users]
 *     operationId: updateUserRole
 *     summary: Change a user's role (admin only)
 *     description: Updates the role of the specified user. Requires admin role.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateRoleRequest'
 *           example:
 *             role: admin
 *     responses:
 *       200:
 *         description: Role updated
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
 *                 role: admin
 *                 status: active
 *                 must_change_password: false
 *                 preferred_language: en
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: role must be admin or rep
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 *       403:
 *         description: Insufficient role (admin required)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: Admin role required
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: User not found
 */
router.patch('/:id/role', asyncHandler(updateUserRole));

/**
 * @openapi
 * /api/users/{id}/deactivate:
 *   patch:
 *     tags: [Users]
 *     operationId: deactivateUser
 *     summary: Deactivate a user (admin only)
 *     description: >
 *       Sets the user's status to 'inactive'. Deactivated users cannot log in but
 *       their records remain intact. Requires admin role.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User deactivated
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
 *                 status: inactive
 *                 must_change_password: false
 *                 preferred_language: en
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 *       403:
 *         description: Insufficient role (admin required)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: Admin role required
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: User not found
 */
router.patch('/:id/deactivate', asyncHandler(deactivateUser));

/**
 * @openapi
 * /api/users/{id}/reactivate:
 *   patch:
 *     tags: [Users]
 *     operationId: reactivateUser
 *     summary: Reactivate a deactivated user (admin only)
 *     description: Sets the user's status back to 'active'. Requires admin role.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User reactivated
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
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 *       403:
 *         description: Insufficient role (admin required)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: Admin role required
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: User not found
 */
router.patch('/:id/reactivate', asyncHandler(reactivateUser));

/**
 * @openapi
 * /api/users/{id}/admin-set-password:
 *   post:
 *     tags: [Users]
 *     operationId: adminSetPassword
 *     summary: Admin sets a user's password directly (admin only)
 *     description: >
 *       Allows an admin to set another user's password without knowing the current
 *       password. Sets must_change_password to true. Requires admin role.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminSetPasswordRequest'
 *           example:
 *             password: TempPass123
 *     responses:
 *       200:
 *         description: Password set successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Password updated successfully
 *             example:
 *               message: Password updated successfully
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
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 *       403:
 *         description: Insufficient role (admin required)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: Admin role required
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: User not found
 */
router.post('/:id/admin-set-password', asyncHandler(adminSetPassword));

export default router;
