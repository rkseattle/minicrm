/**
 * SCIM 2.0 routes — mounted at /scim/v2 in app.ts. (MINCRM-541)
 *
 * All resource routes use authenticateScim (Bearer token) — NOT the JWT cookie
 * auth middleware. Discovery endpoints (ServiceProviderConfig, ResourceTypes,
 * Schemas) are public — IdPs fetch them during configuration.
 *
 * Handlers do their own try/catch; do NOT wrap in asyncHandler.
 */

import { Router } from 'express';
import { authenticateScim } from '../middleware/scimAuth.js';
import {
  listScimUsersHandler,
  createScimUserHandler,
  getScimUserHandler,
  replaceScimUserHandler,
  patchScimUserHandler,
  listScimGroupsHandler,
  createScimGroupHandler,
  getScimGroupHandler,
  replaceScimGroupHandler,
  deleteScimGroupHandler,
} from '../controllers/scimController.js';

const router = Router();

const SCIM_CONTENT_TYPE = 'application/scim+json';

// ── SCIM discovery endpoints (public) ─────────────────────────────────────────

/**
 * @openapi
 * /scim/v2/ServiceProviderConfig:
 *   get:
 *     tags: [SCIM]
 *     operationId: getScimServiceProviderConfig
 *     summary: SCIM ServiceProviderConfig
 *     description: >
 *       Returns the SCIM 2.0 service provider capabilities per RFC 7644 §4.
 *       Public — IdPs fetch this during initial setup.
 *     security: []
 *     responses:
 *       200:
 *         description: Service provider configuration
 *         content:
 *           application/scim+json:
 *             schema:
 *               type: object
 */
router.get('/ServiceProviderConfig', (_req, res) => {
  res.type(SCIM_CONTENT_TYPE).json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: '',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication scheme using the OAuth Bearer Token standard',
      },
    ],
  });
});

// ── Users resource ─────────────────────────────────────────────────────────────

/**
 * @openapi
 * /scim/v2/Users:
 *   get:
 *     tags: [SCIM]
 *     operationId: listScimUsers
 *     summary: List or filter SCIM users
 *     description: >
 *       Returns a SCIM ListResponse of users. Supports `?filter=userName eq "..."`.
 *     security:
 *       - scimBearerToken: []
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *         description: SCIM filter expression (only `userName eq "..."` supported)
 *     responses:
 *       200:
 *         description: SCIM ListResponse
 *       401:
 *         description: Missing or invalid SCIM bearer token
 */
router.get('/Users', authenticateScim, listScimUsersHandler);

/**
 * @openapi
 * /scim/v2/Users:
 *   post:
 *     tags: [SCIM]
 *     operationId: createScimUser
 *     summary: Provision a new user via SCIM
 *     security:
 *       - scimBearerToken: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/scim+json:
 *           schema:
 *             type: object
 *             required: [userName]
 *             properties:
 *               userName:
 *                 type: string
 *               name:
 *                 type: object
 *                 properties:
 *                   givenName:
 *                     type: string
 *                   familyName:
 *                     type: string
 *               active:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: User created
 *       400:
 *         description: Missing required attribute
 *       409:
 *         description: User already exists
 */
router.post('/Users', authenticateScim, createScimUserHandler);

/**
 * @openapi
 * /scim/v2/Users/{id}:
 *   get:
 *     tags: [SCIM]
 *     operationId: getScimUser
 *     summary: Get a SCIM user by ID
 *     security:
 *       - scimBearerToken: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SCIM User
 *       404:
 *         description: User not found
 */
router.get('/Users/:id', authenticateScim, getScimUserHandler);

/**
 * @openapi
 * /scim/v2/Users/{id}:
 *   put:
 *     tags: [SCIM]
 *     operationId: replaceScimUser
 *     summary: Replace a SCIM user's attributes
 *     security:
 *       - scimBearerToken: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Updated SCIM User
 *       404:
 *         description: User not found
 */
router.put('/Users/:id', authenticateScim, replaceScimUserHandler);

/**
 * @openapi
 * /scim/v2/Users/{id}:
 *   patch:
 *     tags: [SCIM]
 *     operationId: patchScimUser
 *     summary: Partially update a SCIM user
 *     description: >
 *       Applies RFC 7644 PATCH operations. Body must include an `Operations` array.
 *       Supports paths: `active`, `userName`, `displayName`, `name.givenName`,
 *       `name.familyName`.
 *     security:
 *       - scimBearerToken: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Updated SCIM User
 *       400:
 *         description: Missing Operations array
 *       404:
 *         description: User not found
 */
router.patch('/Users/:id', authenticateScim, patchScimUserHandler);

// ── Groups resource ────────────────────────────────────────────────────────────

/**
 * @openapi
 * /scim/v2/Groups:
 *   get:
 *     tags: [SCIM]
 *     operationId: listScimGroups
 *     summary: List SCIM groups
 *     description: >
 *       Returns a SCIM ListResponse of all provisioned groups (CRM teams that
 *       were created via SCIM).
 *     security:
 *       - scimBearerToken: []
 *     responses:
 *       200:
 *         description: SCIM ListResponse of groups
 *       401:
 *         description: Missing or invalid SCIM bearer token
 */
router.get('/Groups', authenticateScim, listScimGroupsHandler);

/**
 * @openapi
 * /scim/v2/Groups:
 *   post:
 *     tags: [SCIM]
 *     operationId: createScimGroup
 *     summary: Provision a new group via SCIM
 *     security:
 *       - scimBearerToken: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/scim+json:
 *           schema:
 *             type: object
 *             required: [displayName]
 *             properties:
 *               displayName:
 *                 type: string
 *               externalId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Group created
 *       400:
 *         description: Missing required attribute
 */
router.post('/Groups', authenticateScim, createScimGroupHandler);

/**
 * @openapi
 * /scim/v2/Groups/{id}:
 *   get:
 *     tags: [SCIM]
 *     operationId: getScimGroup
 *     summary: Get a SCIM group by ID
 *     security:
 *       - scimBearerToken: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SCIM Group
 *       404:
 *         description: Group not found
 */
router.get('/Groups/:id', authenticateScim, getScimGroupHandler);

/**
 * @openapi
 * /scim/v2/Groups/{id}:
 *   put:
 *     tags: [SCIM]
 *     operationId: replaceScimGroup
 *     summary: Replace a SCIM group's membership list
 *     description: >
 *       Full sync — replaces the group's current member list with the members
 *       array in the request body.
 *     security:
 *       - scimBearerToken: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Updated SCIM Group
 *       404:
 *         description: Group not found
 */
router.put('/Groups/:id', authenticateScim, replaceScimGroupHandler);

/**
 * @openapi
 * /scim/v2/Groups/{id}:
 *   delete:
 *     tags: [SCIM]
 *     operationId: deleteScimGroup
 *     summary: Delete a SCIM-provisioned group
 *     security:
 *       - scimBearerToken: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Group deleted
 *       404:
 *         description: Group not found
 */
router.delete('/Groups/:id', authenticateScim, deleteScimGroupHandler);

export default router;
