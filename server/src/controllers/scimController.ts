/**
 * SCIM 2.0 controller — request/response shaping for /scim/v2 routes.
 *
 * SCIM responses use Content-Type: application/scim+json and a different
 * error format from the rest of the application (RFC 7644 §3.12).
 * All handlers do their own try/catch — do NOT wrap in asyncHandler.
 */

import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import logger from '../logger.js';
import {
  provisionScimUser,
  getScimUser,
  listScimUsers,
  replaceScimUser,
  patchScimUser,
  toScimUser,
} from '../services/scimUserService.js';
import {
  listScimGroups,
  provisionScimGroup,
  getScimGroupById,
  syncScimGroupMembers,
  deleteScimGroup,
  toScimGroup,
  listScimGroupRoleMappings,
  setScimGroupRoleMapping,
  deleteScimGroupRoleMapping,
} from '../services/scimGroupService.js';
import type { AuditActor } from '../services/auditService.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SCIM_CONTENT_TYPE = 'application/scim+json';

/**
 * Base URL for constructing SCIM resource `location` URIs.
 * Must point to the API server, not the frontend.
 */
const SCIM_BASE_URL =
  process.env.SSO_CALLBACK_BASE_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3001';

/**
 * System actor for SCIM-initiated writes. SCIM provisioning is machine-to-machine;
 * there is no interactive human actor.
 */
const SCIM_ACTOR: AuditActor = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'SCIM Provisioner',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Serializes a SCIM error per RFC 7644 §3.12 */
function scimError(res: Response, status: number, detail: string): void {
  res
    .status(status)
    .type(SCIM_CONTENT_TYPE)
    .json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: String(status),
      detail,
    });
}

/** Returns the HTTP status code from a thrown service error, defaulting to 500. */
function statusCodeOf(err: unknown): number {
  if (
    err instanceof Error &&
    'statusCode' in err &&
    typeof (err as { statusCode: unknown }).statusCode === 'number'
  ) {
    return (err as { statusCode: number }).statusCode;
  }
  return 500;
}

// ── Users handlers ────────────────────────────────────────────────────────────

/**
 * GET /scim/v2/Users
 * Lists users, optionally filtered by `?filter=userName eq "email"`.
 */
export async function listScimUsersHandler(req: Request, res: Response): Promise<void> {
  try {
    const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined;
    const rows = await listScimUsers(filter);
    const resources = rows.map((r) => toScimUser(r, SCIM_BASE_URL));

    res.type(SCIM_CONTENT_TYPE).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    });
  } catch (err) {
    logger.error({ err }, 'SCIM: listScimUsersHandler failed');
    scimError(res, 500, 'An unexpected error occurred');
  }
}

/**
 * POST /scim/v2/Users
 * Provisions a new CRM user from a SCIM CREATE request.
 */
export async function createScimUserHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const userName = typeof body.userName === 'string' ? body.userName : null;
    const nameObj = body.name as Record<string, string> | undefined;
    const givenName = nameObj?.givenName ?? '';
    const familyName = nameObj?.familyName ?? '';

    if (!userName) {
      scimError(res, 400, 'userName is required');
      return;
    }

    const active = typeof body.active === 'boolean' ? body.active : true;
    const externalId = typeof body.externalId === 'string' ? body.externalId : null;

    const row = await provisionScimUser(
      { userName, givenName, familyName, active, externalId },
      SCIM_ACTOR,
    );
    const scimUser = toScimUser(row, SCIM_BASE_URL);

    res.status(201).set('Location', scimUser.meta.location).type(SCIM_CONTENT_TYPE).json(scimUser);
  } catch (err) {
    const status = statusCodeOf(err);
    const detail = err instanceof Error ? err.message : 'An unexpected error occurred';
    logger.warn({ err }, 'SCIM: createScimUserHandler error');
    scimError(res, status, detail);
  }
}

/**
 * GET /scim/v2/Users/:id
 * Returns a single SCIM User by internal ID.
 */
export async function getScimUserHandler(req: Request, res: Response): Promise<void> {
  try {
    const userId = String(req.params['id']);
    const row = await getScimUser(userId);
    if (!row) {
      scimError(res, 404, 'User not found');
      return;
    }
    res.type(SCIM_CONTENT_TYPE).json(toScimUser(row, SCIM_BASE_URL));
  } catch (err) {
    logger.error({ err }, 'SCIM: getScimUserHandler failed');
    scimError(res, 500, 'An unexpected error occurred');
  }
}

/**
 * PUT /scim/v2/Users/:id
 * Replaces all mutable user attributes wholesale.
 */
export async function replaceScimUserHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const userName = typeof body.userName === 'string' ? body.userName : null;
    const nameObj = body.name as Record<string, string> | undefined;
    const givenName = nameObj?.givenName ?? '';
    const familyName = nameObj?.familyName ?? '';

    if (!userName) {
      scimError(res, 400, 'userName is required');
      return;
    }

    const active = typeof body.active === 'boolean' ? body.active : true;
    const userId = String(req.params['id']);
    const row = await replaceScimUser(
      userId,
      { userName, givenName, familyName, active },
      SCIM_ACTOR,
    );
    res.type(SCIM_CONTENT_TYPE).json(toScimUser(row, SCIM_BASE_URL));
  } catch (err) {
    const status = statusCodeOf(err);
    const detail = err instanceof Error ? err.message : 'An unexpected error occurred';
    logger.warn({ err }, 'SCIM: replaceScimUserHandler error');
    scimError(res, status, detail);
  }
}

/**
 * PATCH /scim/v2/Users/:id
 * Applies partial updates via RFC 7644 PATCH operations.
 * Body must be: `{ schemas: [...], Operations: [...] }`
 */
export async function patchScimUserHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const operations = body.Operations;

    if (!Array.isArray(operations)) {
      scimError(res, 400, 'Operations array is required');
      return;
    }

    const userId = String(req.params['id']);
    const row = await patchScimUser(userId, operations, SCIM_ACTOR);
    res.type(SCIM_CONTENT_TYPE).json(toScimUser(row, SCIM_BASE_URL));
  } catch (err) {
    const status = statusCodeOf(err);
    const detail = err instanceof Error ? err.message : 'An unexpected error occurred';
    logger.warn({ err }, 'SCIM: patchScimUserHandler error');
    scimError(res, status, detail);
  }
}

// ── Groups handlers ───────────────────────────────────────────────────────────

/**
 * GET /scim/v2/Groups
 * Returns a SCIM ListResponse of all provisioned groups (CRM teams with a scim_group_id).
 */
export async function listScimGroupsHandler(req: Request, res: Response): Promise<void> {
  try {
    const entries = await listScimGroups();
    const resources = entries.map(({ group, members }) =>
      toScimGroup(group, members, SCIM_BASE_URL),
    );

    res.type(SCIM_CONTENT_TYPE).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    });
  } catch (err) {
    logger.error({ err }, 'SCIM: listScimGroupsHandler failed');
    scimError(res, 500, 'An unexpected error occurred');
  }
}

/**
 * POST /scim/v2/Groups
 * Provisions a new CRM team from a SCIM Group CREATE request.
 * If the body contains an `externalId` (or `id`), that is used as the external
 * group ID; otherwise a UUID is generated.
 */
export async function createScimGroupHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const displayName = typeof body.displayName === 'string' ? body.displayName : null;

    if (!displayName) {
      scimError(res, 400, 'displayName is required');
      return;
    }

    // Prefer externalId; fall back to id field; generate one if neither is present
    const externalGroupId =
      (typeof body.externalId === 'string' ? body.externalId : null) ??
      (typeof body.id === 'string' ? body.id : null) ??
      randomUUID();

    const group = await provisionScimGroup(externalGroupId, displayName, SCIM_ACTOR);
    const scimGroup = toScimGroup(group, [], SCIM_BASE_URL);

    res
      .status(201)
      .set('Location', scimGroup.meta.location)
      .type(SCIM_CONTENT_TYPE)
      .json(scimGroup);
  } catch (err) {
    const status = statusCodeOf(err);
    const detail = err instanceof Error ? err.message : 'An unexpected error occurred';
    logger.warn({ err }, 'SCIM: createScimGroupHandler error');
    scimError(res, status, detail);
  }
}

/**
 * GET /scim/v2/Groups/:id
 * Returns a single SCIM Group by CRM team UUID.
 */
export async function getScimGroupHandler(req: Request, res: Response): Promise<void> {
  try {
    const teamId = String(req.params['id']);
    const entry = await getScimGroupById(teamId);

    if (!entry) {
      scimError(res, 404, 'Group not found');
      return;
    }

    res.type(SCIM_CONTENT_TYPE).json(toScimGroup(entry.group, entry.members, SCIM_BASE_URL));
  } catch (err) {
    logger.error({ err }, 'SCIM: getScimGroupHandler failed');
    scimError(res, 500, 'An unexpected error occurred');
  }
}

/**
 * PUT /scim/v2/Groups/:id
 * Replaces a group's membership list wholesale (full sync).
 * The `members` array in the body drives the target state.
 */
export async function replaceScimGroupHandler(req: Request, res: Response): Promise<void> {
  try {
    const teamId = String(req.params['id']);
    const body = req.body as Record<string, unknown>;

    // Extract member user IDs from the members array; ignore entries with no value
    const rawMembers = Array.isArray(body.members) ? body.members : [];
    const memberUserIds: string[] = rawMembers
      .filter(
        (m): m is Record<string, unknown> =>
          m !== null &&
          typeof m === 'object' &&
          typeof (m as Record<string, unknown>).value === 'string',
      )
      .map((m) => m.value as string);

    // Check scope guard before mutating — syncScimGroupMembers also guards, but
    // checking here first avoids starting a transaction against a non-SCIM team.
    const entry = await getScimGroupById(teamId);
    if (!entry) {
      scimError(res, 404, 'Group not found');
      return;
    }

    await syncScimGroupMembers(teamId, memberUserIds, SCIM_ACTOR);

    // Re-fetch to reflect the post-sync membership state
    const updated = await getScimGroupById(teamId);
    if (!updated) {
      scimError(res, 404, 'Group not found');
      return;
    }

    res.type(SCIM_CONTENT_TYPE).json(toScimGroup(updated.group, updated.members, SCIM_BASE_URL));
  } catch (err) {
    const status = statusCodeOf(err);
    const detail = err instanceof Error ? err.message : 'An unexpected error occurred';
    logger.warn({ err }, 'SCIM: replaceScimGroupHandler error');
    scimError(res, status, detail);
  }
}

/**
 * DELETE /scim/v2/Groups/:id
 * Deletes a SCIM-provisioned group (CRM team) and all its memberships.
 */
export async function deleteScimGroupHandler(req: Request, res: Response): Promise<void> {
  try {
    const teamId = String(req.params['id']);
    const deleted = await deleteScimGroup(teamId, SCIM_ACTOR);

    if (!deleted) {
      scimError(res, 404, 'Group not found');
      return;
    }

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'SCIM: deleteScimGroupHandler failed');
    scimError(res, 500, 'An unexpected error occurred');
  }
}

// ── SCIM group-role mapping admin handlers ────────────────────────────────────
// These use the standard app JSON error format (not SCIM error format) and are
// called from the /api/v1/scim/group-role-mappings router (not /scim/v2).

/**
 * GET /api/v1/scim/group-role-mappings
 * Lists all SCIM group → custom role mappings.
 */
export async function listScimGroupRoleMappingsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const mappings = await listScimGroupRoleMappings();
  res.json({ mappings });
}

/**
 * PUT /api/v1/scim/group-role-mappings/:scimGroupId
 * Creates or replaces the role mapping for a SCIM group.
 * Body must include `{ roleId: string }`.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function putScimGroupRoleMappingHandler(req: Request, res: Response): Promise<void> {
  const scimGroupId = String(req.params['scimGroupId']);
  const body = req.body as Record<string, unknown>;
  const roleId = typeof body.roleId === 'string' ? body.roleId : null;

  if (!roleId) {
    res.status(400).json({ error: { code: 'MISSING_ROLE_ID', message: 'roleId is required' } });
    return;
  }

  if (!UUID_RE.test(roleId)) {
    res.status(400).json({ error: { code: 'INVALID_ROLE_ID', message: 'roleId must be a UUID' } });
    return;
  }

  // Use the scimGroupId as the group_name placeholder when no name is supplied
  const groupName = typeof body.groupName === 'string' ? body.groupName : scimGroupId;

  // Safe: req.user is guaranteed by the authenticate middleware on this router.
  const actor = { id: req.user!.id, name: req.user!.name };

  try {
    await setScimGroupRoleMapping(scimGroupId, groupName, roleId, actor);
    res.status(204).send();
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23503') {
      res.status(400).json({ error: { code: 'INVALID_ROLE_ID', message: 'Role not found' } });
      return;
    }
    throw err;
  }
}

/**
 * DELETE /api/v1/scim/group-role-mappings/:scimGroupId
 * Removes the role mapping for a SCIM group.
 */
export async function deleteScimGroupRoleMappingHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const scimGroupId = String(req.params['scimGroupId']);
  const deleted = await deleteScimGroupRoleMapping(scimGroupId);

  if (!deleted) {
    res
      .status(404)
      .json({ error: { code: 'MAPPING_NOT_FOUND', message: 'No mapping for that group ID' } });
    return;
  }

  res.status(204).send();
}
