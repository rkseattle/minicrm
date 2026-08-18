/**
 * Demo data API module.
 * Wraps the /api/admin/demo endpoints. All calls require admin auth.
 */

import apiClient from './axiosInstance.js';

/** React Query cache key for the demo status */
export const DEMO_STATUS_QUERY_KEY = ['admin', 'demo', 'status'] as const;

export interface DemoStatusResponse {
  active: boolean;
}

export interface DemoActionResponse {
  success: boolean;
}

/**
 * Returns whether demo data is currently present.
 */
export async function getDemoStatus(): Promise<DemoStatusResponse> {
  const response = await apiClient.get<DemoStatusResponse>('/admin/demo/status');
  return response.data;
}

/**
 * Seeds demo data. Throws on conflict (409 = already present).
 */
export async function seedDemoData(): Promise<DemoActionResponse> {
  const response = await apiClient.post<DemoActionResponse>('/admin/demo/seed');
  return response.data;
}

/**
 * Resets demo data (remove + re-seed in one operation).
 */
export async function resetDemoData(): Promise<DemoActionResponse> {
  const response = await apiClient.post<DemoActionResponse>('/admin/demo/reset');
  return response.data;
}

/**
 * Removes all demo-flagged records. Throws on conflict (409 = none present).
 */
export async function removeDemoData(): Promise<DemoActionResponse> {
  const response = await apiClient.delete<DemoActionResponse>('/admin/demo');
  return response.data;
}
