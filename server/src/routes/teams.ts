/**
 * Team routes — CRUD and membership management for the teams feature. (MINCRM-537)
 * This file contains only @openapi JSDoc annotations + route declarations.
 * No business logic or database access belongs here.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listTeamsHandler,
  getTeamHandler,
  createTeamHandler,
  updateTeamHandler,
  deleteTeamHandler,
  listTeamMembersHandler,
  addTeamMemberHandler,
  removeTeamMemberHandler,
} from '../controllers/teamController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/teams:
 *   get:
 *     tags: [Teams]
 *     operationId: listTeams
 *     summary: List all teams
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of teams
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 teams:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Team'
 *       401:
 *         description: Not authenticated
 */
router.get('/', authenticate, asyncHandler(listTeamsHandler));

/**
 * @openapi
 * /api/v1/teams:
 *   post:
 *     tags: [Teams]
 *     operationId: createTeam
 *     summary: Create a team
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTeamRequest'
 *     responses:
 *       201:
 *         description: Team created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 team:
 *                   $ref: '#/components/schemas/Team'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Forbidden — admin role required
 *       409:
 *         description: A team with this name already exists
 */
router.post('/', authenticate, requireRole('admin'), asyncHandler(createTeamHandler));

/**
 * @openapi
 * /api/v1/teams/{id}:
 *   get:
 *     tags: [Teams]
 *     operationId: getTeam
 *     summary: Get a team by ID
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
 *         description: Team record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 team:
 *                   $ref: '#/components/schemas/Team'
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Team not found
 */
router.get('/:id', authenticate, asyncHandler(getTeamHandler));

/**
 * @openapi
 * /api/v1/teams/{id}:
 *   put:
 *     tags: [Teams]
 *     operationId: updateTeam
 *     summary: Update a team
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
 *             $ref: '#/components/schemas/UpdateTeamRequest'
 *     responses:
 *       200:
 *         description: Updated team
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 team:
 *                   $ref: '#/components/schemas/Team'
 *       400:
 *         description: Validation error or circular parent reference
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Forbidden — admin role required
 *       404:
 *         description: Team not found
 *       409:
 *         description: A team with this name already exists
 */
router.put('/:id', authenticate, requireRole('admin'), asyncHandler(updateTeamHandler));

/**
 * @openapi
 * /api/v1/teams/{id}:
 *   delete:
 *     tags: [Teams]
 *     operationId: deleteTeam
 *     summary: Delete a team
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
 *       204:
 *         description: Team deleted
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Forbidden — admin role required
 *       404:
 *         description: Team not found
 *       409:
 *         description: Team has child teams and cannot be deleted
 */
router.delete('/:id', authenticate, requireRole('admin'), asyncHandler(deleteTeamHandler));

/**
 * @openapi
 * /api/v1/teams/{id}/members:
 *   get:
 *     tags: [Teams]
 *     operationId: listTeamMembers
 *     summary: List team members
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
 *         description: List of team members
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 members:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TeamMember'
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Team not found
 */
router.get('/:id/members', authenticate, asyncHandler(listTeamMembersHandler));

/**
 * @openapi
 * /api/v1/teams/{id}/members:
 *   post:
 *     tags: [Teams]
 *     operationId: addTeamMember
 *     summary: Add a user to a team
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
 *             $ref: '#/components/schemas/AddTeamMemberRequest'
 *     responses:
 *       201:
 *         description: Member added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 member:
 *                   $ref: '#/components/schemas/TeamMember'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Forbidden — admin role required
 *       404:
 *         description: Team or user not found
 *       409:
 *         description: User is already a member of this team
 */
router.post('/:id/members', authenticate, requireRole('admin'), asyncHandler(addTeamMemberHandler));

/**
 * @openapi
 * /api/v1/teams/{id}/members/{userId}:
 *   delete:
 *     tags: [Teams]
 *     operationId: removeTeamMember
 *     summary: Remove a user from a team
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
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Member removed
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Forbidden — admin role required
 *       404:
 *         description: Team or member not found
 */
router.delete(
  '/:id/members/:userId',
  authenticate,
  requireRole('admin'),
  asyncHandler(removeTeamMemberHandler),
);

export default router;
