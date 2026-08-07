/**
 * Settings behaviors for MiniCRM — system-wide defaults enforcement and
 * AdminSettings page action/assertion behaviors (MINCRM-358, MINCRM-367, MINCRM-564).
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import { gotoAndSettle } from '@apps/minicrm/helpers.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { AdminSettingsPage } from '@pages/minicrm/AdminSettingsPage.js';
import type { AdminSettingsTab } from '@pages/minicrm/AdminSettingsPage.js';

/**
 * Resets all mutable system settings to their known-good defaults in parallel.
 * Callers must ensure restClient is authenticated as admin.
 *
 * Each reset is fire-and-forget — individual failures are swallowed so that a
 * missing or misconfigured setting does not abort the entire reset sequence.
 * This makes the function safe to call in beforeEach/afterEach even in
 * environments where some settings have never been configured.
 *
 * @param restClient - Admin-authenticated RestClient.
 */
// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** Fixture context for admin settings UI behaviors. */
export interface AdminSettingsBehaviorContext {
  page: PageFacade;
}

export { AdminSettingsTab };

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Navigates to the Admin Settings page, optionally deep-linking to a tab and,
 * for the 'ai' tab, a sub-section (MINCRM-653).
 */
export async function navigateToAdminSettings(
  context: AdminSettingsBehaviorContext,
  tab?: AdminSettingsTab,
  section?: string,
): Promise<void> {
  const adminSettings = new AdminSettingsPage(context);
  await adminSettings.navigate(tab, section);
}

// ---------------------------------------------------------------------------
// Action/assertion behaviors — all write operations go through page methods
// or the HealingLocator API; no raw locators exposed to spec files. (MINCRM-564)
// ---------------------------------------------------------------------------

/** Clicks the webhook event checkbox for the given event name. */
export async function clickAdminSettingsWebhookEvent(
  eventName: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  return new AdminSettingsPage(context).clickWebhookEvent(eventName);
}

/** Clicks the Add Webhook button. */
export async function clickAdminSettingsAddWebhook(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  return new AdminSettingsPage(context).clickAddWebhook();
}

/** Closes the webhook secret reveal modal. */
export async function closeAdminSettingsWebhookSecretModal(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  return new AdminSettingsPage(context).closeWebhookSecretModal();
}

/** Toggles a webhook subscription's enabled/disabled status. */
export async function toggleAdminSettingsWebhook(
  subscriptionId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  return new AdminSettingsPage(context).toggleWebhook(subscriptionId);
}

/** Clicks the delete button for a specific webhook subscription. */
export async function clickAdminSettingsDeleteWebhook(
  subscriptionId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  return new AdminSettingsPage(context).clickDeleteWebhook(subscriptionId);
}

/** Confirms deletion in the webhook delete confirmation dialog. */
export async function confirmAdminSettingsDeleteWebhook(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  return new AdminSettingsPage(context).confirmDeleteWebhook();
}

/** Clicks Add Currency to open the add currency form. */
export async function clickAdminSettingsAddCurrency(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  return new AdminSettingsPage(context).clickAddCurrency();
}

/** Confirms adding a new currency row. */
export async function confirmAdminSettingsAddCurrency(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  return new AdminSettingsPage(context).confirmAddCurrency();
}

/** Clicks Save exchange rates. */
export async function saveAdminSettingsExchangeRates(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  return new AdminSettingsPage(context).saveExchangeRates();
}

/** Clicks Add Field to open the add-field form. */
export async function clickAdminSettingsAddField(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  return new AdminSettingsPage(context).clickAddField();
}

/** Submits the add-field form. */
export async function submitAdminSettingsAddField(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  return new AdminSettingsPage(context).submitAddField();
}

// ---------------------------------------------------------------------------
// SSO configuration (MINCRM-399)
// ---------------------------------------------------------------------------
/** Asserts the SSO save button is not disabled, then clicks it. */
export async function clickSsoSaveButton(context: AdminSettingsBehaviorContext): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).ssoSaveButtonLocator();
  await expect(locator).not.toBeDisabled();
  await locator.click();
}

/** Asserts the SSO enabled badge is visible. */
export async function expectSsoEnabledBadgeVisible(
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).ssoEnabledBadgeLocator(timeout);
  await expect(locator).toBeVisible({ timeout });
}

/** Asserts the SSO enabled badge is NOT visible. */
export async function expectSsoEnabledBadgeNotVisible(
  context: AdminSettingsBehaviorContext,
  timeout = 8_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).ssoEnabledBadgeLocator(timeout);
  await expect(locator).not.toBeVisible({ timeout });
}

/** Asserts the SSO disable confirmation button is visible. */
export async function expectSsoDisableConfirmVisible(
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).ssoDisableConfirmButtonLocator(timeout);
  await expect(locator).toBeVisible({ timeout });
}

/** Clicks the SSO disable confirmation button. */
export async function clickSsoDisableConfirmButton(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).ssoDisableConfirmButtonLocator()).click();
}

// ensureSystemDefaults
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Direct navigation helpers — keep page.goto() out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Navigates directly to a URL and waits for network idle.
 * Use when an existing navigateTo* behavior does not cover the target URL.
 */
export async function navigateToUrl(
  url: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await gotoAndSettle(context.page, url);
}

/**
 * Navigates directly to the Admin Settings pipelines tab (shorthand).
 * Formerly navigated to the 'customisation' tab; renamed to 'pipelines' (MINCRM-563).
 */
export async function navigateToAdminSettingsCustomisation(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await gotoAndSettle(context.page, '/admin/settings?tab=pipelines');
}

/**
 * Navigates directly to the Admin Settings workspace tab (shorthand).
 * Formerly navigated to the 'general' tab; renamed to 'workspace' (MINCRM-563).
 */
export async function navigateToAdminSettingsGeneral(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await gotoAndSettle(context.page, '/admin/settings?tab=workspace');
}

// ---------------------------------------------------------------------------
// Pipeline stage reorder with response capture — keeps waitForResponse out of
// spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/** Shape of a single stage in the pipeline-stages reorder API response. */
export interface PipelineStageReorderEntry {
  id: string;
  name?: string;
  sort_order?: number;
}

/** Result returned by clickMoveUpAndWaitForReorder / clickMoveDownAndWaitForReorder. */
export interface StageReorderResult {
  /** The stages array returned by the server in the reorder response. */
  stages: PipelineStageReorderEntry[];
}

/**
 * Clicks the move-up button for a stage and waits for the reorder API response.
 * Returns the server-committed stage order from the response body.
 */
export async function clickMoveUpAndWaitForReorder(
  stageId: string,
  context: AdminSettingsBehaviorContext,
): Promise<StageReorderResult> {
  const moveUpButton = await new AdminSettingsPage(context).pipelineStageMoveUpLocator(stageId);
  const [reorderResp] = await Promise.all([
    context.page.waitForResponse(
      (resp) =>
        resp.url().includes('/pipeline-stages/reorder') &&
        resp.request().method() === 'PUT' &&
        resp.status() === 200,
    ),
    moveUpButton.click(),
  ]);
  const body = (await reorderResp.json()) as { stages: PipelineStageReorderEntry[] };
  return { stages: body.stages };
}

/**
 * Clicks the move-down button for a stage and waits for the reorder API response.
 * Returns the server-committed stage order from the response body.
 */
export async function clickMoveDownAndWaitForReorder(
  stageId: string,
  context: AdminSettingsBehaviorContext,
): Promise<StageReorderResult> {
  const moveDownButton = await new AdminSettingsPage(context).pipelineStageMoveDownLocator(stageId);
  const [reorderResp] = await Promise.all([
    context.page.waitForResponse(
      (resp) =>
        resp.url().includes('/pipeline-stages/reorder') &&
        resp.request().method() === 'PUT' &&
        resp.status() === 200,
    ),
    moveDownButton.click(),
  ]);
  const body = (await reorderResp.json()) as { stages: PipelineStageReorderEntry[] };
  return { stages: body.stages };
}

// ---------------------------------------------------------------------------
// Pipeline stage form interactions — keep page.click/fill/waitFor out of specs.
// (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Clicks the Add Stage button to open the add-stage inline form.
 */
export async function clickAddPipelineStage(context: AdminSettingsBehaviorContext): Promise<void> {
  await context.page.click(
    [
      { type: 'testId', value: 'add-stage-button' },
      { type: 'role', value: 'button', options: { name: /add.*stage/i } },
    ],
    { intent: 'button to open the add new pipeline stage form' },
  );
}

/**
 * Fills the add-stage name input with the given stage name.
 */
export async function fillAddPipelineStageName(
  stageName: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await context.page.fill(
    stageName,
    [
      { type: 'testId', value: 'add-stage-name-input' },
      { type: 'role', value: 'textbox', options: { name: /stage name/i } },
    ],
    { intent: 'input for the name of the new pipeline stage' },
  );
}

/**
 * Clicks the submit button to create the new pipeline stage.
 */
export async function submitAddPipelineStage(context: AdminSettingsBehaviorContext): Promise<void> {
  await context.page.click(
    [
      { type: 'testId', value: 'add-stage-submit' },
      { type: 'role', value: 'button', options: { name: /add/i } },
    ],
    { intent: 'submit button that creates the new pipeline stage' },
  );
}

/**
 * Waits for the pipeline stages feedback element to reach the given state.
 */
export async function waitForPipelineStagesFeedback(
  state: 'visible' | 'hidden',
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await context.page.waitFor(
    [
      { type: 'testId', value: 'pipeline-stages-feedback' },
      { type: 'role', value: 'status' },
    ],
    state,
    { intent: 'success or error feedback after submitting the add stage form' },
  );
}

/**
 * Fills the inline rename input for a pipeline stage.
 */
export async function fillRenamePipelineStage(
  newName: string,
  stageId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await context.page.fill(
    newName,
    [
      { type: 'testId', value: `pipeline-stage-name-input-${stageId}` },
      { type: 'css', value: `[data-testid="pipeline-stage-name-input-${stageId}"]` },
    ],
    { intent: 'inline name input for renaming the selected pipeline stage' },
  );
}

/**
 * Clicks the delete confirmation dialog's confirm button and waits for
 * the dialog to become hidden.
 */
export async function clickDeletePipelineStageConfirm(
  stageId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await context.page.click(
    [
      { type: 'testId', value: 'delete-stage-confirm' },
      { type: 'role', value: 'button', options: { name: /delete/i } },
    ],
    { intent: 'confirm button inside the delete stage confirmation dialog' },
  );
}

/**
 * Waits for the delete-stage confirmation dialog to reach the given state.
 */
export async function waitForDeleteStageDialog(
  state: 'visible' | 'hidden',
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const strategies = [
    { type: 'testId' as const, value: 'delete-stage-confirm-dialog' },
    { type: 'role' as const, value: 'dialog', options: { name: /delete/i } },
  ];
  if (state === 'hidden') {
    // isNotVisible() handles already-absent elements without calling resolve() first —
    // avoids StrategyExhaustedError when the dialog closes faster than resolve() can find it.
    const { expect } = await import('@playwright/test');
    const notVisible = await context.page.isNotVisible(strategies, timeout);
    expect(notVisible).toBe(true);
  } else {
    await context.page.waitFor(
      strategies,
      state,
      {
        intent: 'confirmation dialog for deleting a pipeline stage',
      },
      timeout,
    );
  }
}

export async function ensureSystemDefaults(restClient: RestClient): Promise<void> {
  await Promise.all([
    restClient
      .patch('/api/v1/settings/default-language', { language: 'en' })
      .catch(() => undefined),
    restClient.patch('/api/v1/settings/nav-layout', { layout: 'top' }).catch(() => undefined),
    restClient
      .patch('/api/v1/settings/email-notifications', { enabled: true })
      .catch(() => undefined),
    restClient
      .patch('/api/v1/settings/tags-restrict-creation', { restricted: false })
      .catch(() => undefined),
    restClient
      .put('/api/v1/settings/currencies', { home_currency: 'USD', currencies: [] })
      .catch(() => undefined),
    restClient.delete('/api/v1/settings/branding').catch(() => undefined),
    // Reset pipeline_stages_reviewed so the onboarding widget's first task
    // is always incomplete, preventing allDone=true auto-dismiss in F-OB1. (MINCRM-410)
    restClient.delete('/api/v1/settings/pipeline-stages-reviewed').catch(() => undefined),
    // Clear any SSO configuration left over from SSO tests (MINCRM-399)
    restClient.delete('/api/v1/settings/sso').catch(() => undefined),
    // Reset org-wide MFA enforcement; mfa.spec.ts F8-A1 can leave this true if
    // the test body exits before its UI-based restore step runs. (MINCRM-544)
    restClient
      .patch('/api/v1/settings/mfa-required', { mfa_required: false })
      .catch(() => undefined),
    // Reset org visibility policies; visibility.spec.ts mutates these and the
    // afterEach reset can race with concurrent shards' beforeEach calls, causing
    // policy to read as 'org' mid-test when a private/team policy is expected.
    restClient
      .put('/api/v1/settings/visibility', { contact: 'org', deal: 'org', activity: 'org' })
      .catch(() => undefined),
  ]);
}

// ---------------------------------------------------------------------------
// SSO login page helpers — keep page.goto/locate/reload out of spec files.
// (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Navigates to the login page and waits for network idle.
 * Used by SSO tests that need to verify the login page as an unauthenticated user.
 *
 * Deliberately NOT routed through gotoAndSettle: the login route is
 * unauthenticated and never issues GET /api/v1/feature-flags/me, so waiting on
 * that response would burn the full timeout on every call. There are no
 * flag-gated subtrees here, so networkidle is an adequate signal. (MINCRM-700)
 */
export async function navigateToLoginPageForSso(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await context.page.goto('/login', { waitUntil: 'networkidle' });
}

// ---------------------------------------------------------------------------
// Webhooks navigation helpers — keep page.goto out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Navigates to the admin settings integrations tab and waits for network idle.
 * The integrations tab retains its key; SSO/SCIM moved to security tab (MINCRM-563).
 */
export async function navigateToAdminSettingsIntegrations(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await gotoAndSettle(context.page, '/admin/settings?tab=integrations');
}

// ---------------------------------------------------------------------------
// Currency settings navigation helpers (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Navigates to the admin settings currency tab and waits for the currencies
 * config to be fetched. The extra waitForResponse ensures TanStack Query's
 * initial fetch has completed before the caller interacts with the form —
 * without it, a background refetch can overwrite React state set by
 * selectOption() if the cached response resolves before the network fetch.
 * (MINCRM-418)
 */
export async function navigateToAdminSettingsCurrency(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  // Navigate and then wait for ALL in-flight GET /settings/currencies requests to
  // complete. With staleTime:0 the component may fire a background refetch after
  // the initial response; each refetch re-runs the useEffect that sets homeCurrency,
  // overwriting any selectOption() call made in between. waitUntil:'networkidle'
  // after the first response ensures both the initial fetch and any background
  // refetch have landed before the caller interacts with the form. (MINCRM-418)
  await gotoAndSettle(context.page, '/admin/settings?tab=workspace');
  // Settle any pending re-renders after the network quietens.
  await context.page.waitForFunction(
    `document.querySelector('[data-testid="home-currency-select"]') !== null`,
    undefined,
    { timeout: 10_000 },
  );
}

// ---------------------------------------------------------------------------
// Pipeline management UI behaviors — keep page.locate() out of spec files.
// (MINCRM-418)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stage exit requirements UI behaviors (MINCRM-527)
// ---------------------------------------------------------------------------

/**
 * Polls the pipeline-stages API until the given stage includes the specified field
 * in its required_fields list. Used to confirm a save persisted before asserting.
 * @param stageId - UUID of the pipeline stage.
 * @param requiredField - Field name expected in required_fields.
 */
export async function waitForStageExitRequirementsUpdated(
  stageId: string,
  requiredField: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await context.page.waitForFunction(
    ([id, field]: [string, string]) => {
      return fetch('/api/v1/settings/pipeline-stages')
        .then((res) => res.json())
        .then((json: unknown) => {
          const data = json as {
            stages: { id: string; stage_exit_requirements: { required_fields: string[] } }[];
          };
          const stage = data.stages.find((s) => s.id === id);
          return stage?.stage_exit_requirements.required_fields.includes(field) ?? false;
        })
        .catch(() => false);
    },
    [stageId, requiredField] as [string, string],
    { timeout: 10_000 },
  );
}

// ---------------------------------------------------------------------------
// Feature flag UI behaviors (MINCRM-463)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AI Settings behaviors (MINCRM-457)
// ---------------------------------------------------------------------------

/** Shape of the AI configuration returned by the admin AI config endpoint. */
export interface TestAiConfig {
  enabled: boolean;
  enabled_updated_at: string | null;
  provider: string;
  model: string;
  api_key_set: boolean;
  deployment_mode: string;
  base_url: string;
  dpa_acknowledged: boolean;
  dpa_acknowledged_by: string;
  dpa_acknowledged_at: string | null;
  dpa_acknowledged_for_provider: string;
  custom_dpa_url: string;
  dpa_status: string;
  data_posture: string;
  available_models: { id: string; display_name: string; provider: string }[];
  provider_dpa_url: string;
  ai_session_retention_days: number;
}

/**
 * Fetches the current AI configuration via the admin REST API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @returns The current AI configuration.
 */
export async function getAiConfig(restClient: RestClient): Promise<TestAiConfig> {
  const res = await restClient.get<TestAiConfig>('/api/v1/admin/ai/config');
  return res.body;
}

/**
 * Sets the AI master toggle (enabled / disabled) via the admin REST API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param enabled - The desired enabled state.
 * @returns The updated AI configuration.
 */
export async function setAiEnabled(
  restClient: RestClient,
  enabled: boolean,
): Promise<TestAiConfig> {
  const res = await restClient.patch<TestAiConfig>('/api/v1/admin/ai/master-toggle', { enabled });
  return res.body;
}

/**
 * Resets the AI configuration to disabled defaults by disabling AI
 * and clearing DPA acknowledgment. Safe to call in beforeEach/afterEach.
 *
 * @param restClient - Admin-authenticated RestClient.
 */
export async function resetAiSettings(restClient: RestClient): Promise<void> {
  await Promise.all([
    restClient.patch('/api/v1/admin/ai/master-toggle', { enabled: false }).catch(() => undefined),
    restClient
      .post('/api/v1/admin/ai/dpa-acknowledgment', { acknowledged: false, custom_dpa_url: '' })
      .catch(() => undefined),
    restClient
      .patch('/api/v1/admin/ai/config', {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        deployment_mode: 'cloud_api',
        base_url: '',
        custom_dpa_url: '',
      })
      .catch(() => undefined),
    restClient
      .patch('/api/v1/admin/ai/session-retention', { ai_session_retention_days: 90 })
      .catch(() => undefined),
  ]);
}

/** Default cost rates as seeded by db/migrations/137_add_ai_cost_rate_config.js. */
const DEFAULT_AI_INPUT_COST_PER_MILLION_CENTS = 300;
const DEFAULT_AI_OUTPUT_COST_PER_MILLION_CENTS = 1500;

/**
 * Resets the AI cost estimation rates (ai_input/output_cost_per_million_cents)
 * back to their seeded defaults. Safe to call in afterEach for specs that
 * mutate /admin/ai/cost-rates (MINCRM-459).
 *
 * @param restClient - Admin-authenticated RestClient.
 */
export async function resetAiCostRates(restClient: RestClient): Promise<void> {
  await restClient
    .patch('/api/v1/admin/ai/cost-rates', {
      ai_input_cost_per_million_cents: DEFAULT_AI_INPUT_COST_PER_MILLION_CENTS,
      ai_output_cost_per_million_cents: DEFAULT_AI_OUTPUT_COST_PER_MILLION_CENTS,
    })
    .catch(() => undefined);
}

/**
 * Resets a single standard-field AI exclusion override back to excluded=false
 * (the seeded default for every standard field — MINCRM-461). Safe to call in
 * afterEach for specs that mutate /admin/ai/field-exclusions.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param entityType - 'contact' | 'account' | 'deal'.
 * @param fieldName - Standard field name eligible for the exclusion toggle.
 */
export async function resetAiFieldExclusion(
  restClient: RestClient,
  entityType: string,
  fieldName: string,
): Promise<void> {
  await restClient
    .patch('/api/v1/admin/ai/field-exclusions', {
      entity_type: entityType,
      field_name: fieldName,
      excluded: false,
    })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Visibility Settings behaviors (MINCRM-538)
// ---------------------------------------------------------------------------

/**
 * Resets all visibility policies back to 'org' via the REST API.
 * Safe to call in beforeEach/afterEach when tests mutate visibility settings.
 * Caller must be authenticated as admin.
 */
export async function resetVisibilitySettings(restClient: RestClient): Promise<void> {
  await restClient
    .put('/api/v1/settings/visibility', {
      contact: 'org',
      deal: 'org',
      activity: 'org',
      account: 'org',
    })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Roles tab — built-in role View button (MINCRM-547)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Intent-bearing action/assertion behaviors — replace locator-accessor
// wrappers with explicit, single-operation functions (MINCRM-564)
// ---------------------------------------------------------------------------

/** Asserts that the admin settings page heading is visible. */
export async function expectAdminSettingsHeadingVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).settingsHeadingLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the settings save button (general tab) is visible. */
export async function expectAdminSettingsSaveVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).settingsSaveLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the webhook settings section is visible. */
export async function expectAdminSettingsWebhookSectionVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).webhookSectionLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Fills the webhook URL input with the given URL. */
export async function fillAdminSettingsWebhookUrl(
  url: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await new AdminSettingsPage(context).webhookUrlInputLocator();
  await locator.fill(url);
}

/** Asserts that the webhook secret reveal modal is visible. */
export async function expectAdminSettingsWebhookSecretRevealVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).webhookSecretRevealLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Returns the current value of the webhook secret input. */
export async function getAdminSettingsWebhookSecretValue(
  context: AdminSettingsBehaviorContext,
): Promise<string> {
  return (await new AdminSettingsPage(context).webhookSecretValueLocator()).inputValue();
}

/** Asserts that the webhook delete confirmation dialog is visible. */
export async function expectAdminSettingsWebhookDeleteConfirmVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).webhookDeleteConfirmLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the exchange rates section is visible. */
export async function expectAdminSettingsExchangeRatesSectionVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).exchangeRatesSectionLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Selects the home currency in the home currency select. */
export async function selectAdminSettingsHomeCurrency(
  currencyCode: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (
    await new AdminSettingsPage(context).homeCurrencySelectLocator()
  ).selectOption(currencyCode);
}

/** Asserts that the add-currency form is visible. */
export async function expectAdminSettingsAddCurrencyFormVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).addCurrencyFormLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Selects a currency code in the add-currency code select. */
export async function selectAdminSettingsAddCurrencyCode(
  code: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).addCurrencyCodeSelectLocator()).selectOption(code);
}

/** Fills the exchange rate input with the given rate. */
export async function fillAdminSettingsAddCurrencyRate(
  rate: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).addCurrencyRateInputLocator()).fill(rate);
}

/** Asserts that the exchange rate save success message is visible. */
export async function expectAdminSettingsExchangeRateSaveSuccessVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).exchangeRateSaveSuccessLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that an exchange rate row for the given currency code is visible. */
export async function expectAdminSettingsExchangeRateRowVisible(
  currencyCode: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).exchangeRateRowLocator(currencyCode);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the custom fields section is visible. */
export async function expectAdminSettingsCustomFieldsSectionVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).customFieldsSectionLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Selects an entity type in the custom fields entity select. */
export async function selectAdminSettingsCustomFieldsEntity(
  entityType: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (
    await new AdminSettingsPage(context).customFieldsEntitySelectLocator()
  ).selectOption(entityType);
}

/** Asserts that the add-field inline form is visible. */
export async function expectAdminSettingsAddFieldFormVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).addFieldFormLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Fills the add-field name input with the given name. */
export async function fillAdminSettingsAddFieldName(
  name: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).addFieldNameInputLocator()).fill(name);
}

/** Asserts that the custom fields feedback message is visible. */
export async function expectAdminSettingsCustomFieldsFeedbackVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).customFieldsFeedbackLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the confirm-delete-field button is visible. */
export async function expectAdminSettingsDeleteFieldConfirmVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).deleteFieldConfirmLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Clicks the confirm-delete-field button. */
export async function clickAdminSettingsDeleteFieldConfirm(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).deleteFieldConfirmLocator()).click();
}

/** Asserts that the branding form is visible. */
export async function expectAdminSettingsBrandingFormVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).brandingFormLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Fills the branding company name input. */
export async function fillAdminSettingsBrandingCompanyName(
  name: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).brandingCompanyNameLocator()).fill(name);
}

/** Fills the branding primary colour text input. */
export async function fillAdminSettingsBrandingColorText(
  color: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).brandingColorTextLocator()).fill(color);
}

/** Selects a font in the branding font select. */
export async function selectAdminSettingsBrandingFont(
  font: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).brandingFontSelectLocator()).selectOption(font);
}

/** Clicks the branding Save button. */
export async function clickAdminSettingsBrandingSave(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).brandingSaveLocator()).click();
}

/** Asserts that the branding save success message is visible. */
export async function expectAdminSettingsBrandingSaveSuccessVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).brandingSaveSuccessLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Clicks the branding reset button. */
export async function clickAdminSettingsBrandingReset(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).brandingResetButtonLocator()).click();
}

/** Clicks the branding reset confirm button. */
export async function clickAdminSettingsBrandingResetConfirm(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).brandingResetConfirmLocator()).click();
}

/** Asserts that the branding reset success message is visible. */
export async function expectAdminSettingsBrandingResetSuccessVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).brandingResetSuccessLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the pipeline stages table is visible. */
export async function expectPipelineStagesTableVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).pipelineStagesTableLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the SSO section panel is visible. */
export async function expectSsoSectionVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).ssoSectionLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Selects the SSO protocol. */
export async function selectSsoProtocol(
  protocol: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).ssoProtocolSelectLocator()).selectOption(protocol);
}

/** Fills the SSO IdP metadata URL input. */
export async function fillSsoIdpMetadataUrl(
  url: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).ssoIdpMetadataUrlInputLocator()).fill(url);
}

/** Fills the SSO entity ID input. */
export async function fillSsoEntityId(
  entityId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).ssoEntityIdInputLocator()).fill(entityId);
}

/** Asserts that the SSO save success message is visible. */
export async function expectSsoSaveSuccessVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).ssoSaveSuccessLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Clicks the SSO disable button. */
export async function clickSsoDisableButton(context: AdminSettingsBehaviorContext): Promise<void> {
  await (await new AdminSettingsPage(context).ssoDisableButtonLocator()).click();
}

/** Asserts that the SSO login button on the login page is visible. */
export async function expectSsoLoginButtonVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'sso-login-button' },
        { type: 'role', value: 'link', options: { name: /sign in with/i } },
      ],
      {
        intent: 'SSO login button on the login page',
        fallbackTimeout: 8_000,
      },
    )
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the SSO login button on the login page is NOT visible. */
export async function expectSsoLoginButtonNotVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // Re-locate after page state change; the element may be absent from the DOM
  // or hidden. If the locator strategy exhausts all fallbacks (button not in DOM),
  // catch the error and consider the assertion trivially satisfied. (MINCRM-564)
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'sso-login-button' },
        { type: 'role', value: 'link', options: { name: /sign in with/i } },
      ],
      {
        intent: 'SSO login button on the login page',
        fallbackTimeout: 2_000,
      },
    )
    .resolve()
    .catch(() => null);
  if (locator) {
    await expect(locator).not.toBeVisible(timeout !== undefined ? { timeout } : undefined);
  }
}

/** Asserts that the feature flags list is visible. */
export async function expectFeatureFlagsListVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'feature-flags-list' },
        { type: 'role', value: 'region' },
      ],
      { intent: 'container showing the grouped list of feature flags' },
    )
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Clicks the confirm OK button inside the feature flag confirmation dialog. */
export async function clickFeatureFlagConfirmOk(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'feature-flag-confirm-ok' },
        { type: 'role', value: 'button', options: { name: /confirm/i } },
      ],
      { intent: 'confirm button inside the feature flag toggle confirmation dialog' },
    )
    .resolve();
  await locator.click();
}

/** Clicks the Confirm button inside the AI toggle confirmation dialog. */
export async function clickAiToggleConfirmButton(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).aiToggleConfirmButtonLocator()).click();
}

/**
 * Clicks the AI toggle confirm button and waits for the PATCH response before
 * returning. Registering waitForResponse before clicking prevents a race where
 * a fast server response is missed, and awaiting it ensures the React Query
 * cache holds fresh data before the caller asserts on toggle state.
 */
export async function clickAiToggleConfirmAndWait(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const toggleDone = context.page.waitForResponse(
    (res) => res.url().includes('/admin/ai/master-toggle') && res.status() === 200,
    { timeout: 15_000 },
  );
  await (await new AdminSettingsPage(context).aiToggleConfirmButtonLocator()).click();
  await toggleDone;
}

/** Clicks the Cancel button inside the AI toggle confirmation dialog. */
export async function clickAiToggleCancelButton(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).aiToggleCancelButtonLocator()).click();
}

/** Asserts that the AI data posture badge is visible. */
export async function expectAiDataPostureBadgeVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiDataPostureBadgeLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the AI test connection result message is visible. */
export async function expectAiTestConnectionResultVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiTestConnectionResultLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the read-only capability list inside an expanded panel is visible. */
export async function expectRoleCapabilityReadOnlyListVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).roleCapabilityReadOnlyListLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that a specific disabled capability checkbox in a built-in role panel is disabled. */
export async function expectRoleReadOnlyCapabilityCheckboxDisabled(
  context: AdminSettingsBehaviorContext,
  capabilityKey: string,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).roleReadOnlyCapabilityCheckboxLocator(
    capabilityKey,
  );
  await expect(locator).toBeDisabled();
}

/** Clicks the Add Pipeline button. */
export async function clickPipelineAddButton(context: AdminSettingsBehaviorContext): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'add-pipeline-button' },
        { type: 'role', value: 'button', options: { name: /new pipeline/i } },
      ],
      { intent: 'button to open the new pipeline form' },
    )
    .resolve();
  await locator.click();
}

/** Fills the new-pipeline name input. */
export async function fillNewPipelineName(
  name: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'new-pipeline-name-input' },
        { type: 'role', value: 'textbox' },
      ],
      { intent: 'input field for the new pipeline name' },
    )
    .resolve();
  await locator.fill(name);
}

/** Clicks the create-pipeline submit button. */
export async function clickCreatePipelineSubmit(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'create-pipeline-submit-button' },
        { type: 'role', value: 'button', options: { name: /save/i } },
      ],
      { intent: 'submit button to create the new pipeline' },
    )
    .resolve();
  await locator.click();
}

/** Asserts that the pipelines feedback status message is visible. */
export async function expectPipelinesFeedbackVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'pipelines-feedback' },
        { type: 'role', value: 'status' },
      ],
      { intent: 'success feedback message after a pipeline operation' },
    )
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Clicks the edit button for a specific pipeline row. */
export async function clickPipelineEditButton(
  pipelineId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `pipeline-edit-button-${pipelineId}` },
        { type: 'role', value: 'button', options: { name: /edit/i } },
      ],
      { intent: 'edit button for the pipeline row to rename' },
    )
    .resolve();
  await locator.click();
}

/** Fills the edit input for a specific pipeline row. */
export async function fillPipelineEditInput(
  pipelineId: string,
  value: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `pipeline-edit-input-${pipelineId}` },
        { type: 'role', value: 'textbox' },
      ],
      { intent: 'text input for renaming the pipeline' },
    )
    .resolve();
  await locator.fill(value);
}

/** Clicks the save button for a specific pipeline row. */
export async function clickPipelineSaveButton(
  pipelineId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `pipeline-save-button-${pipelineId}` },
        { type: 'role', value: 'button', options: { name: /save/i } },
      ],
      { intent: 'save button to confirm pipeline rename' },
    )
    .resolve();
  await locator.click();
}

/** Clicks the delete button for a specific pipeline row. */
export async function clickPipelineDeleteButton(
  pipelineId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `pipeline-delete-button-${pipelineId}` },
        { type: 'role', value: 'button', options: { name: /delete/i } },
      ],
      { intent: 'delete button for the pipeline row to remove' },
    )
    .resolve();
  await locator.click();
}

/** Clicks the confirm-delete button inside the pipeline deletion confirmation panel. */
export async function clickPipelineDeleteConfirmButton(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'pipeline-delete-confirm-button' },
        { type: 'role', value: 'button', options: { name: /delete/i } },
      ],
      { intent: 'confirm button to execute pipeline deletion' },
    )
    .resolve();
  await locator.click();
}

/** Selects the pipeline in the pipeline stages pipeline selector. */
export async function selectPipelineStagesPipeline(
  pipelineId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'pipeline-stages-pipeline-selector' },
        { type: 'role', value: 'combobox' },
      ],
      { intent: 'dropdown to select which pipeline to manage stages for' },
    )
    .resolve();
  await locator.selectOption(pipelineId);
}

/** Asserts that a specific pipeline stage row is visible. */
export async function expectPipelineStageRowVisible(
  stageId: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `pipeline-stage-row-${stageId}` },
        { type: 'text', value: 'Custom Stage One' },
      ],
      { intent: 'row for the custom stage in the pipeline stages table' },
    )
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the pipeline board container is visible. */
export async function expectPipelineBoardContainerVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // eslint-disable-next-line local/require-locator-fallback -- board container div; no stable role alternative
  const locator = await context.page
    .locate([{ type: 'testId', value: 'pipeline-board' }], {
      intent: 'the main pipeline kanban board container',
    })
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Clicks the inline edit button for a pipeline stage row. */
export async function clickPipelineStageEditButton(
  stageId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
  const locator = await context.page
    .locate([{ type: 'testId', value: `pipeline-stage-edit-${stageId}` }])
    .resolve();
  await locator.click();
}

/** Clicks the inline save button for a pipeline stage row. */
export async function clickPipelineStageSaveButton(
  stageId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
  const locator = await context.page
    .locate([{ type: 'testId', value: `pipeline-stage-save-${stageId}` }])
    .resolve();
  await locator.click();
}

/** Fills the exit required input for a pipeline stage. */
export async function fillPipelineStageExitRequiredInput(
  stageId: string,
  value: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
  const locator = await context.page
    .locate([{ type: 'testId', value: `pipeline-stage-exit-required-${stageId}` }])
    .resolve();
  await locator.fill(value);
}

/** Asserts that the visibility settings panel is visible. */
export async function expectVisibilitySettingsPanelVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).visibilitySettingsPanelLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the contacts visibility select is visible. */
export async function expectVisibilityContactsSelectVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).visibilityContactsSelectLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Selects a value in the contacts visibility select. */
export async function selectVisibilityContacts(
  value: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (
    await new AdminSettingsPage(context).visibilityContactsSelectLocator()
  ).selectOption(value);
}

/** Asserts that the accounts visibility select is visible. */
export async function expectVisibilityAccountsSelectVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).visibilityAccountsSelectLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Selects a value in the accounts visibility select. */
export async function selectVisibilityAccounts(
  value: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (
    await new AdminSettingsPage(context).visibilityAccountsSelectLocator()
  ).selectOption(value);
}

/** Clicks the visibility save button. */
export async function clickVisibilitySaveButton(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).visibilitySaveButtonLocator()).click();
}

/** Asserts that the visibility save success message is visible. */
export async function expectVisibilitySaveSuccessVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).visibilitySaveSuccessLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

// ---------------------------------------------------------------------------
// Pipeline stage move-up / move-down assertions (MINCRM-564)
// Replaces getPipelineStageMoveUpLocator / getPipelineStageMoveDownLocator
// ---------------------------------------------------------------------------

/** Asserts that the move-up button for the given stage is enabled. */
export async function expectPipelineStageMoveUpEnabled(
  stageId: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).pipelineStageMoveUpLocator(stageId);
  await expect(locator).toBeEnabled(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the move-up button for the given stage is disabled. */
export async function expectPipelineStageMoveUpDisabled(
  stageId: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).pipelineStageMoveUpLocator(stageId);
  await expect(locator).toBeDisabled(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the move-down button for the given stage is enabled. */
export async function expectPipelineStageMoveDownEnabled(
  stageId: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).pipelineStageMoveDownLocator(stageId);
  await expect(locator).toBeEnabled(timeout !== undefined ? { timeout } : undefined);
}

/**
 * Clicks the delete button for a pipeline stage, scrolling it into view first.
 * The caller is responsible for retrying the click if the confirmation dialog
 * does not appear in time (MINCRM-564).
 */
export async function clickPipelineStageDeleteButton(
  stageId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
  const locator = await context.page
    .locate([{ type: 'testId', value: `pipeline-stage-delete-${stageId}` }])
    .resolve();
  await expect(locator).toBeVisible({ timeout: 5_000 });
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
}

// ---------------------------------------------------------------------------
// Feature flag toggle intent-bearing behaviors (MINCRM-564)
// Replaces getFeatureFlagToggleLocator / getFeatureFlagConfirmDialogLocator /
// getAdminSettingsAiTabLocator
// ---------------------------------------------------------------------------

/** Asserts that the feature flag toggle for the given key has aria-checked=true. */
export async function expectFeatureFlagToggleChecked(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `feature-flag-toggle-${flagKey}` },
        { type: 'role', value: 'switch', options: { name: new RegExp(flagKey, 'i') } },
      ],
      { intent: `toggle switch for the ${flagKey} feature flag` },
    )
    .resolve();
  await expect(locator).toHaveAttribute(
    'aria-checked',
    'true',
    timeout !== undefined ? { timeout } : undefined,
  );
}

/** Asserts that the feature flag toggle for the given key has aria-checked=false. */
export async function expectFeatureFlagToggleUnchecked(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `feature-flag-toggle-${flagKey}` },
        { type: 'role', value: 'switch', options: { name: new RegExp(flagKey, 'i') } },
      ],
      { intent: `toggle switch for the ${flagKey} feature flag` },
    )
    .resolve();
  await expect(locator).toHaveAttribute(
    'aria-checked',
    'false',
    timeout !== undefined ? { timeout } : undefined,
  );
}

/** Clicks the feature flag toggle for the given key. */
export async function clickFeatureFlagToggle(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `feature-flag-toggle-${flagKey}` },
        { type: 'role', value: 'switch', options: { name: new RegExp(flagKey, 'i') } },
      ],
      { intent: `toggle switch to enable or disable the ${flagKey} feature flag` },
    )
    .resolve();
  await locator.click();
}

/** Asserts that the feature flag confirmation dialog is visible. */
export async function expectFeatureFlagConfirmDialogVisible(
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  // waitForPresent guards against resolve() failing before the dialog renders.
  // resolve() probes with a 2 s fallback; the dialog appears after a React state
  // update following the toggle click, which can take >2 s on slow boxes.
  await context.page.waitForPresent('[data-testid="feature-flag-confirm-dialog"]', timeout);
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'feature-flag-confirm-dialog' },
        { type: 'role', value: 'dialog' },
      ],
      { intent: 'confirmation dialog shown before toggling a feature flag' },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/** Asserts that the feature flag confirmation dialog is NOT visible (has left the DOM). */
export async function expectFeatureFlagConfirmDialogNotVisible(
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  // The confirmation dialog is unmounted (not just hidden) when dismissed.
  // resolve() would throw StrategyExhaustedError once the element leaves the DOM,
  // so we use waitForAbsent which polls the DOM directly without a healing locator.
  await context.page.waitForAbsent('[data-testid="feature-flag-confirm-dialog"]', timeout);
}

/** Asserts that the AI Features tab is attached to the DOM (visible or hidden). */
export async function expectAdminSettingsAiTabAttached(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'settings-tab-ai' },
        { type: 'role', value: 'tab', options: { name: /ai/i } },
      ],
      { intent: 'AI Features tab in the admin settings navigation' },
    )
    .resolve();
  await expect(locator).toBeAttached(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the AI Features tab is disabled. */
/**
 * Asserts that the AI panel shows a disabled banner (feature flag is off).
 * The tab itself is always navigation-accessible; the panel content is visually disabled. (MINCRM-566)
 */
export async function expectAdminSettingsAiTabDisabled(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'ai-panel-disabled-banner' },
        { type: 'css', value: '[data-testid="ai-panel-disabled-wrapper"] p' },
      ],
      {
        intent:
          'disabled feature banner shown in the AI settings panel when ai_features flag is off',
      },
    )
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the AI panel disabled banner is absent (feature flag is on). */
export async function expectAdminSettingsAiTabEnabled(
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const notVisible = await context.page.isNotVisible(
    [{ type: 'testId', value: 'ai-panel-disabled-banner' }],
    timeout,
  );
  const { expect } = await import('@playwright/test');
  expect(notVisible).toBe(true);
}

// ---------------------------------------------------------------------------
// AI Settings intent-bearing behaviors (MINCRM-564)
// Replaces getAiSettingsPanelLocator, getAiMasterToggleLocator, etc.
// ---------------------------------------------------------------------------

/** Asserts that the AI settings panel is visible. */
export async function expectAiSettingsPanelVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiSettingsPanelLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/**
 * Clicks the given AI settings sub-navigation tab. (MINCRM-653)
 *
 * @param section - Sub-section key, e.g. 'general', 'usage-budgets',
 *   'data-retention', 'data-minimization'.
 */
export async function clickAiSettingsSubNavTab(
  section: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await new AdminSettingsPage(context).aiSettingsSubNavTabLocator(section);
  await locator.click();
}

/** Asserts that the given AI settings sub-section panel is visible. (MINCRM-653) */
export async function expectAiSettingsSubPanelVisible(
  section: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiSettingsSubPanelLocator(section);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the AI master toggle is visible. */
export async function expectAiMasterToggleVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiMasterToggleLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Clicks the AI master toggle. */
export async function clickAiMasterToggle(context: AdminSettingsBehaviorContext): Promise<void> {
  await (await new AdminSettingsPage(context).aiMasterToggleLocator()).click();
}

/** Asserts that the AI master toggle has aria-checked=false (disabled state). */
export async function expectAiMasterToggleUnchecked(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiMasterToggleLocator(timeout);
  await expect(locator).toHaveAttribute(
    'aria-checked',
    'false',
    timeout !== undefined ? { timeout } : undefined,
  );
}

/** Asserts that the AI master toggle has aria-checked=true (enabled state). */
export async function expectAiMasterToggleChecked(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiMasterToggleLocator(timeout);
  await expect(locator).toHaveAttribute(
    'aria-checked',
    'true',
    timeout !== undefined ? { timeout } : undefined,
  );
}

/** Asserts that the AI toggle confirmation dialog is visible. */
export async function expectAiToggleConfirmDialogVisible(
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  // Use waitForPresent before resolve() — the dialog renders asynchronously after
  // the toggle click. resolve() probes with a 2 s fallback timeout which is too
  // short for the dialog animation; waitForPresent waits up to `timeout` for the
  // element to enter the DOM before we attempt healing-locator resolution.
  await context.page.waitForPresent('[data-testid="ai-toggle-confirm-dialog"]', timeout);
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiToggleConfirmDialogLocator(timeout);
  await expect(locator).toBeVisible({ timeout });
}

/** Asserts that the AI toggle confirmation dialog is NOT visible (has left the DOM). */
export async function expectAiToggleConfirmDialogNotVisible(
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  // The confirmation dialog is unmounted (not just hidden) when dismissed.
  // resolve() would throw StrategyExhaustedError once the element leaves the DOM,
  // so we use waitForAbsent which polls the DOM directly without a healing locator.
  await context.page.waitForAbsent('[data-testid="ai-toggle-confirm-dialog"]', timeout);
}

/** Asserts that the AI DPA acknowledgment checkbox is visible. */
export async function expectAiDpaCheckboxVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiDpaCheckboxLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the AI DPA acknowledgment checkbox is NOT visible. */
export async function expectAiDpaCheckboxNotVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // Use isNotVisible() so the assertion succeeds even when the checkbox is removed from the
  // DOM entirely (conditionally rendered) — resolve() throws if the element is already absent.
  const notVisible = await context.page.isNotVisible(
    [
      { type: 'testId', value: 'ai-dpa-checkbox' },
      { type: 'role', value: 'checkbox', options: { name: /dpa|data processing/i } },
    ],
    timeout,
  );
  expect(notVisible).toBe(true);
}

/** Clicks the AI DPA acknowledgment checkbox. */
export async function clickAiDpaCheckbox(context: AdminSettingsBehaviorContext): Promise<void> {
  await (await new AdminSettingsPage(context).aiDpaCheckboxLocator()).click();
}

/**
 * Clicks the DPA acknowledgment checkbox and waits for the server POST to
 * complete before returning. Registering the waitForResponse before clicking
 * prevents a race where a fast server response is missed, and awaiting it
 * ensures the React Query cache holds fresh data (dpa_acknowledged: true)
 * before the caller asserts on element visibility — without this, the stale
 * cache briefly re-renders dpa_acknowledged: false during the refetch window.
 */
export async function acknowledgeAiDpa(context: AdminSettingsBehaviorContext): Promise<void> {
  const dpaPostDone = context.page.waitForResponse(
    (res) => res.url().includes('/admin/ai/dpa-acknowledgment') && res.status() === 200,
    { timeout: 15_000 },
  );
  await (await new AdminSettingsPage(context).aiDpaCheckboxLocator()).click();
  await dpaPostDone;
}

/** Asserts that the AI DPA warning banner is visible. */
export async function expectAiDpaWarningBannerVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiDpaWarningBannerLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the AI DPA warning banner is NOT visible, if it exists in the DOM. */
export async function expectAiDpaWarningBannerNotVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context)
    .aiDpaWarningBannerLocator(timeout)
    .catch(() => null);
  if (locator) {
    await expect(locator).not.toBeVisible(timeout !== undefined ? { timeout } : undefined);
  }
}

/** Asserts that the AI model select is visible. */
export async function expectAiModelSelectVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiModelSelectLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/**
 * Returns the number of options in the AI model select element.
 * Used to verify that the select is populated with at least one model.
 */
export async function getAiModelOptionCount(
  context: AdminSettingsBehaviorContext,
): Promise<number> {
  const locator = await new AdminSettingsPage(context).aiModelSelectLocator();
  return locator.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el: Element) => (el as unknown as any).options.length as number,
  );
}

/** Asserts that the AI Test Connection button is visible. */
export async function expectAiTestConnectionButtonVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).aiTestConnectionButtonLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Clicks the AI Test Connection button. */
export async function clickAiTestConnectionButton(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).aiTestConnectionButtonLocator()).click();
}

// ---------------------------------------------------------------------------
// Pipeline delete confirmation and board selector behaviors (MINCRM-564)
// Replaces getPipelineDeleteConfirmLocator / getPipelineBoardSelectorLocator
// ---------------------------------------------------------------------------

/** Asserts that the pipeline delete confirmation panel is visible. */
export async function expectPipelineDeleteConfirmVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // eslint-disable-next-line local/require-locator-fallback -- static container div; no stable role alternative
  const locator = await context.page
    .locate([{ type: 'testId', value: 'pipeline-delete-confirm' }], {
      intent: 'delete confirmation panel for the pipeline',
    })
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/**
 * Waits for the pipeline delete confirmation panel to reach the given state.
 * Used in conjunction with clickPipelineDeleteButton to drive the delete flow.
 */
export async function waitForPipelineDeleteConfirm(
  state: 'visible' | 'hidden',
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  // eslint-disable-next-line local/require-locator-fallback -- static container div; no stable role alternative
  const locator = await context.page
    .locate([{ type: 'testId', value: 'pipeline-delete-confirm' }], {
      intent: 'delete confirmation panel for the pipeline',
    })
    .resolve();
  await locator.waitFor(timeout !== undefined ? { state, timeout } : { state });
}

/** Asserts that the pipeline delete confirmation panel contains the given text. */
export async function expectPipelineDeleteConfirmContainsText(
  text: string | RegExp,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // eslint-disable-next-line local/require-locator-fallback -- static container div; no stable role alternative
  const locator = await context.page
    .locate([{ type: 'testId', value: 'pipeline-delete-confirm' }], {
      intent: 'delete confirmation panel for the pipeline',
    })
    .resolve();
  await expect(locator).toContainText(text, timeout !== undefined ? { timeout } : undefined);
}

/** Waits for the pipeline board selector to be visible, then selects the given pipeline. */
export async function selectPipelineBoardPipeline(
  pipelineId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'pipeline-selector' },
        { type: 'role', value: 'combobox' },
      ],
      { intent: 'pipeline selector dropdown above the deals board' },
    )
    .resolve();
  await locator.waitFor({ state: 'visible' });
  await locator.selectOption(pipelineId);
}

/** Asserts that the pipeline board selector is visible. */
export async function expectPipelineBoardSelectorVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'pipeline-selector' },
        { type: 'role', value: 'combobox' },
      ],
      { intent: 'pipeline selector dropdown above the deals board' },
    )
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

// ---------------------------------------------------------------------------
// Built-in role View button intent-bearing behaviors (MINCRM-564)
// Replaces getRoleViewButtonLocator / getRoleCapabilityPanelLocator
// ---------------------------------------------------------------------------

/** Asserts that the View button for a built-in role card is visible. */
export async function expectRoleViewButtonVisible(
  roleId: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).roleViewButtonLocator(roleId);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Clicks the View button for a built-in role card. */
export async function clickRoleViewButton(
  roleId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await (await new AdminSettingsPage(context).roleViewButtonLocator(roleId)).click();
}

/** Asserts that the read-only capability panel for a built-in role is visible. */
export async function expectRoleCapabilityPanelVisible(
  roleId: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).roleCapabilityPanelLocator(roleId);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the read-only capability panel for a built-in role is NOT visible. */
export async function expectRoleCapabilityPanelNotVisible(
  roleId: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  // The capability panel is fully unmounted from the DOM when collapsed — resolve()
  // would throw StrategyExhaustedError because there is nothing to probe. Use
  // waitForAbsent to poll document.querySelector until the element is gone.
  await context.page.waitForAbsent(`[data-testid="role-capability-panel-${roleId}"]`, timeout);
}

// ---------------------------------------------------------------------------
// Webhook row intent-bearing behaviors (MINCRM-564)
// Replaces getAdminSettingsWebhookRowLocator
// ---------------------------------------------------------------------------

/** Asserts that the webhook subscription row for the given ID is visible. */
export async function expectAdminSettingsWebhookRowVisible(
  subscriptionId: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).webhookRowLocator(subscriptionId);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the webhook subscription row contains the given text. */
export async function expectAdminSettingsWebhookRowContainsText(
  subscriptionId: string,
  text: string | RegExp,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).webhookRowLocator(subscriptionId);
  await expect(locator).toContainText(text, timeout !== undefined ? { timeout } : undefined);
}

/** Asserts that the webhook subscription row is NOT visible. */
export async function expectAdminSettingsWebhookRowNotVisible(
  subscriptionId: string,
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  // Use isNotVisible() rather than resolve() + expect().not.toBeVisible().
  // resolve() calls the healing locator eagerly and throws StrategyExhaustedError
  // when the element is already absent — which is the expected outcome after
  // deletion. isNotVisible() handles both "absent" and "hidden" without throwing.
  const notVisible = await context.page.isNotVisible(
    [
      { type: 'testId', value: `webhook-row-${subscriptionId}` },
      { type: 'css', value: `[data-testid="webhook-row-${subscriptionId}"]` },
    ],
    timeout,
  );
  const { expect } = await import('@playwright/test');
  expect(notVisible).toBe(true);
}

// ---------------------------------------------------------------------------
// Currency section visibility behavior (MINCRM-564)
// Replaces getAdminSettingsCurrencySectionLocator
// ---------------------------------------------------------------------------

/** Asserts that the currency section is visible. */
export async function expectAdminSettingsCurrencySectionVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).currencySectionLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

// ---------------------------------------------------------------------------
// Feature flag scheduled enable_at behaviors (MINCRM-488)
// ---------------------------------------------------------------------------

/** Asserts that the Scheduled badge is visible for the given flag key. */
export async function expectFeatureFlagScheduledBadgeVisible(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `feature-flag-badge-scheduled-${flagKey}` },
        {
          type: 'css',
          value: `[data-testid="feature-flag-row-${flagKey}"] span:has-text("Scheduled")`,
        },
      ],
      { intent: `Scheduled badge displayed when ${flagKey} has a future enable_at date` },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/** Asserts that the Off badge is NOT visible for the given flag key. */
export async function expectFeatureFlagOffBadgeNotVisible(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // The Off badge is conditionally rendered — when a flag is scheduled it is removed
  // from the DOM entirely. isNotVisible() handles both "absent" and "hidden". (MINCRM-488)
  const notVisible = await context.page.isNotVisible([
    { type: 'testId', value: `feature-flag-badge-off-${flagKey}` },
  ]);
  expect(notVisible).toBe(true);
}

/** Clicks the Clear schedule button for the given flag key. */
export async function clickFeatureFlagClearSchedule(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `feature-flag-enable-at-clear-${flagKey}` },
        { type: 'role', value: 'button', options: { name: /clear schedule/i } },
      ],
      { intent: `Clear schedule button to remove the enable_at date for ${flagKey}` },
    )
    .resolve();
  await locator.click();
}

/** Asserts that the Scheduled badge is NOT visible for the given flag key. */
export async function expectFeatureFlagScheduledBadgeNotVisible(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // The Scheduled badge is conditionally rendered — after clearing enable_at it is
  // removed from the DOM entirely. isNotVisible() handles both "absent" and "hidden". (MINCRM-488)
  const notVisible = await context.page.isNotVisible(
    [{ type: 'testId', value: `feature-flag-badge-scheduled-${flagKey}` }],
    timeout,
  );
  expect(notVisible).toBe(true);
}

// ---------------------------------------------------------------------------
// Feature flag advanced panel behaviors (MINCRM-490, MINCRM-492)
// ---------------------------------------------------------------------------

/**
 * Expands the advanced settings panel (rollout, beta users, user overrides) for a flag.
 * All three sub-panels are hidden behind this single toggle; call before any
 * expectBetaUserRow*, expectOverrideRow*, or rollout-stage assertions. (MINCRM-490, MINCRM-492)
 */
export async function expandAdvancedPanel(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `feature-flag-advanced-toggle-${flagKey}` },
        {
          type: 'css',
          value: `[data-testid="feature-flag-row-${flagKey}"] [data-testid^="feature-flag-advanced-toggle-"]`,
        },
      ],
      { intent: `expand advanced settings panel for the ${flagKey} feature flag` },
    )
    .resolve();
  await locator.click();
}

// Feature flag beta user behaviors (MINCRM-489)
// ---------------------------------------------------------------------------

/**
 * Expands the collapsed beta users panel for the given flag key.
 * When beta_user_count > 0 the panel is hidden behind a "N beta users" button.
 * This click reveals it; call before any expectBetaUserRow* assertion. (MINCRM-489)
 */
export async function expandBetaUsersPanel(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `feature-flag-beta-expand-${flagKey}` },
        {
          type: 'css',
          value: `[data-testid="feature-flag-row-${flagKey}"] [data-testid^="feature-flag-beta-count-"]`,
        },
      ],
      { intent: `expand beta users panel for the ${flagKey} feature flag` },
    )
    .resolve();
  await locator.click();
}

/** Asserts the beta users panel is visible for the given flag key. */
export async function expectFeatureFlagBetaPanelVisible(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `feature-flag-beta-panel-${flagKey}` },
        {
          type: 'css',
          value: `[data-testid="feature-flag-row-${flagKey}"] [data-testid^="beta-user-search-"]`,
        },
      ],
      { intent: `beta users panel for the ${flagKey} feature flag` },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/** Asserts the beta user row is visible for the given flag key and user ID. */
export async function expectBetaUserRowVisible(
  flagKey: string,
  userId: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `beta-user-row-${flagKey}-${userId}` },
        {
          type: 'css',
          value: `[data-testid="feature-flag-beta-panel-${flagKey}"] li[data-testid*="${userId}"]`,
        },
      ],
      { intent: `enrolled beta user row for user ${userId} on ${flagKey} flag` },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/** Asserts the beta user row is NOT visible for the given flag key and user ID. */
export async function expectBetaUserRowNotVisible(
  flagKey: string,
  userId: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // Beta user rows are conditionally rendered — after removing enrollment the row is
  // unmounted. isNotVisible() handles both "absent from DOM" and "hidden". (MINCRM-489)
  const notVisible = await context.page.isNotVisible(
    [{ type: 'testId', value: `beta-user-row-${flagKey}-${userId}` }],
    timeout,
  );
  expect(notVisible).toBe(true);
}

// ---------------------------------------------------------------------------
// Feature flag rollout behaviors (MINCRM-490)
// ---------------------------------------------------------------------------

/**
 * Asserts the rollout percentage badge is visible for the given flag key.
 * The badge only renders when rollout_percentage is non-null.
 */
export async function expectRolloutPercentageBadgeVisible(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `rollout-percentage-badge-${flagKey}` },
        {
          type: 'css',
          value: `[data-testid="feature-flag-row-${flagKey}"] [data-testid^="rollout-percentage-badge-"]`,
        },
      ],
      { intent: `rollout percentage badge for the ${flagKey} feature flag` },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Asserts the rollout percentage badge is NOT visible for the given flag key.
 * This is the case when rollout_percentage is null.
 */
export async function expectRolloutPercentageBadgeNotVisible(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const notVisible = await context.page.isNotVisible(
    [{ type: 'testId', value: `rollout-percentage-badge-${flagKey}` }],
    timeout,
  );
  expect(notVisible).toBe(true);
}

/**
 * Sets the rollout percentage input to the given value for a flag row.
 * The input is only rendered when the flag is enabled.
 */
export async function setRolloutPercentageInput(
  flagKey: string,
  percentage: number | null,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `rollout-percentage-input-${flagKey}` },
        {
          type: 'css',
          value: `[data-testid="feature-flag-row-${flagKey}"] input[type="number"]`,
        },
      ],
      { intent: `rollout percentage number input for the ${flagKey} feature flag` },
    )
    .resolve();
  await locator.fill(percentage === null ? '' : String(percentage));
}

// ---------------------------------------------------------------------------
// Feature flag user overrides behaviors (MINCRM-492)
// ---------------------------------------------------------------------------

/**
 * Asserts the override count badge (force_enabled or force_disabled) is visible.
 * Badges only render when the count is > 0.
 */
export async function expectOverrideCountBadgeVisible(
  flagKey: string,
  direction: 'force_enabled' | 'force_disabled',
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `override-count-${direction}-${flagKey}` },
        {
          type: 'css',
          value: `[data-testid="feature-flag-row-${flagKey}"] [data-testid^="override-count-${direction}-"]`,
        },
      ],
      { intent: `${direction} override count badge for the ${flagKey} feature flag` },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Asserts the override count badge is NOT visible for the given flag and direction.
 */
export async function expectOverrideCountBadgeNotVisible(
  flagKey: string,
  direction: 'force_enabled' | 'force_disabled',
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const notVisible = await context.page.isNotVisible(
    [{ type: 'testId', value: `override-count-${direction}-${flagKey}` }],
    timeout,
  );
  expect(notVisible).toBe(true);
}

/**
 * Asserts the user overrides panel is visible for the given flag key.
 * The panel is always rendered (not behind a toggle).
 */
export async function expectOverridesPanelVisible(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `feature-flag-overrides-panel-${flagKey}` },
        {
          type: 'css',
          value: `[data-testid="feature-flag-row-${flagKey}"] [data-testid^="feature-flag-overrides-panel-"]`,
        },
      ],
      { intent: `user overrides panel for the ${flagKey} feature flag` },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Asserts an override row is visible in the overrides panel for a given user.
 */
export async function expectOverrideRowVisible(
  flagKey: string,
  userId: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `override-row-${flagKey}-${userId}` },
        {
          type: 'css',
          value: `[data-testid="feature-flag-overrides-panel-${flagKey}"] [data-testid*="${userId}"]`,
        },
      ],
      { intent: `override row for user ${userId} on the ${flagKey} feature flag` },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Asserts an override row is NOT visible in the overrides panel for a given user.
 */
export async function expectOverrideRowNotVisible(
  flagKey: string,
  userId: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const notVisible = await context.page.isNotVisible(
    [{ type: 'testId', value: `override-row-${flagKey}-${userId}` }],
    timeout,
  );
  expect(notVisible).toBe(true);
}

/**
 * Clicks the remove button for an override row.
 */
export async function clickOverrideRemove(
  flagKey: string,
  userId: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `override-remove-${flagKey}-${userId}` },
        {
          type: 'css',
          value: `[data-testid="override-row-${flagKey}-${userId}"] button`,
        },
      ],
      { intent: `remove override button for user ${userId} on ${flagKey} flag` },
    )
    .resolve();
  await locator.click();
}

// ---------------------------------------------------------------------------
// Flag group UI behaviors (MINCRM-491)
// ---------------------------------------------------------------------------

/**
 * Asserts the flag groups section is visible on the admin feature flags page.
 */
export async function expectFlagGroupsSectionVisible(
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'flag-groups-section' },
        { type: 'role', value: 'region' },
      ],
      { intent: 'flag groups management section on the feature flags admin page' },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Asserts a group row with the given group_key is visible.
 */
export async function expectFlagGroupRowVisible(
  groupKey: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `flag-group-row-${groupKey}` },
        {
          type: 'css',
          value: `[data-testid="flag-groups-section"] [data-testid="flag-group-row-${groupKey}"]`,
        },
      ],
      { intent: `group row for group key ${groupKey} in the flag groups section` },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Asserts a group row is NOT visible (either absent or hidden).
 */
export async function expectFlagGroupRowNotVisible(
  groupKey: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const notVisible = await context.page.isNotVisible(
    [{ type: 'testId', value: `flag-group-row-${groupKey}` }],
    timeout,
  );
  expect(notVisible).toBe(true);
}

/**
 * Clicks the group toggle switch to enable or disable a group.
 */
export async function clickFlagGroupToggle(
  groupKey: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `flag-group-toggle-${groupKey}` },
        {
          type: 'css',
          value: `[data-testid="flag-group-row-${groupKey}"] input[type="checkbox"]`,
        },
      ],
      { intent: `enabled/disabled toggle for flag group ${groupKey}` },
    )
    .resolve();
  await locator.click();
}

/**
 * Asserts that a role override checkbox is visible in the role override panel for the
 * given flag key and role name. Used to verify that dynamically loaded roles (built-in
 * or custom) appear in the panel. (MINCRM-565)
 */
export async function expectRoleOverrideCheckboxVisible(
  flagKey: string,
  roleName: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `feature-flag-role-override-${flagKey}-${roleName}` },
        {
          type: 'css',
          value: `[data-testid="feature-flag-role-overrides-${flagKey}"] input[data-testid*="${roleName}"]`,
        },
      ],
      { intent: `role override checkbox for role '${roleName}' on flag '${flagKey}'` },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

// ---------------------------------------------------------------------------
// Flag group delete dialog behaviors (MINCRM-567)
// ---------------------------------------------------------------------------

/**
 * Expands the detail panel of a flag group row, then clicks its delete button.
 * The delete button is only visible when the group's detail panel is expanded.
 */
export async function clickFlagGroupDeleteButton(
  groupKey: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');

  // The detail expand/collapse toggle reveals the delete button. Only click it if the
  // panel is not already expanded — a second call after cancel must not re-collapse it.
  const expandToggle = await context.page
    .locate(
      [
        { type: 'testId', value: `group-detail-toggle-${groupKey}` },
        { type: 'css', value: `[data-testid="group-detail-toggle-${groupKey}"]` },
      ],
      { intent: `expand/collapse toggle for flag group ${groupKey} detail panel` },
    )
    .resolve();
  const isExpanded = (await expandToggle.getAttribute('aria-expanded')) === 'true';
  if (!isExpanded) {
    await expandToggle.click();
  }

  // Wait for the delete button to appear before resolving — it only renders when expanded.
  const deleteBtn = await context.page
    .locate(
      [
        { type: 'testId', value: `group-delete-${groupKey}` },
        { type: 'css', value: `[data-testid="group-delete-${groupKey}"]` },
      ],
      { intent: `delete button for flag group ${groupKey}` },
    )
    .resolve();
  await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
  await deleteBtn.click();
}

/**
 * Asserts the delete-group confirmation dialog is visible.
 */
export async function expectDeleteGroupDialogVisible(
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'delete-group-confirm-dialog' },
        { type: 'role', value: 'dialog' },
      ],
      {
        intent: 'confirmation dialog warning that member flags will be unassigned on group delete',
      },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Clicks the confirm button on the delete-group dialog.
 */
export async function clickDeleteGroupDialogConfirm(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'delete-group-confirm-ok' },
        {
          type: 'css',
          value:
            '[data-testid="delete-group-confirm-dialog"] button[data-testid="delete-group-confirm-ok"]',
        },
      ],
      { intent: 'confirm button on the delete-group warning dialog' },
    )
    .resolve();
  await locator.click();
}

/**
 * Clicks the cancel button on the delete-group dialog.
 */
export async function clickDeleteGroupDialogCancel(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'delete-group-confirm-cancel' },
        {
          type: 'css',
          value:
            '[data-testid="delete-group-confirm-dialog"] button[data-testid="delete-group-confirm-cancel"]',
        },
      ],
      { intent: 'cancel button on the delete-group warning dialog' },
    )
    .resolve();
  await locator.click();
}

/**
 * Asserts the delete-group confirmation dialog is no longer visible (absent or hidden).
 */
export async function expectDeleteGroupDialogNotVisible(
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const notVisible = await context.page.isNotVisible(
    [
      { type: 'testId', value: 'delete-group-confirm-dialog' },
      { type: 'role', value: 'dialog' },
    ],
    timeout,
  );
  if (!notVisible) {
    throw new Error('Expected delete-group dialog to be absent or hidden, but it is still visible');
  }
}

// ---------------------------------------------------------------------------
// Admin settings panel disabled-banner behaviors (MINCRM-566)
// ---------------------------------------------------------------------------

/**
 * Asserts the "feature disabled" banner is visible inside an admin settings section.
 * The testId corresponds to the data-testid attribute on the banner element.
 */
export async function expectAdminSettingsSectionDisabledBanner(
  bannerTestId: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: bannerTestId },
        { type: 'css', value: `[data-testid="${bannerTestId}"]` },
      ],
      {
        intent: `feature-disabled banner with testId "${bannerTestId}" in an admin settings panel`,
      },
    )
    .resolve();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Asserts the "feature disabled" banner is NOT visible in an admin settings section.
 */
export async function expectAdminSettingsSectionDisabledBannerAbsent(
  bannerTestId: string,
  context: AdminSettingsBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  const notVisible = await context.page.isNotVisible(
    [{ type: 'testId', value: bannerTestId }],
    timeout,
  );
  const { expect } = await import('@playwright/test');
  expect(notVisible).toBe(true);
}

// ---------------------------------------------------------------------------
// AI session retention behaviors (MINCRM-447)
// ---------------------------------------------------------------------------

/**
 * Returns the AI session retention days input locator from the AI settings tab.
 * Callers must have already navigated to the AI settings tab.
 */
export async function getAiSessionRetentionDaysInput(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiSessionRetentionDaysInputLocator();
}

/** Fills the AI session retention days input with the given value. */
export async function fillAiSessionRetentionDays(
  days: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await new AdminSettingsPage(context).fillAiSessionRetentionDays(days);
}

/** Clicks the AI session retention save button. */
export async function clickAiSessionRetentionSave(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await new AdminSettingsPage(context).clickAiSessionRetentionSave();
}

/**
 * Returns the AI session retention validation error locator.
 * Present only when client-side validation fails.
 */
export async function getAiSessionRetentionValidationError(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiSessionRetentionValidationErrorLocator();
}

/**
 * Returns the AI session retention save-success indicator locator.
 * Present only immediately after a successful save.
 */
export async function getAiSessionRetentionSaveSuccess(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiSessionRetentionSaveSuccessLocator();
}

// ---------------------------------------------------------------------------
// AI retention stats + manual purge behaviors (MINCRM-462)
// ---------------------------------------------------------------------------

/** Returns the AI retention stats summary locator (session/message counts). */
export async function getAiRetentionStats(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiRetentionStatsLocator();
}

/** Clicks "Purge now", opening the manual purge confirmation dialog. */
export async function clickAiPurgeNow(context: AdminSettingsBehaviorContext): Promise<void> {
  await new AdminSettingsPage(context).clickAiPurgeNow();
}

/** Confirms the manual purge in the confirmation dialog. */
export async function clickAiPurgeConfirm(context: AdminSettingsBehaviorContext): Promise<void> {
  await new AdminSettingsPage(context).clickAiPurgeConfirm();
}

/** Returns the manual purge "accepted" confirmation message locator. */
export async function getAiPurgeAccepted(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiPurgeAcceptedLocator();
}

// ---------------------------------------------------------------------------
// AI data minimization / field exclusion behaviors (MINCRM-461)
// ---------------------------------------------------------------------------

/** Returns the always-excluded fields list container locator. */
export async function getAiAlwaysExcludedFields(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiAlwaysExcludedFieldsLocator();
}

/** Clicks the standard-field exclusion toggle for the given entity type and field name. */
export async function clickAiFieldExclusionToggle(
  entityType: string,
  fieldName: string,
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await new AdminSettingsPage(context).clickAiFieldExclusionToggle(entityType, fieldName);
}

/** Returns the standard-field exclusion toggle locator for the given entity type and field name. */
export async function getAiFieldExclusionToggle(
  entityType: string,
  fieldName: string,
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).aiFieldExclusionToggleLocator(entityType, fieldName);
}

/**
 * Clicks the data hygiene sub-section's manual "run now" button and waits for
 * the underlying POST /api/v1/admin/ai/data-hygiene/run response, returning
 * its status so the spec can assert a real scan was triggered. (MINCRM-476)
 */
export async function clickDataHygieneRunNowAndAwaitResponse(
  context: AdminSettingsBehaviorContext,
): Promise<{ status: number }> {
  const responsePromise = context.page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/admin/ai/data-hygiene/run') &&
      response.request().method() === 'POST',
  );
  await new AdminSettingsPage(context).clickDataHygieneRunNowButton();
  const response = await responsePromise;
  return { status: response.status() };
}

/** Asserts that the data hygiene "run accepted" confirmation message is visible. (MINCRM-476) */
export async function expectDataHygieneRunAcceptedVisible(
  context: AdminSettingsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new AdminSettingsPage(context).dataHygieneRunAcceptedLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}
