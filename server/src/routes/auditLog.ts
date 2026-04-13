/**
 * Audit log routes. (MINCRM-170, MINCRM-171, MINCRM-172)
 *
 * GET /api/audit-log         — admin only: paginated, filtered system-wide log
 * GET /api/audit-log/record  — any authenticated user: entries for a specific record
 * GET /api/audit-log/actors  — admin only: distinct users in the audit log
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listAuditLogHandler,
  getRecordAuditLogHandler,
  listAuditLogActorsHandler,
} from '../controllers/auditLogController.js';

const router = Router();

/**
 * @openapi
 * /api/audit-log:
 *   get:
 *     tags: [Audit]
 *     operationId: listAuditLog
 *     summary: List system-wide audit log entries (admin only)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: userId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: recordType
 *         schema: { type: string, enum: [contact, account, deal, user, system_settings] }
 *       - in: query
 *         name: eventType
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *     responses:
 *       200:
 *         description: Paginated audit log entries
 *       403:
 *         description: Forbidden (rep role)
 */
router.get('/', authenticate, requireRole('admin'), asyncHandler(listAuditLogHandler));

/**
 * @openapi
 * /api/audit-log/record:
 *   get:
 *     tags: [Audit]
 *     operationId: getRecordAuditLog
 *     summary: List audit log entries for a single record
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: record_type
 *         required: true
 *         schema: { type: string, enum: [contact, account, deal, user, system_settings] }
 *       - in: query
 *         name: record_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: all
 *         schema: { type: string, enum: ['true'] }
 *         description: Pass 'true' to return all history instead of the 20 most recent
 *     responses:
 *       200:
 *         description: Array of audit log entries for the record
 */
router.get('/record', authenticate, asyncHandler(getRecordAuditLogHandler));

/**
 * @openapi
 * /api/audit-log/actors:
 *   get:
 *     tags: [Audit]
 *     operationId: listAuditLogActors
 *     summary: List distinct users who appear in the audit log (admin only)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of { id, name } objects
 */
router.get('/actors', authenticate, requireRole('admin'), asyncHandler(listAuditLogActorsHandler));

export default router;
