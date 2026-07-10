/**
 * Warm introduction path API module. (MINCRM-468)
 * Wraps the warm-path lookup endpoint. Requires authentication and the
 * ai_warm_intro_path feature flag.
 */

import apiClient from './axiosInstance.js';
import type { WarmIntroPathResponse } from '@shared/schemas/warmIntroPathSchema.js';

export function warmIntroPathsQueryKey(contactId: string): readonly [string, string, string] {
  return ['contacts', contactId, 'warmPaths'] as const;
}

export async function getWarmIntroPaths(contactId: string): Promise<WarmIntroPathResponse> {
  const response = await apiClient.get<WarmIntroPathResponse>(`/contacts/${contactId}/warm-paths`);
  return response.data;
}
