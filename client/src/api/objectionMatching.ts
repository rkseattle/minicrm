/**
 * Objection pattern matching API module.
 * Requires authentication and the ai_objection_pattern_matching feature flag.
 */

import apiClient from './axiosInstance.js';
import type {
  ActivityObjectionClassification,
  ObjectionCategory,
  ObjectionPrecedentsResponse,
} from '@shared/schemas/objectionSchema.js';

export function activityObjectionQueryKey(activityId: string): readonly [string, string, string] {
  return ['activities', activityId, 'objectionClassification'] as const;
}

export function objectionPrecedentsQueryKey(
  activityId: string,
  category: ObjectionCategory,
): readonly [string, string, ObjectionCategory] {
  return ['objectionPrecedents', activityId, category] as const;
}

export async function classifyActivityObjection(
  activityId: string,
): Promise<ActivityObjectionClassification | null> {
  const response = await apiClient.post<ActivityObjectionClassification | null>(
    `/activities/${activityId}/classify-objection`,
  );
  return response.data;
}

export async function getObjectionPrecedents(
  activityId: string,
  category: ObjectionCategory,
): Promise<ObjectionPrecedentsResponse> {
  const response = await apiClient.get<ObjectionPrecedentsResponse>(
    `/activities/${activityId}/objection-precedents`,
    { params: { category } },
  );
  return response.data;
}
