/**
 * Tag controller — request/response shaping for tag endpoints.
 * No business logic here; all DB access goes through tagService.
 */

import type { Request, Response } from 'express';
import {
  createTagSchema,
  updateTagSchema,
  attachTagSchema,
} from '@minicrm/shared/schemas/tagSchema.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import {
  listTags,
  findTagById,
  createTag,
  updateTag,
  deleteTag,
  listEntityTags,
  attachTag,
  detachTag,
} from '../services/tagService.js';
import { getTagsRestrictCreation } from '../services/settingsService.js';

// ── Global tag CRUD ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/tags
 * Returns a paginated list of tags ordered by name.
 */
export async function listTagsHandler(req: Request, res: Response): Promise<void> {
  const parsed = paginationParamsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }
  const result = await listTags(parsed.data.page, parsed.data.limit);
  res.json(result);
}

/**
 * POST /api/v1/tags
 * Creates a new tag. Returns the existing tag if name already exists (idempotent).
 * When tags_restrict_creation is true, rep callers receive 403.
 */
export async function createTagHandler(req: Request, res: Response): Promise<void> {
  const parsed = createTagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  if (req.user!.role === 'rep') {
    const restricted = await getTagsRestrictCreation();
    if (restricted) {
      res.status(403).json({
        error: {
          code: 'TAG_CREATION_RESTRICTED',
          message: 'Tag creation is restricted to admins. Contact your admin to add new tags.',
        },
      });
      return;
    }
  }

  const tag = await createTag(parsed.data);
  res.status(201).json({ tag });
}

/**
 * PATCH /api/v1/tags/:id
 * Renames a tag. Admin only (enforced at route level via requireRole).
 */
export async function updateTagHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateTagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }
  const tag = await updateTag(String(req.params['id']), parsed.data);
  if (!tag) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tag not found' } });
    return;
  }
  res.json({ tag });
}

/**
 * DELETE /api/v1/tags/:id
 * Deletes a tag and removes it from all records. Admin only.
 */
export async function deleteTagHandler(req: Request, res: Response): Promise<void> {
  const deleted = await deleteTag(String(req.params['id']));
  if (!deleted) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tag not found' } });
    return;
  }
  res.status(204).end();
}

// ── Entity-scoped tag endpoints ────────────────────────────────────────────────

/**
 * GET /api/v1/contacts/:id/tags
 * GET /api/v1/accounts/:id/tags
 * GET /api/v1/deals/:id/tags
 * Returns all tags attached to the record.
 */
export async function listContactTagsHandler(req: Request, res: Response): Promise<void> {
  const tags = await listEntityTags('contact', String(req.params['id']));
  res.json({ tags });
}

export async function listAccountTagsHandler(req: Request, res: Response): Promise<void> {
  const tags = await listEntityTags('account', String(req.params['id']));
  res.json({ tags });
}

export async function listDealTagsHandler(req: Request, res: Response): Promise<void> {
  const tags = await listEntityTags('deal', String(req.params['id']));
  res.json({ tags });
}

/**
 * POST /api/v1/contacts/:id/tags
 * POST /api/v1/accounts/:id/tags
 * POST /api/v1/deals/:id/tags
 * Attaches a tag to the record by name, creating the tag if needed.
 */
export async function attachContactTagHandler(req: Request, res: Response): Promise<void> {
  const parsed = attachTagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }
  const actor = { id: req.user!.id, name: req.user!.name };
  const tag = await attachTag('contact', String(req.params['id']), parsed.data, actor);
  res.status(201).json({ tag });
}

export async function attachAccountTagHandler(req: Request, res: Response): Promise<void> {
  const parsed = attachTagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }
  const actor = { id: req.user!.id, name: req.user!.name };
  const tag = await attachTag('account', String(req.params['id']), parsed.data, actor);
  res.status(201).json({ tag });
}

export async function attachDealTagHandler(req: Request, res: Response): Promise<void> {
  const parsed = attachTagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }
  const actor = { id: req.user!.id, name: req.user!.name };
  const tag = await attachTag('deal', String(req.params['id']), parsed.data, actor);
  res.status(201).json({ tag });
}

/**
 * DELETE /api/v1/contacts/:id/tags/:tagId
 * DELETE /api/v1/accounts/:id/tags/:tagId
 * DELETE /api/v1/deals/:id/tags/:tagId
 * Detaches a tag from the record.
 */
export async function detachContactTagHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, name: req.user!.name };
  await detachTag('contact', String(req.params['id']), String(req.params['tagId']), actor);
  res.status(204).end();
}

export async function detachAccountTagHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, name: req.user!.name };
  await detachTag('account', String(req.params['id']), String(req.params['tagId']), actor);
  res.status(204).end();
}

export async function detachDealTagHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, name: req.user!.name };
  await detachTag('deal', String(req.params['id']), String(req.params['tagId']), actor);
  res.status(204).end();
}

/**
 * GET /api/v1/tags/:id
 * Returns a single tag by ID.
 */
export async function getTagHandler(req: Request, res: Response): Promise<void> {
  const tag = await findTagById(String(req.params['id']));
  if (!tag) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tag not found' } });
    return;
  }
  res.json({ tag });
}
