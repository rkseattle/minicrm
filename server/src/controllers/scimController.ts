/**
 * SCIM 2.0 controller — request/response shaping for /scim/v2 routes. (MINCRM-541)
 *
 * SCIM responses use Content-Type: application/scim+json and a different
 * error format from the rest of the application (RFC 7644 §3.12).
 * All handlers do their own try/catch — do NOT wrap in asyncHandler.
 */

import type { Request, Response } from 'express';
import logger from '../logger.js';
import {
  provisionScimUser,
  getScimUser,
  listScimUsers,
  replaceScimUser,
  patchScimUser,
  toScimUser,
} from '../services/scimUserService.js';
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

    const row = await provisionScimUser({ userName, givenName, familyName, active }, SCIM_ACTOR);
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
