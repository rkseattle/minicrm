/**
 * Users API module.
 * Wraps the user management endpoints. All write endpoints are admin-only;
 * that restriction is enforced server-side.
 */

import apiClient from './axiosInstance.js';
import type { UserResponse, UserRole, IssueApiTokenResponse } from '@shared/schemas/userSchema.js';
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
 * Sets the active/inactive status of a user via a single endpoint. Admin only.
 * Replaces the separate deactivate/reactivate endpoints for the inline status cell.
 *
 * @param id - User UUID
 * @param active - true to activate, false to deactivate
 */
export async function updateUserStatus(id: string, active: boolean): Promise<UserSingleResponse> {
  const response = await apiClient.patch<UserSingleResponse>(`/users/${id}/status`, { active });
  return response.data;
}

/**
 * Sets the password for an invited user using their invite token.
 * This is an unauthenticated endpoint.
 *
 * @param token - The JWT from the invite link
 * @param password - The new password (min 12 characters, one letter, one number, one special character)
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

/**
 * Resets a user's onboarding checklist so they see it again on next login.
 * Admin only.
 *
 * @param id - Target user UUID
 */
export async function resetUserOnboarding(id: string): Promise<{ success: boolean }> {
  const response = await apiClient.post<{ success: boolean }>(`/users/${id}/reset-onboarding`);
  return response.data;
}

// ── Notification preferences ────────────────────────────────────

/** Shape of the notification preference flags */
export interface NotificationPrefs {
  notify_overdue_tasks: boolean;
  notify_assignments: boolean;
  notify_deal_stage_changes: boolean;
}

/** Shape returned by the notification preferences endpoints */
export interface NotificationPrefsResponse {
  preferences: NotificationPrefs;
}

/** Shape returned by the notification recipient count endpoint */
export interface NotificationRecipientCountResponse {
  count: number;
}

/** React Query cache key for the current user's notification preferences */
export const MY_NOTIFICATION_PREFS_QUERY_KEY = ['users', 'me', 'notification-preferences'] as const;

/** React Query cache key for the admin notification recipient count */
export const NOTIFICATION_RECIPIENT_COUNT_QUERY_KEY = [
  'users',
  'notification-recipient-count',
] as const;

/**
 * Returns the authenticated user's email notification preference flags.
 */
export async function getMyNotificationPrefs(): Promise<NotificationPrefsResponse> {
  const response = await apiClient.get<NotificationPrefsResponse>(
    '/users/me/notification-preferences',
  );
  return response.data;
}

/**
 * Persists the authenticated user's email notification preference flags.
 *
 * @param prefs - The new notification preference values.
 */
export async function updateMyNotificationPrefs(
  prefs: NotificationPrefs,
): Promise<NotificationPrefsResponse> {
  const response = await apiClient.patch<NotificationPrefsResponse>(
    '/users/me/notification-preferences',
    prefs,
  );
  return response.data;
}

/**
 * Returns the count of active users with at least one notification enabled. Admin only.
 */
export async function getNotificationRecipientCount(): Promise<NotificationRecipientCountResponse> {
  const response = await apiClient.get<NotificationRecipientCountResponse>(
    '/users/notification-recipient-count',
  );
  return response.data;
}

/**
 * Issues a new API token for a service account user.
 * Returns the plaintext token (shown to the admin exactly once) and the issuance timestamp.
 * Any previously issued token for this user is atomically replaced.
 *
 * @param userId - UUID of the service_account user.
 */
export async function issueApiToken(userId: string): Promise<IssueApiTokenResponse> {
  const response = await apiClient.post<IssueApiTokenResponse>(`/users/${userId}/api-token`);
  return response.data;
}

/** Response shape from revoking an API token */
interface RevokeApiTokenResponse {
  success: boolean;
}

/**
 * Revokes the current API token for a service account user.
 *
 * @param userId - UUID of the service_account user.
 */
export async function revokeApiToken(userId: string): Promise<RevokeApiTokenResponse> {
  const response = await apiClient.delete<RevokeApiTokenResponse>(`/users/${userId}/api-token`);
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
