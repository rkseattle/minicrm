/**
 * Auth API module.
 * Wraps the auth endpoints with typed axios calls.
 */

import apiClient from './axiosInstance.js';
import type { UserResponse } from '@shared/schemas/userSchema.js';

interface AuthResponse {
  user: UserResponse;
  mustChangePassword?: boolean;
}

interface LogoutResponse {
  message: string;
}

/**
 * Sends login credentials and sets the httpOnly session cookie on success.
 */
export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/login', { email, password });
  return response.data;
}

/**
 * Clears the session cookie server-side.
 */
export async function logout(): Promise<LogoutResponse> {
  const response = await apiClient.post<LogoutResponse>('/auth/logout');
  return response.data;
}

/**
 * Returns the currently authenticated user.
 * Throws a 401 axios error if not authenticated.
 */
export async function getMe(): Promise<AuthResponse> {
  const response = await apiClient.get<AuthResponse>('/auth/me');
  return response.data;
}

/**
 * Requests a password reset email for the given address.
 * Always resolves — server returns 200 regardless of whether the email matched.
 *
 * @param email - The email address to send the reset link to.
 */
export async function forgotPassword(email: string): Promise<{ message: string }> {
  const response = await apiClient.post<{ message: string }>('/auth/forgot-password', { email });
  return response.data;
}

/**
 * Resets the user's password using a reset token from the email link.
 * On success the server sets a new session cookie and returns the user.
 *
 * @param token - The plaintext reset token from the URL query param.
 * @param password - The user's desired new password.
 */
export async function resetPassword(token: string, password: string): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/reset-password', {
    token,
    password,
  });
  return response.data;
}
