/**
 * Activity controller — request/response shaping for activity endpoints.
 * No business logic here; all DB access goes through activityService.
 */

import type { Request, Response } from 'express';
import {
  createActivitySchema,
  updateActivitySchema,
} from '@minicrm/shared/schemas/activitySchema.js';
import {
  createActivity,
  findActivityById,
  listActivities,
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
 * GET /api/activities
 * Lists activities. Supports ?contact=<uuid>, ?account=<uuid>, ?deal=<uuid>, ?owner=me filters.
 */
export async function listActivitiesHandler(req: Request, res: Response): Promise<void> {
  const contactId =
    typeof req.query.contact === 'string' && req.query.contact ? req.query.contact : undefined;
  const accountId =
    typeof req.query.account === 'string' && req.query.account ? req.query.account : undefined;
  const dealId = typeof req.query.deal === 'string' && req.query.deal ? req.query.deal : undefined;
  const ownerId = req.query.owner === 'me' ? req.user!.id : undefined;

  const activities = await listActivities({ contactId, accountId, dealId, ownerId });
  res.status(200).json({ activities });
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
