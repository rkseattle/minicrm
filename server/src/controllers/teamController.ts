/**
 * Team controller — request/response shaping for the teams API. (MINCRM-537)
 * No business logic or database access belongs here.
 */

import type { Request, Response } from 'express';
import {
  createTeamSchema,
  updateTeamSchema,
  addTeamMemberSchema,
} from '@minicrm/shared/schemas/teamSchema.js';
import {
  createTeam,
  getTeamById,
  listTeams,
  updateTeam,
  deleteTeam,
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
} from '../services/teamService.js';

// ── Teams ──────────────────────────────────────────────────────────────────────

export async function listTeamsHandler(req: Request, res: Response): Promise<void> {
  const teams = await listTeams();
  res.json({ teams });
}

export async function getTeamHandler(req: Request, res: Response): Promise<void> {
  const team = await getTeamById(String(req.params['id']));
  if (!team) {
    res.status(404).json({ error: { code: 'TEAM_NOT_FOUND', message: 'Team not found' } });
    return;
  }
  res.json({ team });
}

export async function createTeamHandler(req: Request, res: Response): Promise<void> {
  const parsed = createTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    const team = await createTeam(parsed.data, actor);
    res.status(201).json({ team });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'TEAM_NAME_DUPLICATE') {
      res.status(409).json({ error: { code, message: (err as Error).message } });
      return;
    }
    if (code === 'MANAGER_OR_PARENT_NOT_FOUND') {
      res.status(400).json({ error: { code, message: (err as Error).message } });
      return;
    }
    throw err;
  }
}

export async function updateTeamHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    const team = await updateTeam(String(req.params['id']), parsed.data, actor);
    if (!team) {
      res.status(404).json({ error: { code: 'TEAM_NOT_FOUND', message: 'Team not found' } });
      return;
    }
    res.json({ team });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'TEAM_NAME_DUPLICATE') {
      res.status(409).json({ error: { code, message: (err as Error).message } });
      return;
    }
    if (code === 'TEAM_CIRCULAR_REFERENCE' || code === 'MANAGER_OR_PARENT_NOT_FOUND') {
      res.status(400).json({ error: { code, message: (err as Error).message } });
      return;
    }
    throw err;
  }
}

export async function deleteTeamHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    const deleted = await deleteTeam(String(req.params['id']), actor);
    if (!deleted) {
      res.status(404).json({ error: { code: 'TEAM_NOT_FOUND', message: 'Team not found' } });
      return;
    }
    res.status(204).send();
  } catch (err) {
    if ((err as { code?: string }).code === 'TEAM_HAS_CHILDREN') {
      res
        .status(409)
        .json({ error: { code: 'TEAM_HAS_CHILDREN', message: (err as Error).message } });
      return;
    }
    throw err;
  }
}

// ── Members ────────────────────────────────────────────────────────────────────

export async function listTeamMembersHandler(req: Request, res: Response): Promise<void> {
  const team = await getTeamById(String(req.params['id']));
  if (!team) {
    res.status(404).json({ error: { code: 'TEAM_NOT_FOUND', message: 'Team not found' } });
    return;
  }
  const members = await listTeamMembers(String(req.params['id']));
  res.json({ members });
}

export async function addTeamMemberHandler(req: Request, res: Response): Promise<void> {
  const parsed = addTeamMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const team = await getTeamById(String(req.params['id']));
  if (!team) {
    res.status(404).json({ error: { code: 'TEAM_NOT_FOUND', message: 'Team not found' } });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    const member = await addTeamMember(
      String(req.params['id']),
      parsed.data.user_id,
      parsed.data.role,
      actor,
    );
    res.status(201).json({ member });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'TEAM_MEMBER_ALREADY_EXISTS') {
      res.status(409).json({ error: { code, message: (err as Error).message } });
      return;
    }
    if (code === 'TEAM_OR_USER_NOT_FOUND') {
      res.status(404).json({ error: { code, message: (err as Error).message } });
      return;
    }
    throw err;
  }
}

export async function removeTeamMemberHandler(req: Request, res: Response): Promise<void> {
  const team = await getTeamById(String(req.params['id']));
  if (!team) {
    res.status(404).json({ error: { code: 'TEAM_NOT_FOUND', message: 'Team not found' } });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const removed = await removeTeamMember(
    String(req.params['id']),
    String(req.params['userId']),
    actor,
  );
  if (!removed) {
    res
      .status(404)
      .json({ error: { code: 'TEAM_MEMBER_NOT_FOUND', message: 'Team member not found' } });
    return;
  }
  res.status(204).send();
}
