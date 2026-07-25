/**
 * Auth API — this dashboard reuses minicrm-server's existing session-cookie
 * auth (POST /auth/login sets the same httpOnly minicrm_token cookie the
 * CRM client itself relies on) rather than inventing a separate auth
 * mechanism. The reporting query API this dashboard consumes is
 * `authenticate -> requireRole('admin') -> requireFeatureEnabled(...)`
 * gated exactly like every other admin-only CRM endpoint.
 */

import apiClient from './axiosInstance.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}

export interface LoginResponse {
  user: AuthUser;
  mustChangePassword: boolean;
}

export const AUTH_ME_QUERY_KEY = ['auth', 'me'] as const;

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}

/** Returns null (not throwing) on 401 — the natural "not logged in" state, not an error. */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const { data } = await apiClient.get<{ user: AuthUser }>('/auth/me');
    return data.user;
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'response' in err &&
      (err as { response?: { status?: number } }).response?.status === 401
    ) {
      return null;
    }
    throw err;
  }
}
