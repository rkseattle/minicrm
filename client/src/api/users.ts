/**
 * Users API module.
 * Wraps the user management endpoints. All write endpoints are admin-only;
 * that restriction is enforced server-side.
 */

import apiClient from './axiosInstance.js';
import type { UserResponse, UserRole } from '@shared/schemas/userSchema.js';

interface UsersResponse {
  users: UserResponse[];
}

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
 * Returns all users. Admin only.
 */
export async function listUsers(): Promise<UsersResponse> {
  const response = await apiClient.get<UsersResponse>('/users');
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
