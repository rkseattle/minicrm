/**
 * Activity controller — request/response shaping for activity endpoints.
 * No business logic here; all DB access goes through activityService.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createActivitySchema,
  updateActivitySchema,
} from '@minicrm/shared/schemas/activitySchema.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';

/** Zod schema used to validate UUID-typed query params */
const uuidQuerySchema = z.string().uuid();
import {
  createActivity,
  findActivityById,
  listActivities,
  listMyTasks,
  updateActivity,
  deleteActivity,
} from '../services/activityService.js';

const FORBIDDEN_ERROR = { error: { code: 'FORBIDDEN', message: 'Forbidden' } };

/**
 * POST /api/activities
 * Creates a new activity owned by the authenticated user.
 */
export async function createActivityHandler(req: Request, res: Response): Promise<void> {
  const parsed = createActivitySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const activity = await createActivity({ ...parsed.data, owner_id: req.user!.id });
  res.status(201).json({ activity });
}

/**
 * GET /api/activities/my-tasks
 * Returns a paginated list of Task-type activities owned by the authenticated user.
 * Includes the linked record name and type for display.
 */
export async function listMyTasksHandler(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationParamsSchema.parse(req.query);
  const { tasks, total } = await listMyTasks(req.user!.id, page, limit);
  res.status(200).json({ tasks, total, page, limit });
}

/**
 * GET /api/activities
 * Lists activities with optional filters and pagination:
 *   ?contact=<uuid> — filter by contact UUID
 *   ?account=<uuid> — filter by account UUID
 *   ?deal=<uuid>    — filter by deal UUID
 *   ?owner=me       — scope to the authenticated user's activities
 *   ?page=<n>       — 1-based page number (default 1)
 *   ?limit=<n>      — records per page (default 50, max 100)
 */
export async function listActivitiesHandler(req: Request, res: Response): Promise<void> {
  // Validate UUID-typed filters; return 400 instead of letting PostgreSQL throw a 500
  const rawContact = typeof req.query.contact === 'string' ? req.query.contact : undefined;
  const rawAccount = typeof req.query.account === 'string' ? req.query.account : undefined;
  const rawDeal = typeof req.query.deal === 'string' ? req.query.deal : undefined;

  if (rawContact && !uuidQuerySchema.safeParse(rawContact).success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'contact must be a valid UUID' } });
    return;
  }
  if (rawAccount && !uuidQuerySchema.safeParse(rawAccount).success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'account must be a valid UUID' } });
    return;
  }
  if (rawDeal && !uuidQuerySchema.safeParse(rawDeal).success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'deal must be a valid UUID' } });
    return;
  }

  // ?owner=me — scope to the authenticated user
  // ?owner=<uuid> — admin only; scope to a specific user
  let ownerId: string | undefined;
  const ownerParam = typeof req.query.owner === 'string' ? req.query.owner : undefined;
  if (ownerParam === 'me') {
    ownerId = req.user!.id;
  } else if (ownerParam && uuidQuerySchema.safeParse(ownerParam).success) {
    if (req.user!.role !== 'admin') {
      // Reps may not filter by arbitrary owner UUID; silently scope to themselves
      ownerId = req.user!.id;
    } else {
      ownerId = ownerParam;
    }
  }

  const paginationParsed = paginationParamsSchema.safeParse({
    page: req.query.page,
    limit: req.query.limit,
  });
  if (!paginationParsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: paginationParsed.error.errors[0].message },
    });
    return;
  }

  const rawType = typeof req.query.type === 'string' ? req.query.type : undefined;
  const rawStart = typeof req.query.start === 'string' ? req.query.start : undefined;
  const rawEnd = typeof req.query.end === 'string' ? req.query.end : undefined;

  // Validate date format (YYYY-MM-DD) to prevent malformed SQL comparisons
  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (rawStart && !isoDatePattern.test(rawStart)) {
    res
      .status(400)
      .json({
        error: { code: 'VALIDATION_ERROR', message: 'start must be a date in YYYY-MM-DD format' },
      });
    return;
  }
  if (rawEnd && !isoDatePattern.test(rawEnd)) {
    res
      .status(400)
      .json({
        error: { code: 'VALIDATION_ERROR', message: 'end must be a date in YYYY-MM-DD format' },
      });
    return;
  }

  const result = await listActivities({
    contactId: rawContact,
    accountId: rawAccount,
    dealId: rawDeal,
    ownerId,
    type: rawType,
    start: rawStart,
    end: rawEnd,
    ...paginationParsed.data,
  });
  res.status(200).json(result);
}

/**
 * GET /api/activities/:id
 * Returns a single activity by ID.
 */
export async function getActivityHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const activity = await findActivityById(id);

  if (!activity) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Activity not found' } });
    return;
  }

  res.status(200).json({ activity });
}

/**
 * PATCH /api/activities/:id
 * Updates one or more fields of an existing activity.
 * Reps may only update activities they own; admins may update any activity.
 */
export async function updateActivityHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateActivitySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const id = String(req.params['id']);
  const existing = await findActivityById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Activity not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  // When the patch omits `type`, the existing type determines the direction requirement.
  // This catches the case where a client explicitly sets direction: null on an existing
  // Call or Email activity without also changing the type.
  const effectiveType = parsed.data.type ?? existing.type;
  const isCommunicationType = effectiveType === 'Call' || effectiveType === 'Email';
  if (isCommunicationType && parsed.data.direction === null) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Direction is required for Call and Email activities',
      },
    });
    return;
  }

  const activity = await updateActivity(id, parsed.data);
  if (!activity) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Activity not found' } });
    return;
  }

  res.status(200).json({ activity });
}

/**
 * DELETE /api/activities/:id
 * Deletes an activity. Returns 204 No Content on success.
 * Reps may only delete activities they own; admins may delete any activity.
 */
export async function deleteActivityHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const existing = await findActivityById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Activity not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  await deleteActivity(id);
  res.status(204).send();
}
