/**
 * Automation routes — all endpoints require authentication and admin role.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createAutomationRuleHandler,
  listAutomationRulesHandler,
  getAutomationRuleHandler,
  updateAutomationRuleHandler,
  deleteAutomationRuleHandler,
  listRuleLogsHandler,
} from '../controllers/automationController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/automation/rules:
 *   get:
 *     tags: [Automation]
 *     operationId: listAutomationRules
 *     summary: List automation rules
 *     description: Returns a paginated list of automation rules. Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: 1-based page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 25
 *         description: Records per page
 *     responses:
 *       200:
 *         description: Paginated list of automation rules
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AutomationRule'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/', authenticate, requireRole('admin'), asyncHandler(listAutomationRulesHandler));

/**
 * @openapi
 * /api/v1/automation/rules:
 *   post:
 *     tags: [Automation]
 *     operationId: createAutomationRule
 *     summary: Create an automation rule
 *     description: Creates a new automation rule. Admin only.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAutomationRuleRequest'
 *     responses:
 *       201:
 *         description: Automation rule created
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/', authenticate, requireRole('admin'), asyncHandler(createAutomationRuleHandler));

/**
 * @openapi
 * /api/v1/automation/rules/{id}:
 *   get:
 *     tags: [Automation]
 *     operationId: getAutomationRule
 *     summary: Get an automation rule by ID
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
 *         description: Automation rule found
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:id', authenticate, requireRole('admin'), asyncHandler(getAutomationRuleHandler));

/**
 * @openapi
 * /api/v1/automation/rules/{id}:
 *   patch:
 *     tags: [Automation]
 *     operationId: updateAutomationRule
 *     summary: Update an automation rule
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
 *         description: Automation rule updated
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch('/:id', authenticate, requireRole('admin'), asyncHandler(updateAutomationRuleHandler));

/**
 * @openapi
 * /api/v1/automation/rules/{id}:
 *   delete:
 *     tags: [Automation]
 *     operationId: deleteAutomationRule
 *     summary: Delete an automation rule
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
 *         description: Automation rule deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(deleteAutomationRuleHandler),
);

/**
 * @openapi
 * /api/v1/automation/rules/{id}/logs:
 *   get:
 *     tags: [Automation]
 *     operationId: listRuleLogs
 *     summary: List execution logs for an automation rule
 *     description: Returns the 20 most recent executions for the given rule. Admin only.
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
 *         description: Array of execution logs
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:id/logs', authenticate, requireRole('admin'), asyncHandler(listRuleLogsHandler));

export default router;
