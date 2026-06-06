/**
 * Sequence controller — request/response shaping for sales sequence endpoints (MINCRM-403).
 * No business logic here; all DB access goes through sequenceService.
 */

import type { Request, Response } from 'express';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import {
  createSequenceSchema,
  updateSequenceSchema,
  createSequenceStepSchema,
  updateSequenceStepSchema,
} from '@minicrm/shared/schemas/sequenceSchema.js';
import {
  createSequence,
  findSequenceById,
  listSequences,
  updateSequence,
  deleteSequence,
  listSteps,
  findStepById,
  createStep,
  updateStep,
  deleteStep,
  findEnrollmentById,
  listEnrollmentsForContact,
  enrollContact,
  unenrollContact,
  validateStepActionConfig,
} from '../services/sequenceService.js';

// ── Sequence handlers ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/sequences
 * Creates a new sequence. Admin only.
 */
export async function createSequenceHandler(req: Request, res: Response): Promise<void> {
  const parsed = createSequenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const sequence = await createSequence({ ...parsed.data, created_by: req.user!.id }, actor);
  res.status(201).json({ sequence });
}

/**
 * GET /api/v1/sequences
 * Lists sequences with pagination. Authenticated users.
 */
export async function listSequencesHandler(req: Request, res: Response): Promise<void> {
  const parsed = paginationParamsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }
  const result = await listSequences(parsed.data.page, parsed.data.limit);
  res.status(200).json(result);
}

/**
 * GET /api/v1/sequences/:id
 * Returns a single sequence. Authenticated users.
 */
export async function getSequenceHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const sequence = await findSequenceById(id);
  if (!sequence) {
    res.status(404).json({ error: { code: 'SEQUENCE_NOT_FOUND', message: 'Sequence not found' } });
    return;
  }
  res.status(200).json({ sequence });
}

/**
 * PATCH /api/v1/sequences/:id
 * Updates a sequence. Admin only.
 */
export async function updateSequenceHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateSequenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const id = String(req.params['id']);
  const actor = { id: req.user!.id, name: req.user!.name };
  const sequence = await updateSequence(id, parsed.data, actor);
  if (!sequence) {
    res.status(404).json({ error: { code: 'SEQUENCE_NOT_FOUND', message: 'Sequence not found' } });
    return;
  }
  res.status(200).json({ sequence });
}

/**
 * DELETE /api/v1/sequences/:id
 * Deletes a sequence and all its steps. Admin only.
 */
export async function deleteSequenceHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const actor = { id: req.user!.id, name: req.user!.name };

  let deleted;
  try {
    deleted = await deleteSequence(id, actor);
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException & { code?: string }).code === 'SEQUENCE_HAS_ACTIVE_ENROLLMENTS'
    ) {
      res.status(409).json({
        error: {
          code: 'SEQUENCE_HAS_ACTIVE_ENROLLMENTS',
          message: (err as Error).message,
        },
      });
      return;
    }
    throw err;
  }

  if (!deleted) {
    res.status(404).json({ error: { code: 'SEQUENCE_NOT_FOUND', message: 'Sequence not found' } });
    return;
  }
  res.status(204).send();
}

// ── Step handlers ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/sequences/:id/steps
 * Returns all steps for a sequence, ordered by sort_order. Authenticated users.
 */
export async function listStepsHandler(req: Request, res: Response): Promise<void> {
  const sequenceId = String(req.params['id']);
  const sequence = await findSequenceById(sequenceId);
  if (!sequence) {
    res.status(404).json({ error: { code: 'SEQUENCE_NOT_FOUND', message: 'Sequence not found' } });
    return;
  }
  const steps = await listSteps(sequenceId);
  res.status(200).json({ steps });
}

/**
 * POST /api/v1/sequences/:id/steps
 * Adds a step to a sequence. Admin only.
 */
export async function createStepHandler(req: Request, res: Response): Promise<void> {
  const sequenceId = String(req.params['id']);

  const sequence = await findSequenceById(sequenceId);
  if (!sequence) {
    res.status(404).json({ error: { code: 'SEQUENCE_NOT_FOUND', message: 'Sequence not found' } });
    return;
  }

  const parsed = createSequenceStepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const configError = validateStepActionConfig(
    parsed.data.action_type,
    parsed.data.action_config as Record<string, unknown>,
  );
  if (configError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: configError } });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };

  let step;
  try {
    step = await createStep(sequenceId, parsed.data, actor);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === '23505') {
      res.status(409).json({
        error: {
          code: 'STEP_SORT_ORDER_CONFLICT',
          message: 'A step with this sort order already exists in the sequence',
        },
      });
      return;
    }
    throw err;
  }

  res.status(201).json({ step });
}

/**
 * PATCH /api/v1/sequences/:id/steps/:stepId
 * Updates a step. Admin only.
 */
export async function updateStepHandler(req: Request, res: Response): Promise<void> {
  const stepId = String(req.params['stepId']);

  const parsed = updateSequenceStepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const existing = await findStepById(stepId);
  if (!existing) {
    res.status(404).json({ error: { code: 'STEP_NOT_FOUND', message: 'Step not found' } });
    return;
  }

  // Validate merged action_config if action_type or action_config changed
  const mergedActionType = parsed.data.action_type ?? existing.action_type;
  const mergedActionConfig =
    (parsed.data.action_config as Record<string, unknown> | undefined) ?? existing.action_config;
  const configError = validateStepActionConfig(mergedActionType, mergedActionConfig);
  if (configError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: configError } });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };

  let step;
  try {
    step = await updateStep(stepId, parsed.data, actor);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === '23505') {
      res.status(409).json({
        error: {
          code: 'STEP_SORT_ORDER_CONFLICT',
          message: 'A step with this sort order already exists in the sequence',
        },
      });
      return;
    }
    throw err;
  }

  if (!step) {
    res.status(404).json({ error: { code: 'STEP_NOT_FOUND', message: 'Step not found' } });
    return;
  }
  res.status(200).json({ step });
}

/**
 * DELETE /api/v1/sequences/:id/steps/:stepId
 * Deletes a step. Admin only.
 */
export async function deleteStepHandler(req: Request, res: Response): Promise<void> {
  const stepId = String(req.params['stepId']);
  const actor = { id: req.user!.id, name: req.user!.name };

  let deleted;
  try {
    deleted = await deleteStep(stepId, actor);
  } catch (err) {
    if ((err as NodeJS.ErrnoException & { code?: string }).code === 'STEP_HAS_ACTIVE_ENROLLMENTS') {
      res.status(409).json({
        error: { code: 'STEP_HAS_ACTIVE_ENROLLMENTS', message: (err as Error).message },
      });
      return;
    }
    throw err;
  }

  if (!deleted) {
    res.status(404).json({ error: { code: 'STEP_NOT_FOUND', message: 'Step not found' } });
    return;
  }
  res.status(204).send();
}

// ── Enrollment handlers ────────────────────────────────────────────────────────

/**
 * POST /api/v1/contacts/:id/sequence-enrollments
 * Enrolls a contact in a sequence. Authenticated users.
 */
export async function enrollContactHandler(req: Request, res: Response): Promise<void> {
  const contactId = String(req.params['id']);

  const sequenceIdRaw = req.body?.sequence_id;
  if (!sequenceIdRaw || typeof sequenceIdRaw !== 'string') {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'sequence_id is required' },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };

  let enrollment;
  try {
    enrollment = await enrollContact(sequenceIdRaw, contactId, actor);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException & { code?: string }).code;
    if (code === 'SEQUENCE_NOT_FOUND') {
      res
        .status(404)
        .json({ error: { code: 'SEQUENCE_NOT_FOUND', message: (err as Error).message } });
      return;
    }
    if (code === 'SEQUENCE_DISABLED') {
      res
        .status(409)
        .json({ error: { code: 'SEQUENCE_DISABLED', message: (err as Error).message } });
      return;
    }
    if (code === 'SEQUENCE_HAS_NO_STEPS') {
      res
        .status(400)
        .json({ error: { code: 'SEQUENCE_HAS_NO_STEPS', message: (err as Error).message } });
      return;
    }
    if (code === 'ENROLLMENT_DUPLICATE') {
      res
        .status(409)
        .json({ error: { code: 'ENROLLMENT_DUPLICATE', message: (err as Error).message } });
      return;
    }
    throw err;
  }

  res.status(201).json({ enrollment });
}

/**
 * GET /api/v1/contacts/:id/sequence-enrollments
 * Returns all enrollments for a contact. Authenticated users.
 */
export async function listContactEnrollmentsHandler(req: Request, res: Response): Promise<void> {
  const contactId = String(req.params['id']);
  const enrollments = await listEnrollmentsForContact(contactId);
  res.status(200).json({ enrollments });
}

/**
 * DELETE /api/v1/sequence-enrollments/:id
 * Unenrolls a contact from a sequence. Authenticated users.
 */
export async function unenrollContactHandler(req: Request, res: Response): Promise<void> {
  const enrollmentId = String(req.params['id']);
  const actor = { id: req.user!.id, name: req.user!.name };

  let enrollment;
  try {
    enrollment = await unenrollContact(enrollmentId, actor);
  } catch (err) {
    if ((err as NodeJS.ErrnoException & { code?: string }).code === 'ENROLLMENT_NOT_ACTIVE') {
      res.status(409).json({
        error: { code: 'ENROLLMENT_NOT_ACTIVE', message: (err as Error).message },
      });
      return;
    }
    throw err;
  }

  if (!enrollment) {
    res.status(404).json({
      error: { code: 'ENROLLMENT_NOT_FOUND', message: 'Enrollment not found' },
    });
    return;
  }
  res.status(200).json({ enrollment });
}

/**
 * GET /api/v1/sequence-enrollments/:id
 * Returns a single enrollment. Authenticated users.
 */
export async function getEnrollmentHandler(req: Request, res: Response): Promise<void> {
  const enrollmentId = String(req.params['id']);
  const enrollment = await findEnrollmentById(enrollmentId);
  if (!enrollment) {
    res.status(404).json({
      error: { code: 'ENROLLMENT_NOT_FOUND', message: 'Enrollment not found' },
    });
    return;
  }
  res.status(200).json({ enrollment });
}
