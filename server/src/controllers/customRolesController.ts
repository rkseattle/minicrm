/**
 * Custom roles controller — request/response shaping for MINCRM-542 capability RBAC.
 * All endpoints are admin-gated via requireCapability(SettingsManage) on the router.
 * No business logic or direct DB access here.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createCustomRoleSchema,
  updateCustomRoleSchema,
  assignUserRoleSchema,
} from '@minicrm/shared/schemas/capabilitySchema.js';
import * as roleService from '../services/roleService.js';
import { findUserById } from '../services/userService.js';

// ── Custom role CRUD ──────────────────────────────────────────────────────────

/** GET /api/v1/custom-roles */
export async function listCustomRolesHandler(req: Request, res: Response): Promise<void> {
  const roles = await roleService.getAllCustomRoles();
  res.json({ data: roles });
}

/** GET /api/v1/custom-roles/:id */
export async function getCustomRoleHandler(req: Request, res: Response): Promise<void> {
  const idParse = z.string().uuid().safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid role ID' } });
    return;
  }

  const role = await roleService.getCustomRoleById(idParse.data);
  if (!role) {
    res.status(404).json({ error: { code: 'CUSTOM_ROLE_NOT_FOUND', message: 'Role not found' } });
    return;
  }
  res.json({ data: role });
}

/** POST /api/v1/custom-roles */
export async function createCustomRoleHandler(req: Request, res: Response): Promise<void> {
  const parse = createCustomRoleSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    const role = await roleService.createCustomRole(parse.data, actor);
    res.status(201).json({ data: role });
  } catch (err: unknown) {
    const serviceErr = err as Error & { code?: string; statusCode?: number };
    if (serviceErr.code === 'CUSTOM_ROLE_DUPLICATE') {
      res.status(409).json({
        error: { code: 'CUSTOM_ROLE_DUPLICATE', message: serviceErr.message },
      });
      return;
    }
    throw err;
  }
}

/** PUT /api/v1/custom-roles/:id */
export async function updateCustomRoleHandler(req: Request, res: Response): Promise<void> {
  const idParse = z.string().uuid().safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid role ID' } });
    return;
  }

  const parse = updateCustomRoleSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    const role = await roleService.updateCustomRole(idParse.data, parse.data, actor);
    res.json({ data: role });
  } catch (err: unknown) {
    const serviceErr = err as Error & { code?: string; statusCode?: number };
    if (serviceErr.code === 'CUSTOM_ROLE_NOT_FOUND') {
      res
        .status(404)
        .json({ error: { code: 'CUSTOM_ROLE_NOT_FOUND', message: serviceErr.message } });
      return;
    }
    if (serviceErr.code === 'CUSTOM_ROLE_BUILTIN') {
      res.status(409).json({ error: { code: 'CUSTOM_ROLE_BUILTIN', message: serviceErr.message } });
      return;
    }
    throw err;
  }
}

/** DELETE /api/v1/custom-roles/:id */
export async function deleteCustomRoleHandler(req: Request, res: Response): Promise<void> {
  const idParse = z.string().uuid().safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid role ID' } });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    await roleService.deleteCustomRole(idParse.data, actor);
    res.status(204).send();
  } catch (err: unknown) {
    const serviceErr = err as Error & { code?: string; statusCode?: number };
    if (serviceErr.code === 'CUSTOM_ROLE_NOT_FOUND') {
      res
        .status(404)
        .json({ error: { code: 'CUSTOM_ROLE_NOT_FOUND', message: serviceErr.message } });
      return;
    }
    if (serviceErr.code === 'CUSTOM_ROLE_BUILTIN') {
      res.status(409).json({ error: { code: 'CUSTOM_ROLE_BUILTIN', message: serviceErr.message } });
      return;
    }
    if (serviceErr.code === 'CUSTOM_ROLE_HAS_ASSIGNEES') {
      res
        .status(409)
        .json({ error: { code: 'CUSTOM_ROLE_HAS_ASSIGNEES', message: serviceErr.message } });
      return;
    }
    throw err;
  }
}

// ── User role assignment sub-resource ─────────────────────────────────────────

/** GET /api/v1/users/:id/roles */
export async function listUserRolesHandler(req: Request, res: Response): Promise<void> {
  const idParse = z.string().uuid().safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid user ID' } });
    return;
  }

  const user = await findUserById(idParse.data);
  if (!user) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    return;
  }

  const roles = await roleService.getUserRoles(idParse.data);
  res.json({ data: roles });
}

/** POST /api/v1/users/:id/roles */
export async function assignUserRoleHandler(req: Request, res: Response): Promise<void> {
  const idParse = z.string().uuid().safeParse(req.params.id);
  if (!idParse.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid user ID' } });
    return;
  }

  const parse = assignUserRoleSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0].message },
    });
    return;
  }

  const user = await findUserById(idParse.data);
  if (!user) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    await roleService.assignRoleToUser(idParse.data, parse.data.roleId, actor);
    res.status(204).send();
  } catch (err: unknown) {
    const serviceErr = err as Error & { code?: string; statusCode?: number };
    if (serviceErr.code === 'CUSTOM_ROLE_NOT_FOUND') {
      res
        .status(404)
        .json({ error: { code: 'CUSTOM_ROLE_NOT_FOUND', message: serviceErr.message } });
      return;
    }
    throw err;
  }
}

/** DELETE /api/v1/users/:id/roles/:roleId */
export async function removeUserRoleHandler(req: Request, res: Response): Promise<void> {
  const userIdParse = z.string().uuid().safeParse(req.params.id);
  if (!userIdParse.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid user ID' } });
    return;
  }

  const roleIdParse = z.string().uuid().safeParse(req.params.roleId);
  if (!roleIdParse.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid role ID' } });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    await roleService.removeRoleFromUser(userIdParse.data, roleIdParse.data, actor);
    res.status(204).send();
  } catch (err: unknown) {
    const serviceErr = err as Error & { code?: string; statusCode?: number };
    if (serviceErr.code === 'CUSTOM_ROLE_NOT_FOUND') {
      res
        .status(404)
        .json({ error: { code: 'CUSTOM_ROLE_NOT_FOUND', message: serviceErr.message } });
      return;
    }
    throw err;
  }
}
