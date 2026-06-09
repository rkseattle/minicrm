/**
 * Note controller — request/response shaping for note endpoints. (MINCRM-352)
 * No business logic; all DB access goes through noteService.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createNoteSchema,
  updateNoteSchema,
  NOTE_ENTITY_TYPES,
} from '@minicrm/shared/schemas/noteSchema.js';
import type { NoteEntityType } from '@minicrm/shared/schemas/noteSchema.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import {
  listNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
} from '../services/noteService.js';
import { getTagsRestrictCreation } from '../services/settingsService.js';

/** Validates that a string is a UUID */
const uuidSchema = z.string().uuid();

/** Returns the entityType from path params after validating it is a known type, or null */
function parseEntityType(raw: string): NoteEntityType | null {
  return (NOTE_ENTITY_TYPES as readonly string[]).includes(raw) ? (raw as NoteEntityType) : null;
}

/**
 * GET /api/v1/:entityType/:entityId/notes
 * Lists notes for a parent entity, applying visibility rules.
 */
export async function listNotesHandler(req: Request, res: Response): Promise<void> {
  const entityType = parseEntityType(String(req.params['entityType']));
  if (!entityType) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'entityType must be one of: contact, account, deal, lead',
      },
    });
    return;
  }

  const entityId = String(req.params['entityId']);
  if (!uuidSchema.safeParse(entityId).success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'entityId must be a valid UUID' } });
    return;
  }

  const pagination = paginationParamsSchema.safeParse(req.query);
  if (!pagination.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: pagination.error.errors[0]!.message },
    });
    return;
  }
  const { page, limit } = pagination.data;
  const notes = await listNotes(entityType, entityId, req.user!.id, page, limit);
  res.status(200).json(notes);
}

/**
 * POST /api/v1/:entityType/:entityId/notes
 * Creates a new note on the parent entity.
 */
export async function createNoteHandler(req: Request, res: Response): Promise<void> {
  const entityType = parseEntityType(String(req.params['entityType']));
  if (!entityType) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'entityType must be one of: contact, account, deal, lead',
      },
    });
    return;
  }

  const entityId = String(req.params['entityId']);
  if (!uuidSchema.safeParse(entityId).success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'entityId must be a valid UUID' } });
    return;
  }

  const parsed = createNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]!.message },
    });
    return;
  }

  // When tags are supplied, enforce tags_restrict_creation for rep callers (MINCRM-506)
  if (parsed.data.tags && parsed.data.tags.length > 0 && req.user!.role === 'rep') {
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

  const actor = { id: req.user!.id, name: req.user!.name };

  try {
    const note = await createNote(entityType, entityId, parsed.data, actor);
    res.status(201).json({ note });
  } catch (err) {
    const typedErr = err as { code?: string };
    if (typedErr.code === 'ENTITY_NOT_FOUND') {
      res
        .status(404)
        .json({ error: { code: 'ENTITY_NOT_FOUND', message: `${entityType} not found` } });
      return;
    }
    throw err;
  }
}

/**
 * GET /api/v1/:entityType/:entityId/notes/:noteId
 * Returns a single note, enforcing visibility rules.
 */
export async function getNoteHandler(req: Request, res: Response): Promise<void> {
  const entityType = parseEntityType(String(req.params['entityType']));
  if (!entityType) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'entityType must be one of: contact, account, deal, lead',
      },
    });
    return;
  }

  const entityId = String(req.params['entityId']);
  const noteId = String(req.params['noteId']);
  if (!uuidSchema.safeParse(entityId).success || !uuidSchema.safeParse(noteId).success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'entityId and noteId must be valid UUIDs' },
    });
    return;
  }

  const note = await getNoteById(entityType, entityId, noteId, req.user!.id);
  if (!note) {
    res.status(404).json({ error: { code: 'NOTE_NOT_FOUND', message: 'Note not found' } });
    return;
  }
  res.status(200).json({ note });
}

/**
 * PATCH /api/v1/:entityType/:entityId/notes/:noteId
 * Updates a note. Only the creator or an admin may update.
 */
export async function updateNoteHandler(req: Request, res: Response): Promise<void> {
  const entityType = parseEntityType(String(req.params['entityType']));
  if (!entityType) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'entityType must be one of: contact, account, deal, lead',
      },
    });
    return;
  }

  const entityId = String(req.params['entityId']);
  const noteId = String(req.params['noteId']);
  if (!uuidSchema.safeParse(entityId).success || !uuidSchema.safeParse(noteId).success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'entityId and noteId must be valid UUIDs' },
    });
    return;
  }

  const parsed = updateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]!.message },
    });
    return;
  }

  // When non-empty tags are present in the update body, enforce tags_restrict_creation for rep callers (MINCRM-506)
  // Empty array (clearing tags) does not create new tags, so no restriction applies.
  if (parsed.data.tags !== undefined && parsed.data.tags.length > 0 && req.user!.role === 'rep') {
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

  const actor = { id: req.user!.id, name: req.user!.name };

  try {
    const note = await updateNote(entityType, entityId, noteId, parsed.data, actor, req.user!.role);
    if (!note) {
      res.status(404).json({ error: { code: 'NOTE_NOT_FOUND', message: 'Note not found' } });
      return;
    }
    res.status(200).json({ note });
  } catch (err) {
    const typedErr = err as { code?: string };
    if (typedErr.code === 'FORBIDDEN') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only the note creator or an admin can edit this note.',
        },
      });
      return;
    }
    if (typedErr.code === 'VISIBILITY_CHANGE_FORBIDDEN') {
      res.status(403).json({
        error: {
          code: 'VISIBILITY_CHANGE_FORBIDDEN',
          message: 'Only the note creator can change visibility',
        },
      });
      return;
    }
    throw err;
  }
}

/**
 * DELETE /api/v1/:entityType/:entityId/notes/:noteId
 * Soft-deletes a note. Only the creator or an admin may delete.
 */
export async function deleteNoteHandler(req: Request, res: Response): Promise<void> {
  const entityType = parseEntityType(String(req.params['entityType']));
  if (!entityType) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'entityType must be one of: contact, account, deal, lead',
      },
    });
    return;
  }

  const entityId = String(req.params['entityId']);
  const noteId = String(req.params['noteId']);
  if (!uuidSchema.safeParse(entityId).success || !uuidSchema.safeParse(noteId).success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'entityId and noteId must be valid UUIDs' },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };

  try {
    const deleted = await deleteNote(entityType, entityId, noteId, actor, req.user!.role);
    if (!deleted) {
      res.status(404).json({ error: { code: 'NOTE_NOT_FOUND', message: 'Note not found' } });
      return;
    }
    res.status(204).send();
  } catch (err) {
    const typedErr = err as { code?: string };
    if (typedErr.code === 'FORBIDDEN') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only the note creator or an admin can delete this note.',
        },
      });
      return;
    }
    throw err;
  }
}
