/**
 * SCIM provisioning API module — wraps token management and group-role mapping
 * endpoints introduced in MINCRM-541.
 */

import apiClient from './axiosInstance.js';

// ── Token management ───────────────────────────────────────────────────────────

export interface ScimTokenMeta {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ScimTokenWithRaw extends ScimTokenMeta {
  rawToken: string;
}

export const SCIM_TOKEN_QUERY_KEY = ['scim-token'] as const;

/** GET /api/v1/scim-token — returns metadata for the active token, or null. */
export async function getScimTokenMeta(): Promise<ScimTokenMeta | null> {
  const response = await apiClient.get<{ token: ScimTokenMeta | null }>('/scim-token');
  return response.data.token;
}

/** POST /api/v1/scim-token — generates a new token; returns plaintext exactly once. */
export async function generateScimToken(): Promise<ScimTokenWithRaw> {
  const response = await apiClient.post<{ token: ScimTokenWithRaw }>('/scim-token');
  return response.data.token;
}

/** DELETE /api/v1/scim-token — revokes the active token. */
export async function revokeScimToken(): Promise<void> {
  await apiClient.delete('/scim-token');
}

// ── Group-role mappings ────────────────────────────────────────────────────────

export interface ScimGroupRoleMapping {
  id: string;
  scim_group_id: string;
  group_name: string;
  role_id: string;
  created_at: string;
}

export const SCIM_GROUP_MAPPINGS_QUERY_KEY = ['scim-group-mappings'] as const;

/** GET /api/v1/scim/group-role-mappings */
export async function listScimGroupRoleMappings(): Promise<ScimGroupRoleMapping[]> {
  const response = await apiClient.get<{ mappings: ScimGroupRoleMapping[] }>(
    '/scim/group-role-mappings',
  );
  return response.data.mappings;
}

/** PUT /api/v1/scim/group-role-mappings/:scimGroupId */
export async function setScimGroupRoleMapping(
  scimGroupId: string,
  roleId: string,
  groupName?: string,
): Promise<void> {
  await apiClient.put(`/scim/group-role-mappings/${encodeURIComponent(scimGroupId)}`, {
    roleId,
    groupName,
  });
}

/** DELETE /api/v1/scim/group-role-mappings/:scimGroupId */
export async function deleteScimGroupRoleMapping(scimGroupId: string): Promise<void> {
  await apiClient.delete(`/scim/group-role-mappings/${encodeURIComponent(scimGroupId)}`);
}
