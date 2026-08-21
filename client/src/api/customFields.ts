/**
 * Custom fields API module.
 * Wraps the /api/v1/custom-fields endpoints.
 * Definition mutations require admin auth; value reads/writes require auth.
 */

import apiClient from './axiosInstance.js';
import type {
  CustomFieldDefinitionResponse,
  CustomFieldValueResponse,
  CustomFieldValueInput,
  CreateCustomFieldDefinitionInput,
  UpdateCustomFieldDefinitionInput,
} from '@shared/schemas/customFieldSchema.js';

/** React Query cache key for the custom field definitions list (per entity type appended as 3rd element) */
export const CUSTOM_FIELD_DEFINITIONS_QUERY_KEY = ['settings', 'customFieldDefinitions'] as const;

/** React Query cache key factory for per-record custom field values */
export const customFieldValuesQueryKey = (entityType: string, recordId: string) =>
  ['customFieldValues', entityType, recordId] as const;

/** Shape returned by GET /api/v1/custom-fields/definitions */
export interface CustomFieldDefinitionsListResponse {
  definitions: CustomFieldDefinitionResponse[];
}

/** Shape returned by GET/PUT /api/v1/custom-fields/:entityType/:recordId/custom-fields */
export interface CustomFieldValuesResponse {
  values: CustomFieldValueResponse[];
}

/**
 * Returns all custom field definitions for the given entity type.
 */
export async function listCustomFieldDefinitions(
  entityType: string,
): Promise<CustomFieldDefinitionsListResponse> {
  const response = await apiClient.get<CustomFieldDefinitionsListResponse>(
    '/custom-fields/definitions',
    { params: { entity_type: entityType } },
  );
  return response.data;
}

/**
 * Creates a new custom field definition. Admin only.
 */
export async function createCustomFieldDefinition(
  params: CreateCustomFieldDefinitionInput,
): Promise<CustomFieldDefinitionResponse> {
  const response = await apiClient.post<CustomFieldDefinitionResponse>(
    '/custom-fields/definitions',
    params,
  );
  return response.data;
}

/**
 * Updates a custom field definition. Admin only.
 */
export async function updateCustomFieldDefinition(
  id: string,
  params: UpdateCustomFieldDefinitionInput,
): Promise<CustomFieldDefinitionResponse> {
  const response = await apiClient.patch<CustomFieldDefinitionResponse>(
    `/custom-fields/definitions/${id}`,
    params,
  );
  return response.data;
}

/**
 * Deletes a custom field definition and all its values. Admin only.
 */
export async function deleteCustomFieldDefinition(id: string): Promise<{ id: string }> {
  const response = await apiClient.delete<{ id: string }>(`/custom-fields/definitions/${id}`);
  return response.data;
}

/**
 * Returns all custom field values for a record.
 */
export async function getCustomFieldValues(
  entityType: string,
  recordId: string,
): Promise<CustomFieldValuesResponse> {
  const response = await apiClient.get<CustomFieldValuesResponse>(
    `/custom-fields/${entityType}/${recordId}/custom-fields`,
  );
  return response.data;
}

/**
 * Upserts custom field values for a record.
 */
export async function putCustomFieldValues(
  entityType: string,
  recordId: string,
  values: CustomFieldValueInput[],
): Promise<CustomFieldValuesResponse> {
  const response = await apiClient.put<CustomFieldValuesResponse>(
    `/custom-fields/${entityType}/${recordId}/custom-fields`,
    values,
  );
  return response.data;
}
