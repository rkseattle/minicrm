/**
 * Users API module.
 * Wraps the user management endpoints. All write endpoints are admin-only;
 * that restriction is enforced server-side.
 */

import apiClient from './axiosInstance.js';
import type { UserResponse, UserRole } from '@shared/schemas/userSchema.js';
import type { SupportedLocale } from '@shared/schemas/settingsSchema.js';

/** Minimal user shape returned by the /active endpoint — sufficient for owner dropdowns */
export interface ActiveUser {
  id: string;
  name: string;
}

/** React Query cache key for the active users list */
export const ACTIVE_USERS_QUERY_KEY = ['users', 'active'] as const;

/**
 * Resolves an owner UUID to a display name using the active users list.
 * Returns a fallback string when the user is not found (e.g. deactivated).
 *
 * @param ownerId - The UUID stored on the record
 * @param users - List of active users
 * @param fallback - Text to show when the owner is not in the active users list
 */
export function resolveOwnerName(ownerId: string, users: ActiveUser[], fallback: string): string {
  return users.find((u) => u.id === ownerId)?.name ?? fallback;
}

interface ActiveUsersResponse {
  users: ActiveUser[];
}

import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

interface UserSingleResponse {
  user: UserResponse;
}

interface InviteUserResponse {
  user: UserResponse;
  inviteToken: string;
  setPasswordPath: string;
}

interface InviteUserInput {
  email: string;
  name: string;
  role: UserRole;
}

interface MessageResponse {
  message: string;
}

/**
 * Returns id and name for every active user. Available to all authenticated users
 * so that owner-assignment dropdowns work for reps and admins alike.
 */
export async function listActiveUsers(): Promise<ActiveUsersResponse> {
  const response = await apiClient.get<ActiveUsersResponse>('/users/active');
  return response.data;
}

/** Parameters for paginating the users list */
export interface ListUsersParams {
  /** 1-based page number */
  page?: number;
  /** Records per page */
  limit?: number;
}

/**
 * Returns a paginated list of users. Admin only.
 *
 * @param params - Optional pagination parameters
 */
export async function listUsers(
  params: ListUsersParams = {},
): Promise<PaginatedResponse<UserResponse>> {
  const queryParams: Record<string, string> = {};
  if (params.page !== undefined) queryParams.page = String(params.page);
  if (params.limit !== undefined) queryParams.limit = String(params.limit);
  const response = await apiClient.get<PaginatedResponse<UserResponse>>('/users', {
    params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  });
  return response.data;
}

/**
 * Invites a new user. Admin only.
 */
export async function inviteUser(data: InviteUserInput): Promise<InviteUserResponse> {
  const response = await apiClient.post<InviteUserResponse>('/users/invite', data);
  return response.data;
}

/**
 * Updates a user's role. Admin only.
 *
 * @param id - User UUID
 * @param role - New role
 */
export async function updateUserRole(id: string, role: UserRole): Promise<UserSingleResponse> {
  const response = await apiClient.patch<UserSingleResponse>(`/users/${id}/role`, {
    role,
  });
  return response.data;
}

/**
 * Deactivates a user. Admin only.
 *
 * @param id - User UUID
 */
export async function deactivateUser(id: string): Promise<UserSingleResponse> {
  const response = await apiClient.patch<UserSingleResponse>(`/users/${id}/deactivate`);
  return response.data;
}

/**
 * Reactivates a previously deactivated user. Admin only.
 *
 * @param id - User UUID
 */
export async function reactivateUser(id: string): Promise<UserSingleResponse> {
  const response = await apiClient.patch<UserSingleResponse>(`/users/${id}/reactivate`);
  return response.data;
}

/**
 * Sets the password for an invited user using their invite token.
 * This is an unauthenticated endpoint.
 *
 * @param token - The JWT from the invite link
 * @param password - The new password (min 8 characters)
 */
export async function setPassword(token: string, password: string): Promise<MessageResponse> {
  const response = await apiClient.post<MessageResponse>('/users/set-password', {
    token,
    password,
  });
  return response.data;
}

/**
 * Admin sets a user's password directly. The user will be prompted to change
 * it on their next login. Admin only.
 *
 * @param id - Target user UUID
 * @param password - New password set on behalf of the user
 */
export async function adminSetPassword(id: string, password: string): Promise<UserSingleResponse> {
  const response = await apiClient.post<UserSingleResponse>(`/users/${id}/admin-set-password`, {
    password,
  });
  return response.data;
}

/** Shape returned by the language preference endpoints */
export interface LanguagePreferenceResponse {
  language: SupportedLocale | null;
}

/** React Query cache key for the current user's language preference */
export const MY_LANGUAGE_QUERY_KEY = ['users', 'me', 'language'] as const;

/**
 * Returns the authenticated user's stored language preference, or null if not set.
 */
export async function getMyLanguage(): Promise<LanguagePreferenceResponse> {
  const response = await apiClient.get<LanguagePreferenceResponse>('/users/me/language');
  return response.data;
}

/**
 * Persists the authenticated user's language preference.
 * Pass null to clear the preference and fall back to the system default.
 *
 * @param language - The locale code to store, or null to clear.
 */
export async function setMyLanguage(
  language: SupportedLocale | null,
): Promise<LanguagePreferenceResponse> {
  const response = await apiClient.patch<LanguagePreferenceResponse>('/users/me/language', {
    language,
  });
  return response.data;
}
