/**
 * Audit log routes. (MINCRM-170, MINCRM-171, MINCRM-172)
 *
 * GET /api/v1/audit-log/record  — any authenticated user: entries for a specific record
 * GET /api/v1/audit-log/actors  — admin only: distinct users in the audit log
 *
 * Note: GET /api/v1/audit-log (paginated system-wide list) was removed in MINCRM-377.
 * The admin audit log page now fetches via gRPC (ConnectRPC) instead.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getRecordAuditLogHandler,
  listAuditLogActorsHandler,
} from '../controllers/auditLogController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/audit-log/record:
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
 * /api/v1/audit-log/actors:
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
