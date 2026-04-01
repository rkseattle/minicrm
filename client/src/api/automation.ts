/**
 * Automation API module.
 * Wraps the automation rule CRUD endpoints. All endpoints are admin-only.
 */

import apiClient from './axiosInstance.js';
import type {
  AutomationRuleResponse,
  AutomationRuleLogResponse,
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
} from '@shared/schemas/automationSchema.js';

/** React Query cache key for the automation rules list */
export const AUTOMATION_RULES_QUERY_KEY = ['automation-rules'] as const;

interface AutomationRulesResponse {
  rules: AutomationRuleResponse[];
}

interface AutomationRuleSingleResponse {
  rule: AutomationRuleResponse;
}

interface AutomationRuleLogsResponse {
  logs: AutomationRuleLogResponse[];
}

/**
 * Returns all automation rules.
 */
export async function listAutomationRules(): Promise<AutomationRulesResponse> {
  const response = await apiClient.get<AutomationRulesResponse>('/automation/rules');
  return response.data;
}

/**
 * Returns a single automation rule by UUID.
 *
 * @param id - Rule UUID
 */
export async function getAutomationRule(id: string): Promise<AutomationRuleSingleResponse> {
  const response = await apiClient.get<AutomationRuleSingleResponse>(`/automation/rules/${id}`);
  return response.data;
}

/**
 * Creates a new automation rule.
 *
 * @param data - Rule fields
 */
export async function createAutomationRule(
  data: CreateAutomationRuleInput,
): Promise<AutomationRuleSingleResponse> {
  const response = await apiClient.post<AutomationRuleSingleResponse>('/automation/rules', data);
  return response.data;
}

/**
 * Updates one or more fields of an existing automation rule.
 *
 * @param id - Rule UUID
 * @param data - Fields to update
 */
export async function updateAutomationRule(
  id: string,
  data: UpdateAutomationRuleInput,
): Promise<AutomationRuleSingleResponse> {
  const response = await apiClient.patch<AutomationRuleSingleResponse>(
    `/automation/rules/${id}`,
    data,
  );
  return response.data;
}

/**
 * Deletes an automation rule by UUID.
 *
 * @param id - Rule UUID
 */
export async function deleteAutomationRule(id: string): Promise<void> {
  await apiClient.delete(`/automation/rules/${id}`);
}

/**
 * Returns the 20 most recent execution logs for a rule.
 *
 * @param id - Rule UUID
 */
export async function listRuleLogs(id: string): Promise<AutomationRuleLogsResponse> {
  const response = await apiClient.get<AutomationRuleLogsResponse>(`/automation/rules/${id}/logs`);
  return response.data;
}
