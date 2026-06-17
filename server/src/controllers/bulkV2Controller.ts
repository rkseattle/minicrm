/**
 * Bulk V2 controller — request/response shaping for PATCH and DELETE bulk endpoints.
 *
 * Enforces max-500-IDs limit and validates the request body via Zod.
 * Capability checks (bulk:operations + entity capability) are handled by route
 * middleware before these handlers are reached. (MINCRM-562)
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  bulkPatchUsers,
  bulkDeleteUsers,
  bulkPatchContacts,
  bulkDeleteContacts,
  bulkPatchDeals,
  bulkDeleteDeals,
  bulkPatchActivities,
  bulkDeleteActivities,
  bulkPatchLeads,
  bulkDeleteLeads,
} from '../services/bulkV2Service.js';
import type { UserRole } from '@minicrm/shared/schemas/userSchema.js';
import { updateRoleSchema } from '@minicrm/shared/schemas/userSchema.js';

/** Maximum number of IDs allowed in a single bulk request (MINCRM-562). */
const BULK_MAX_IDS = 500;

/** Shared validation for the ids array. */
const idsSchema = z
  .array(z.string().uuid('Each id must be a valid UUID'))
  .min(1, 'ids must contain at least one record')
  .max(BULK_MAX_IDS, `ids must contain at most ${BULK_MAX_IDS} records`);

// ── Zod schemas ───────────────────────────────────────────────────────────────

const bulkUserPatchSchema = z.object({
  ids: idsSchema,
  patch: z
    .object({
      active: z.boolean().optional(),
      // Reuse the shared role enum to avoid a separate cast (UserRole is derived from USER_ROLES as const)
      role: updateRoleSchema.shape.role.optional() as z.ZodOptional<z.ZodType<UserRole>>,
    })
    .refine((p) => p.active !== undefined || p.role !== undefined, {
      message: 'patch must include at least one field: active or role',
    }),
});

const bulkDeleteSchema = z.object({
  ids: idsSchema,
});

const bulkContactPatchSchema = z.object({
  ids: idsSchema,
  patch: z.object({
    owner_id: z.string().uuid('owner_id must be a valid UUID'),
  }),
});

const bulkDealPatchSchema = z.object({
  ids: idsSchema,
  patch: z
    .object({
      owner_id: z.string().uuid('owner_id must be a valid UUID').optional(),
      stage: z.string().min(1, 'stage must be a non-empty string').optional(),
    })
    .refine((p) => p.owner_id !== undefined || p.stage !== undefined, {
      message: 'patch must include at least one field: owner_id or stage',
    }),
});

const bulkActivityPatchSchema = z.object({
  ids: idsSchema,
  patch: z.object({
    owner_id: z.string().uuid('owner_id must be a valid UUID'),
  }),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a 400 response when Zod validation fails.
 * Checks ids.length first so over-limit batches get BULK_LIMIT_EXCEEDED rather
 * than a generic VALIDATION_ERROR.
 */
function sendValidationError(res: Response, message: string, isOverLimit: boolean): void {
  res.status(400).json({
    error: {
      code: isOverLimit ? 'BULK_LIMIT_EXCEEDED' : 'VALIDATION_ERROR',
      message,
    },
  });
}

// ── Users ─────────────────────────────────────────────────────────────────────

/**
 * PATCH /api/users/bulk
 * Bulk patch users (activate/deactivate/role change). Admin only + bulk:operations + users:edit.
 */
export async function bulkPatchUsersHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkUserPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.errors[0].message;
    const isOverLimit = message.includes(`${BULK_MAX_IDS}`);
    sendValidationError(res, message, isOverLimit);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name }; // safe: authenticate middleware ran
  const result = await bulkPatchUsers(parsed.data, actor);
  res.json(result);
}

/**
 * DELETE /api/users/bulk
 * Bulk delete users. Admin only + bulk:operations + users:delete.
 */
export async function bulkDeleteUsersHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.errors[0].message;
    const isOverLimit = message.includes(`${BULK_MAX_IDS}`);
    sendValidationError(res, message, isOverLimit);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name }; // safe: authenticate middleware ran
  const result = await bulkDeleteUsers(parsed.data, actor);
  res.json(result);
}

// ── Contacts ──────────────────────────────────────────────────────────────────

/**
 * PATCH /api/contacts/bulk
 * Bulk patch contacts (reassign owner). Requires bulk:operations + contacts:edit.
 */
export async function bulkPatchContactsHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkContactPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.errors[0].message;
    const isOverLimit = message.includes(`${BULK_MAX_IDS}`);
    sendValidationError(res, message, isOverLimit);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role }; // safe: authenticate middleware ran
  const result = await bulkPatchContacts(parsed.data, actor);
  res.json(result);
}

/**
 * DELETE /api/contacts/bulk
 * Bulk delete contacts. Requires bulk:operations + contacts:delete.
 */
export async function bulkDeleteContactsHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.errors[0].message;
    const isOverLimit = message.includes(`${BULK_MAX_IDS}`);
    sendValidationError(res, message, isOverLimit);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role }; // safe: authenticate middleware ran
  const result = await bulkDeleteContacts(parsed.data, actor);
  res.json(result);
}

// ── Deals ─────────────────────────────────────────────────────────────────────

/**
 * PATCH /api/deals/bulk
 * Bulk patch deals (reassign owner or change stage). Requires bulk:operations + deals:edit.
 */
export async function bulkPatchDealsHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkDealPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.errors[0].message;
    const isOverLimit = message.includes(`${BULK_MAX_IDS}`);
    sendValidationError(res, message, isOverLimit);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role }; // safe: authenticate middleware ran
  try {
    const result = await bulkPatchDeals(parsed.data, actor);
    res.json(result);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'VALIDATION_ERROR') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: (err as Error).message },
      });
      return;
    }
    throw err;
  }
}

/**
 * DELETE /api/deals/bulk
 * Bulk delete deals. Requires bulk:operations + deals:delete.
 */
export async function bulkDeleteDealsHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.errors[0].message;
    const isOverLimit = message.includes(`${BULK_MAX_IDS}`);
    sendValidationError(res, message, isOverLimit);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role }; // safe: authenticate middleware ran
  const result = await bulkDeleteDeals(parsed.data, actor);
  res.json(result);
}

// ── Activities ────────────────────────────────────────────────────────────────

/**
 * PATCH /api/activities/bulk
 * Bulk patch activities (reassign owner). Requires bulk:operations + activities:edit.
 */
export async function bulkPatchActivitiesHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkActivityPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.errors[0].message;
    const isOverLimit = message.includes(`${BULK_MAX_IDS}`);
    sendValidationError(res, message, isOverLimit);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role }; // safe: authenticate middleware ran
  const result = await bulkPatchActivities(parsed.data, actor);
  res.json(result);
}

/**
 * DELETE /api/activities/bulk
 * Bulk delete activities. Requires bulk:operations + activities:delete.
 */
export async function bulkDeleteActivitiesHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.errors[0].message;
    const isOverLimit = message.includes(`${BULK_MAX_IDS}`);
    sendValidationError(res, message, isOverLimit);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role }; // safe: authenticate middleware ran
  const result = await bulkDeleteActivities(parsed.data, actor);
  res.json(result);
}

// ── Leads ─────────────────────────────────────────────────────────────────────

const bulkLeadPatchSchema = z.object({
  ids: idsSchema,
  patch: z.object({
    owner_id: z.string().uuid('owner_id must be a valid UUID'),
  }),
});

/**
 * PATCH /api/leads/bulk
 * Bulk patch leads (reassign owner). Requires bulk:operations + contacts:edit.
 */
export async function bulkPatchLeadsHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkLeadPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.errors[0].message;
    const isOverLimit = message.includes(`${BULK_MAX_IDS}`);
    sendValidationError(res, message, isOverLimit);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role }; // safe: authenticate middleware ran
  const result = await bulkPatchLeads(parsed.data, actor);
  res.json(result);
}

/**
 * DELETE /api/leads/bulk
 * Bulk delete leads. Requires bulk:operations + contacts:delete.
 */
export async function bulkDeleteLeadsHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.errors[0].message;
    const isOverLimit = message.includes(`${BULK_MAX_IDS}`);
    sendValidationError(res, message, isOverLimit);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role }; // safe: authenticate middleware ran
  const result = await bulkDeleteLeads(parsed.data, actor);
  res.json(result);
}
