/**
 * Onboarding API module (MINCRM-256).
 * Wraps GET /api/settings/onboarding and PUT /api/settings/onboarding.
 * Admin only.
 */

import apiClient from './axiosInstance.js';

/** Shape returned by GET /api/settings/onboarding */
export interface OnboardingStatusResponse {
  is_first_run: boolean;
  onboarding_completed: boolean;
}

/** React Query cache key for onboarding status */
export const ONBOARDING_STATUS_QUERY_KEY = ['settings', 'onboarding'] as const;

/**
 * Returns first-run detection status and the onboarding_completed flag.
 * Admin only.
 */
export async function getOnboardingStatus(): Promise<OnboardingStatusResponse> {
  const response = await apiClient.get<OnboardingStatusResponse>('/settings/onboarding');
  return response.data;
}

/**
 * Sets the onboarding_completed flag. Admin only.
 *
 * @param completed - Whether onboarding has been completed or dismissed.
 */
export async function setOnboardingCompleted(
  completed: boolean,
): Promise<{ onboarding_completed: boolean }> {
  const response = await apiClient.put<{ onboarding_completed: boolean }>('/settings/onboarding', {
    onboarding_completed: completed,
  });
  return response.data;
}
