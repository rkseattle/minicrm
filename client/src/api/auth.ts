/**
 * Auth API module.
 * Wraps the auth endpoints with typed axios calls.
 */

import apiClient from './axiosInstance.js';
import type { UserResponse } from '@shared/schemas/userSchema.js';

interface AuthResponse {
  user: UserResponse;
  mustChangePassword?: boolean;
  preferredLanguage?: string | null;
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
