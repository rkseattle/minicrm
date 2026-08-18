/**
 * Custom roles API module — wraps the capability RBAC endpoints.
 */

import apiClient from './axiosInstance.js';
import type { Capability } from '@shared/schemas/capabilitySchema.js';

export interface CustomRoleResponse {
  id: string;
  name: string;
  description: string | null;
  is_builtin: boolean;
  capabilities: Capability[];
  created_at: string;
  updated_at: string;
}

export interface CreateCustomRoleInput {
  name: string;
  description?: string;
  capabilities: Capability[];
}

export interface UpdateCustomRoleInput {
  name?: string;
  description?: string | null;
  capabilities?: Capability[];
}

/** React Query cache key for the custom roles list. */
export const CUSTOM_ROLES_QUERY_KEY = ['custom-roles'] as const;

/** React Query cache key factory for a single custom role. */
export const customRoleQueryKey = (id: string) => ['custom-roles', id] as const;

/** React Query cache key factory for user role assignments. */
export const userRolesQueryKey = (userId: string) => ['users', userId, 'roles'] as const;

/** GET /api/v1/custom-roles */
export async function listCustomRoles(): Promise<CustomRoleResponse[]> {
  const response = await apiClient.get<{ data: CustomRoleResponse[] }>('/custom-roles');
  return response.data.data;
}

/** GET /api/v1/custom-roles/:id */
export async function getCustomRole(id: string): Promise<CustomRoleResponse> {
  const response = await apiClient.get<{ data: CustomRoleResponse }>(`/custom-roles/${id}`);
  return response.data.data;
}

/** POST /api/v1/custom-roles */
export async function createCustomRole(input: CreateCustomRoleInput): Promise<CustomRoleResponse> {
  const response = await apiClient.post<{ data: CustomRoleResponse }>('/custom-roles', input);
  return response.data.data;
}

/** PUT /api/v1/custom-roles/:id */
export async function updateCustomRole(
  id: string,
  input: UpdateCustomRoleInput,
): Promise<CustomRoleResponse> {
  const response = await apiClient.put<{ data: CustomRoleResponse }>(`/custom-roles/${id}`, input);
  return response.data.data;
}

/** DELETE /api/v1/custom-roles/:id */
export async function deleteCustomRole(id: string): Promise<void> {
  await apiClient.delete(`/custom-roles/${id}`);
}

/** GET /api/v1/users/:id/roles */
export async function listUserRoles(userId: string): Promise<CustomRoleResponse[]> {
  const response = await apiClient.get<{ data: CustomRoleResponse[] }>(`/users/${userId}/roles`);
  return response.data.data;
}

/** POST /api/v1/users/:id/roles */
export async function assignUserRole(userId: string, roleId: string): Promise<void> {
  await apiClient.post(`/users/${userId}/roles`, { roleId });
}

/** DELETE /api/v1/users/:id/roles/:roleId */
export async function removeUserRole(userId: string, roleId: string): Promise<void> {
  await apiClient.delete(`/users/${userId}/roles/${roleId}`);
}
