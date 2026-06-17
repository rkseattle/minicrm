/**
 * User management routes — admin-gated except for set-password.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  inviteUser,
  listActiveUsersHandler,
  listUsers,
  updateUserRole,
  updateUserStatusHandler,
  deactivateUser,
  reactivateUser,
  setPassword,
  adminSetPassword,
  getMyPreferredLanguage,
  setMyPreferredLanguage,
  getMyNotificationPrefs,
  updateMyNotificationPrefs,
  getNotificationRecipientCount,
  resetOnboardingHandler,
  issueApiToken,
  revokeApiToken,
} from '../controllers/userController.js';
import {
  listUserRolesHandler,
  assignUserRoleHandler,
  removeUserRoleHandler,
} from '../controllers/customRolesController.js';
import { bulkPatchUsersHandler, bulkDeleteUsersHandler } from '../controllers/bulkV2Controller.js';

const router = Router();

/**
 * @openapi
 * /api/v1/users/set-password:
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
 *         description: >
 *           Validation error, password does not meet complexity requirements,
 *           or invite token is missing, malformed, or expired (returns AUTH_INVALID_TOKEN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               validationError:
 *                 summary: Password too weak
 *                 value:
 *                   error:
 *                     code: VALIDATION_ERROR
 *                     message: Password must be at least 8 characters
 *               invalidToken:
 *                 summary: Invalid or expired invite token
 *                 value:
 *                   error:
 *                     code: AUTH_INVALID_TOKEN
 *                     message: Invite token is invalid or has expired
 */
router.post('/set-password', asyncHandler(setPassword));

/**
 * @openapi
 * /api/v1/users/active:
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
 * /api/v1/users/me/language:
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
 * /api/v1/users/me/language:
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

/**
 * @openapi
 * /api/v1/users/me/notification-preferences:
 *   get:
 *     tags: [Users]
 *     operationId: getMyNotificationPrefs
 *     summary: Get the authenticated user's email notification preferences (MINCRM-163)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current notification preference flags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 preferences:
 *                   type: object
 *                   properties:
 *                     notify_overdue_tasks: { type: boolean }
 *                     notify_assignments: { type: boolean }
 *                     notify_deal_stage_changes: { type: boolean }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/me/notification-preferences', authenticate, asyncHandler(getMyNotificationPrefs));

/**
 * @openapi
 * /api/v1/users/me/notification-preferences:
 *   patch:
 *     tags: [Users]
 *     operationId: updateMyNotificationPrefs
 *     summary: Update the authenticated user's email notification preferences (MINCRM-163)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notify_overdue_tasks: { type: boolean }
 *               notify_assignments: { type: boolean }
 *               notify_deal_stage_changes: { type: boolean }
 *     responses:
 *       200:
 *         description: Preferences updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.patch('/me/notification-preferences', authenticate, asyncHandler(updateMyNotificationPrefs));

/** All routes below require authentication + admin role */
router.use(authenticate, requireRole('admin'));

/**
 * @openapi
 * /api/v1/users:
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
 * /api/v1/users/invite:
 *   post:
 *     tags: [Users]
 *     operationId: inviteUser
 *     summary: Invite a new user (admin only)
 *     description: >
 *       Creates a user with status 'invited' and returns an invite token. The
 *       invited user must call POST /api/v1/users/set-password to activate their account.
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
 *                   description: >
 *                     JWT invite token to send to the user. Intentional camelCase
 *                     exception — all other response fields use snake_case.
 *                 setPasswordPath:
 *                   type: string
 *                   description: >
 *                     Convenience path for constructing the set-password URL
 *                     (e.g. /set-password?token=<inviteToken>). Intentional camelCase exception.
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
 *               setPasswordPath: /set-password?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
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
 *       409:
 *         description: A user with that email already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: USER_EMAIL_CONFLICT
 *                 message: A user with that email already exists
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
/**
 * @openapi
 * /api/v1/users/notification-recipient-count:
 *   get:
 *     tags: [Users]
 *     operationId: getNotificationRecipientCount
 *     summary: Count of active users with at least one notification enabled (admin only, MINCRM-163)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Recipient count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: integer }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/notification-recipient-count', asyncHandler(getNotificationRecipientCount));

/**
 * @openapi
 * /api/v1/users/invite:
 *   post:
 *     tags: [Users]
 *     operationId: inviteUser
 *     summary: Invite a new user (admin only)
 *     description: Creates a new user account in invited status and returns a set-password link.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, name, role]
 *             properties:
 *               email: { type: string, format: email }
 *               name: { type: string }
 *               role: { type: string, enum: [admin, rep] }
 *     responses:
 *       201:
 *         description: User invited successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 */
router.post('/invite', asyncHandler(inviteUser));

/**
 * @openapi
 * /api/v1/users/{id}/role:
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
 * /api/v1/users/{id}/deactivate:
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
 * /api/v1/users/{id}/reactivate:
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
 * /api/v1/users/{id}/status:
 *   patch:
 *     tags: [Users]
 *     operationId: updateUserStatus
 *     summary: Set a user's active/inactive status (admin only)
 *     description: >
 *       Activates or deactivates a user via { active: boolean }.
 *       Deactivating the currently authenticated user returns 409.
 *       invited users can be deactivated (sets status to inactive). (MINCRM-561)
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
 *             type: object
 *             required: [active]
 *             properties:
 *               active:
 *                 type: boolean
 *                 description: true to activate, false to deactivate
 *     responses:
 *       200:
 *         description: User status updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Insufficient role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Self-deactivation not allowed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: SELF_DEACTIVATION_NOT_ALLOWED
 *                 message: Cannot deactivate your own account
 */
router.patch('/:id/status', asyncHandler(updateUserStatusHandler));

/**
 * @openapi
 * /api/v1/users/{id}/admin-set-password:
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
 *         description: Password set and must_change_password flag enabled
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
 *                 must_change_password: true
 *                 preferred_language: en
 *                 created_at: '2025-03-15T09:00:00.000Z'
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

/**
 * @openapi
 * /api/v1/users/{id}/reset-onboarding:
 *   post:
 *     tags: [Users]
 *     operationId: resetUserOnboarding
 *     summary: Reset a user's onboarding checklist (admin only, MINCRM-410)
 *     description: >
 *       Resets onboarding_completed to false for the specified user, causing their
 *       setup checklist widget to reappear. Admin only.
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
 *         description: Onboarding reset
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post('/:id/reset-onboarding', asyncHandler(resetOnboardingHandler));

/**
 * @openapi
 * /api/v1/users/{id}/api-token:
 *   post:
 *     tags: [Users]
 *     operationId: issueApiToken
 *     summary: Issue an API token for a service account user (admin only, MINCRM-536)
 *     description: >
 *       Generates a new long-lived API token for the specified service_account user.
 *       Any previously issued token is atomically revoked. The plaintext token is
 *       returned exactly once — it is never stored and cannot be retrieved again.
 *       Requires admin role.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Service account user ID
 *     responses:
 *       201:
 *         description: Token issued — store it securely, it will not be shown again
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 issued_at: { type: string, format: date-time }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post('/:id/api-token', asyncHandler(issueApiToken));

/**
 * @openapi
 * /api/v1/users/{id}/api-token:
 *   delete:
 *     tags: [Users]
 *     operationId: revokeApiToken
 *     summary: Revoke a service account's API token (admin only, MINCRM-536)
 *     description: >
 *       Immediately invalidates the API token for the specified service_account user.
 *       No grace period — the token stops working as soon as this request succeeds.
 *       Requires admin role.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Service account user ID
 *     responses:
 *       200:
 *         description: Token revoked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete('/:id/api-token', asyncHandler(revokeApiToken));

// ── User custom role assignment (MINCRM-542) ───────────────────────────────────

/**
 * @openapi
 * /api/v1/users/{id}/roles:
 *   get:
 *     tags: [Users]
 *     operationId: listUserRoles
 *     summary: List custom roles assigned to a user (MINCRM-542)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Array of custom roles assigned to the user
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/:id/roles',
  requireCapability(Capability.UsersView),
  asyncHandler(listUserRolesHandler),
);

/**
 * @openapi
 * /api/v1/users/{id}/roles:
 *   post:
 *     tags: [Users]
 *     operationId: assignUserRole
 *     summary: Assign a custom role to a user (MINCRM-542)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleId]
 *             properties:
 *               roleId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       204:
 *         description: Role assigned (or already assigned — idempotent)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post(
  '/:id/roles',
  requireCapability(Capability.UsersEdit),
  asyncHandler(assignUserRoleHandler),
);

/**
 * @openapi
 * /api/v1/users/{id}/roles/{roleId}:
 *   delete:
 *     tags: [Users]
 *     operationId: removeUserRole
 *     summary: Remove a custom role assignment from a user (MINCRM-542)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Role removed (or was not assigned — idempotent)
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  '/:id/roles/:roleId',
  requireCapability(Capability.UsersEdit),
  asyncHandler(removeUserRoleHandler),
);

/**
 * @openapi
 * /api/v1/users/bulk:
 *   patch:
 *     tags: [Users]
 *     operationId: bulkPatchUsers
 *     summary: Bulk patch users — activate/deactivate or change role (MINCRM-562)
 *     description: >
 *       Applies a status or role change to each listed user individually.
 *       Requires admin role + bulk:operations + users:edit.
 *       Returns partial success: each ID appears in either succeeded or failed.
 *       Max 500 IDs per request.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids, patch]
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 maxItems: 500
 *               patch:
 *                 type: object
 *                 properties:
 *                   active:
 *                     type: boolean
 *                   role:
 *                     type: string
 *     responses:
 *       200:
 *         description: Partial or full success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkV2Result'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.patch(
  '/bulk',
  requireCapability(Capability.BulkOperations),
  requireCapability(Capability.UsersEdit),
  asyncHandler(bulkPatchUsersHandler),
);

/**
 * @openapi
 * /api/v1/users/bulk:
 *   delete:
 *     tags: [Users]
 *     operationId: bulkDeleteUsers
 *     summary: Bulk delete users (MINCRM-562)
 *     description: >
 *       Deletes each listed user individually.
 *       Requires admin role + bulk:operations + users:delete.
 *       Returns partial success; service accounts and self-delete are rejected per-record.
 *       Max 500 IDs per request.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 maxItems: 500
 *     responses:
 *       200:
 *         description: Partial or full success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkV2Result'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.delete(
  '/bulk',
  requireCapability(Capability.BulkOperations),
  requireCapability(Capability.UsersDelete),
  asyncHandler(bulkDeleteUsersHandler),
);

export default router;
