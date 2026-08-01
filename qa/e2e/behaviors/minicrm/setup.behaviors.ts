/**
 * Setup behaviors for MiniCRM — cross-cutting API helpers for system configuration,
 * webhooks, automation rules, custom fields, and language/currency settings.
 *
 * These functions encapsulate admin-level write operations that configure the system
 * before or during a test. They return typed result objects that test specs assert against.
 *
 * Behaviors do NOT contain assertions (no expect() calls).
 *
 * MINCRM-357
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import { gotoAndSettle } from '@apps/minicrm/helpers.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { SetupChecklistPage } from '@pages/minicrm/SetupChecklistPage.js';
import { AutomationPage } from '@pages/minicrm/AutomationPage.js';

// ---------------------------------------------------------------------------
// Webhooks (MINCRM-279)
// ---------------------------------------------------------------------------

/** Shape of a webhook subscription. */
export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'failed' | 'disabled';
  created_by: string;
  created_at: string;
}

/** Shape of the webhook create response. */
export interface WebhookCreateResult {
  subscription: WebhookSubscription;
  plaintextSecret: string;
}

/** Shape of a single delivery log entry. */
export interface WebhookDeliveryLog {
  id: string;
  subscription_id: string | null;
  event_type: string;
  attempt: number;
  status_code: number | null;
  error: string | null;
  delivered_at: string;
}

/**
 * Creates a webhook subscription via the API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param params - Subscription parameters.
 * @returns The created subscription and its plaintext secret.
 */
export async function createWebhookSubscription(
  restClient: RestClient,
  params: { url: string; events: string[] },
): Promise<WebhookCreateResult> {
  const res = await restClient.post<WebhookCreateResult>('/api/v1/admin/webhooks', params);
  return res.body;
}

/**
 * Lists all webhook subscriptions from the API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @returns Array of webhook subscriptions.
 */
export async function listWebhookSubscriptions(
  restClient: RestClient,
): Promise<WebhookSubscription[]> {
  const res = await restClient.get<{ subscriptions: WebhookSubscription[] }>(
    '/api/v1/admin/webhooks',
  );
  return res.body.subscriptions;
}

/**
 * Fetches delivery logs for a webhook subscription.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param subscriptionId - Subscription UUID.
 * @param limit - Maximum number of entries to return.
 * @returns Object with data array and total count.
 */
export async function getWebhookDeliveryLogs(
  restClient: RestClient,
  subscriptionId: string,
  limit = 10,
): Promise<{ data: WebhookDeliveryLog[]; total: number }> {
  const res = await restClient.get<{ data: WebhookDeliveryLog[]; total: number }>(
    `/api/v1/admin/webhooks/${subscriptionId}/logs?limit=${limit}`,
  );
  return { data: res.body.data, total: res.body.total };
}

/**
 * Polls webhook delivery logs until a log entry matching the given event type
 * appears, using exponential backoff.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param subscriptionId - Subscription UUID.
 * @param eventType - Event type to look for (e.g. 'contact.created').
 * @param options - Polling options.
 * @returns The matching delivery log entry.
 * @throws When the deadline is exceeded without finding a match.
 */
export async function pollForWebhookDelivery(
  restClient: RestClient,
  subscriptionId: string,
  eventType: string,
  options: { maxMs?: number; initialBackoffMs?: number } = {},
): Promise<WebhookDeliveryLog> {
  const maxMs = options.maxMs ?? 8_000;
  const deadline = Date.now() + maxMs;
  let backoff = options.initialBackoffMs ?? 200;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, 2_000);

    const { data } = await getWebhookDeliveryLogs(restClient, subscriptionId);
    const match = data.find((log) => log.event_type === eventType);
    if (match) return match;
  }

  throw new Error(
    `[pollForWebhookDelivery] No "${eventType}" log found for subscription ${subscriptionId} after ${maxMs}ms`,
  );
}

// ---------------------------------------------------------------------------
// Automation rules (MINCRM-253)
// ---------------------------------------------------------------------------

/** Shape of an automation rule returned by the API. */
export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
}

/** Parameters for creating an automation rule. */
export interface CreateAutomationRuleParams {
  name: string;
  enabled: boolean;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
}

/**
 * Creates an automation rule via the API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param params - Rule parameters.
 * @returns The created automation rule.
 */
export async function createAutomationRule(
  restClient: RestClient,
  params: CreateAutomationRuleParams,
): Promise<AutomationRule> {
  const res = await restClient.post<{ rule: AutomationRule }>('/api/v1/automation/rules', params);
  return res.body.rule;
}

// ---------------------------------------------------------------------------
// Custom fields (MINCRM-267)
// ---------------------------------------------------------------------------

/** Shape of a custom field definition. */
export interface CustomFieldDefinition {
  id: string;
  name: string;
  field_type: string;
  entity_type: string;
}

/** Parameters for creating a custom field definition. */
export interface CreateCustomFieldDefinitionParams {
  entity_type: string;
  name: string;
  field_type: string;
}

/**
 * Fetches all custom field definitions for the given entity type.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param entityType - Entity type (e.g. 'contact', 'account', 'deal').
 * @returns Array of custom field definitions.
 */
export async function getCustomFieldDefinitions(
  restClient: RestClient,
  entityType: string,
): Promise<CustomFieldDefinition[]> {
  const res = await restClient.get<{ definitions: CustomFieldDefinition[] }>(
    `/api/v1/custom-fields/definitions?entity_type=${encodeURIComponent(entityType)}`,
  );
  return res.body.definitions;
}

/**
 * Creates a custom field definition via the API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param params - Definition parameters.
 * @returns The created definition.
 */
export async function createCustomFieldDefinition(
  restClient: RestClient,
  params: CreateCustomFieldDefinitionParams,
): Promise<CustomFieldDefinition> {
  const res = await restClient.post<CustomFieldDefinition>(
    '/api/v1/custom-fields/definitions',
    params,
  );
  return res.body;
}

/**
 * Sets custom field values for a contact via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @param fields - Array of { definition_id, value } objects.
 */
export async function setContactCustomFields(
  restClient: RestClient,
  contactId: string,
  fields: Array<{ definition_id: string; value: string | number | boolean | null }>,
): Promise<void> {
  await restClient.put(`/api/v1/custom-fields/contact/${contactId}/custom-fields`, fields);
}

// ---------------------------------------------------------------------------
// Currency settings (MINCRM-282)
// ---------------------------------------------------------------------------

/** Parameters for configuring currency settings. */
export interface CurrencySettings {
  home_currency: string;
  currencies: Array<{
    code: string;
    rate?: number;
  }>;
}

/**
 * Configures the system's currency settings via the API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param settings - Currency configuration.
 */
export async function setCurrencySettings(
  restClient: RestClient,
  settings: CurrencySettings,
): Promise<void> {
  await restClient.put('/api/v1/settings/currencies', settings);
}

// ---------------------------------------------------------------------------
// Language / i18n settings (MINCRM-340)
// ---------------------------------------------------------------------------

/**
 * Sets the authenticated user's preferred language via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param language - Language code (e.g. 'fr', 'en', null to clear).
 */
export async function setUserLanguage(
  restClient: RestClient,
  language: string | null,
): Promise<void> {
  await restClient.patch('/api/v1/users/me/language', { language });
}

/**
 * Sets the system default language via admin settings.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param language - Language code (e.g. 'zh-Hans').
 */
export async function setSystemDefaultLanguage(
  restClient: RestClient,
  language: string,
): Promise<void> {
  await restClient.patch('/api/v1/settings/default-language', { language });
}

/**
 * Sets the system nav layout via admin settings.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param layout - Layout identifier (e.g. 'sidebar', 'topbar').
 */
export async function setNavLayout(restClient: RestClient, layout: string): Promise<void> {
  await restClient.patch('/api/v1/settings/nav-layout', { layout });
}

// ---------------------------------------------------------------------------
// Onboarding settings (MINCRM-256)
// ---------------------------------------------------------------------------

/**
 * Sets the onboarding_completed flag via the admin API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param completed - Whether onboarding is completed.
 */
export async function setOnboardingCompleted(
  restClient: RestClient,
  completed: boolean,
): Promise<void> {
  await restClient.put('/api/v1/settings/onboarding', { onboarding_completed: completed });
}

/**
 * Resets a target user's onboarding checklist via the admin API (MINCRM-410).
 *
 * Sets onboarding_completed=false on the target user so the checklist widget
 * reappears on their next login.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param userId - UUID of the user whose onboarding should be reset.
 */
export async function resetUserOnboardingViaApi(
  restClient: RestClient,
  userId: string,
): Promise<void> {
  await restClient.post(`/api/v1/users/${userId}/reset-onboarding`);
}

/**
 * Fetches the onboarding status from the admin API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @returns Object with is_first_run and onboarding_completed fields.
 */
export async function getOnboardingStatus(
  restClient: RestClient,
): Promise<{ is_first_run: boolean; onboarding_completed: boolean }> {
  const res = await restClient.get<{ is_first_run: boolean; onboarding_completed: boolean }>(
    '/api/v1/settings/onboarding',
  );
  return res.body;
}

/**
 * Clears the pipeline_stages_reviewed flag so the onboarding widget's first task
 * is incomplete, preventing allDone=true auto-dismiss during F-OB1. (MINCRM-410)
 *
 * Must be called by an admin-authenticated restClient.
 */
export async function resetPipelineStagesReviewed(restClient: RestClient): Promise<void> {
  await restClient.delete('/api/v1/settings/pipeline-stages-reviewed');
}

// ---------------------------------------------------------------------------
// Locator-accessor behaviors — wrap SetupChecklistPage / AutomationPage locators
// so spec files never import @pages/* directly. (MINCRM-367, MINCRM-379)
// ---------------------------------------------------------------------------

/** Fixture context for setup checklist and automation UI behaviors. */
export interface SetupUIBehaviorContext {
  page: PageFacade;
}

/** Asserts the setup checklist widget is visible, with an optional timeout (ms). */
export async function expectSetupChecklistWidgetVisible(
  context: SetupUIBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new SetupChecklistPage(context).widgetLocator();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts the setup checklist pill (collapsed state) is visible, with an optional timeout (ms). */
export async function expectSetupChecklistPillVisible(
  context: SetupUIBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new SetupChecklistPage(context).pillLocator();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/**
 * Clicks the dismiss (X) button to permanently close the setup checklist widget.
 */
export async function dismissSetupChecklist(context: SetupUIBehaviorContext): Promise<void> {
  const checklistPage = new SetupChecklistPage(context);
  await checklistPage.dismiss();
}

/**
 * Clicks the collapse chevron to minimise the widget to a pill.
 */
export async function clickSetupChecklistCollapse(context: SetupUIBehaviorContext): Promise<void> {
  const checklistPage = new SetupChecklistPage(context);
  await checklistPage.collapse();
}

/**
 * Navigates to the automation rules page.
 */
export async function navigateToAutomation(context: SetupUIBehaviorContext): Promise<void> {
  const automationPage = new AutomationPage(context);
  await automationPage.navigate();
}

/** Asserts the automation rules page heading is visible. */
export async function expectAutomationHeadingVisible(
  context: SetupUIBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AutomationPage(context).headingLocator();
  await expect(locator).toBeVisible();
}

/** Asserts the automation pagination controls are visible, with an optional timeout (ms). */
export async function expectAutomationPaginationVisible(
  context: SetupUIBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AutomationPage(context).paginationLocator();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

// ---------------------------------------------------------------------------
// Onboarding visibility helpers — keep page.goto/waitFor/isNotVisible out of
// spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/** Context for setup/onboarding UI behaviors. */
export interface OnboardingBehaviorContext {
  page: PageFacade;
}

/**
 * Navigates to the dashboard root and waits for network idle.
 */
export async function navigateToDashboardAndWait(
  context: OnboardingBehaviorContext,
): Promise<void> {
  await gotoAndSettle(context.page, '/');
}

/**
 * Waits for the dashboard heading to be visible (confirms page is loaded).
 */
export async function waitForDashboardHeading(
  context: OnboardingBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  await context.page.waitFor(
    [{ type: 'testId', value: 'dashboard-heading' }],
    'visible',
    {},
    timeout,
  );
}

/**
 * Returns true when the setup checklist widget is absent or hidden.
 */
export async function isSetupChecklistWidgetHidden(
  context: OnboardingBehaviorContext,
): Promise<boolean> {
  return context.page.isNotVisible([{ type: 'testId', value: 'setup-checklist-widget' }]);
}

/**
 * Returns true when the setup checklist pill is absent or hidden.
 */
export async function isSetupChecklistPillHidden(
  context: OnboardingBehaviorContext,
): Promise<boolean> {
  return context.page.isNotVisible([{ type: 'testId', value: 'setup-checklist-pill' }]);
}

/** Asserts the setup checklist task list is visible, with an optional timeout (ms). */
export async function expectSetupChecklistTaskListVisible(
  context: OnboardingBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'setup-checklist-task-list' },
        { type: 'role', value: 'list' },
      ],
      { intent: 'setup checklist task list showing setup tasks' },
    )
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Returns the innerHTML of the setup checklist task list, used to count list items. */
export async function getSetupChecklistTaskListHtml(
  context: OnboardingBehaviorContext,
): Promise<string> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'setup-checklist-task-list' },
        { type: 'role', value: 'list' },
      ],
      { intent: 'setup checklist task list showing setup tasks' },
    )
    .resolve();
  return locator.innerHTML();
}

// ---------------------------------------------------------------------------
// Custom fields locator helpers — keep page.locate out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/** Context for custom fields UI behaviors. */
export interface CustomFieldsBehaviorContext {
  page: PageFacade;
}

/** Asserts the custom-fields edit grid is visible, with an optional timeout (ms). */
export async function expectCustomFieldsEditGridVisible(
  context: CustomFieldsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'custom-fields-edit-grid' },
        { type: 'css', value: '[data-testid="custom-fields-edit-grid"]' },
      ],
      { intent: 'custom fields edit grid in the entity edit form' },
    )
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/**
 * Clicks the delete button for a custom field definition row.
 * eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback without scoping
 */
export async function clickCustomFieldDeleteButton(
  definitionId: string,
  context: CustomFieldsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed delete button has no stable role fallback without scoping
  const locator = await context.page
    .locate([{ type: 'testId', value: `custom-field-delete-${definitionId}` }])
    .resolve();
  await expect(locator).toBeVisible({ timeout: 5_000 });
  await locator.click();
}

/**
 * Fills a custom field text input, scrolling into view and pressing Tab to flush React state.
 * Returns after confirming the value was accepted.
 * eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
 */
export async function fillCustomFieldInput(
  definitionId: string,
  value: string,
  context: CustomFieldsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed input has no stable role fallback
  const locator = await context.page
    .locate([{ type: 'testId', value: `custom-field-input-${definitionId}` }])
    .resolve();
  // Scroll into view — on mobile the section can be below the fold (MINCRM-554)
  await expect(locator).toBeVisible({ timeout: 5_000 });
  await locator.scrollIntoViewIfNeeded();
  await locator.fill(value);
  // Tab away to flush React's useEffect chain before saving
  await locator.press('Tab');
  await expect(locator).toHaveValue(value);
}

/**
 * Asserts a custom field input is visible in the edit form without filling it.
 * eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
 */
export async function expectCustomFieldInputVisible(
  definitionId: string,
  context: CustomFieldsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed input has no stable role fallback
  const locator = await context.page
    .locate([{ type: 'testId', value: `custom-field-input-${definitionId}` }])
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts the label element for a custom field definition is visible. */
export async function expectCustomFieldLabelVisible(
  definitionId: string,
  context: CustomFieldsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed label has no stable role fallback
  const locator = await context.page
    .locate([{ type: 'testId', value: `custom-field-label-${definitionId}` }])
    .resolve();
  await expect(locator).toBeVisible();
}
