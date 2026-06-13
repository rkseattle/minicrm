/**
 * Settings behaviors for MiniCRM — system-wide defaults enforcement and
 * AdminSettings page locator-accessor wrappers (MINCRM-358, MINCRM-367).
 */

import type { RestClient } from '@framework/clients/rest-client.js';
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
 * Navigates to the Admin Settings page, optionally deep-linking to a tab.
 */
export async function navigateToAdminSettings(
  context: AdminSettingsBehaviorContext,
  tab?: AdminSettingsTab,
): Promise<void> {
  const adminSettings = new AdminSettingsPage(context);
  await adminSettings.navigate(tab);
}

// ---------------------------------------------------------------------------
// Locator-accessor behaviors — wrap AdminSettingsPage locators
// so spec files never import @pages/* directly. (MINCRM-367)
// ---------------------------------------------------------------------------

/** Returns a resolved locator for the admin settings page heading. */
export async function getAdminSettingsHeadingLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).settingsHeadingLocator();
}

/** Returns a resolved locator for the settings save button (general tab). */
export async function getAdminSettingsSaveLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).settingsSaveLocator();
}

/** Returns a resolved locator for the currency section. */
export async function getAdminSettingsCurrencySectionLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).currencySectionLocator();
}

/** Returns a resolved locator for the email notifications section. */
export async function getAdminSettingsEmailNotificationsSectionLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).emailNotificationsSectionLocator();
}

/** Returns a resolved locator for the webhook settings section. */
export async function getAdminSettingsWebhookSectionLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).webhookSectionLocator();
}

/** Returns a resolved locator for the webhook URL input. */
export async function getAdminSettingsWebhookUrlInputLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).webhookUrlInputLocator();
}

/** Returns a resolved locator for the webhook secret reveal modal. */
export async function getAdminSettingsWebhookSecretRevealLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).webhookSecretRevealLocator();
}

/** Returns a resolved locator for the webhook secret value input. */
export async function getAdminSettingsWebhookSecretValueLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).webhookSecretValueLocator();
}

/** Returns a resolved locator for a webhook subscription row by ID. */
export async function getAdminSettingsWebhookRowLocator(
  subscriptionId: string,
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).webhookRowLocator(subscriptionId);
}

/** Returns a resolved locator for the webhook delete confirmation dialog. */
export async function getAdminSettingsWebhookDeleteConfirmLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).webhookDeleteConfirmLocator();
}

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

/** Returns a resolved locator for the exchange rates section. */
export async function getAdminSettingsExchangeRatesSectionLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).exchangeRatesSectionLocator();
}

/** Returns a resolved locator for the home currency select. */
export async function getAdminSettingsHomeCurrencySelectLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).homeCurrencySelectLocator();
}

/** Returns a resolved locator for the add-currency form. */
export async function getAdminSettingsAddCurrencyFormLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).addCurrencyFormLocator();
}

/** Returns a resolved locator for the currency code select. */
export async function getAdminSettingsAddCurrencyCodeSelectLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).addCurrencyCodeSelectLocator();
}

/** Returns a resolved locator for the exchange rate input. */
export async function getAdminSettingsAddCurrencyRateInputLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).addCurrencyRateInputLocator();
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

/** Returns a resolved locator for the exchange rate save success message. */
export async function getAdminSettingsExchangeRateSaveSuccessLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).exchangeRateSaveSuccessLocator();
}

/** Returns a resolved locator for an exchange rate row by currency code. */
export async function getAdminSettingsExchangeRateRowLocator(
  currencyCode: string,
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).exchangeRateRowLocator(currencyCode);
}

/** Returns a resolved locator for the custom fields section. */
export async function getAdminSettingsCustomFieldsSectionLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).customFieldsSectionLocator();
}

/** Returns a resolved locator for the custom fields entity select. */
export async function getAdminSettingsCustomFieldsEntitySelectLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).customFieldsEntitySelectLocator();
}

/** Returns a resolved locator for the add-field inline form. */
export async function getAdminSettingsAddFieldFormLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).addFieldFormLocator();
}

/** Returns a resolved locator for the field name input. */
export async function getAdminSettingsAddFieldNameInputLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).addFieldNameInputLocator();
}

/** Returns a resolved locator for the custom fields feedback message. */
export async function getAdminSettingsCustomFieldsFeedbackLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).customFieldsFeedbackLocator();
}

/** Returns a resolved locator for the confirm-delete-field button. */
export async function getAdminSettingsDeleteFieldConfirmLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).deleteFieldConfirmLocator();
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

/** Returns a resolved locator for the branding form. */
export async function getAdminSettingsBrandingFormLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).brandingFormLocator();
}

/** Returns a resolved locator for the branding company name input. */
export async function getAdminSettingsBrandingCompanyNameLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).brandingCompanyNameLocator();
}

/** Returns a resolved locator for the branding primary colour text input. */
export async function getAdminSettingsBrandingColorTextLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).brandingColorTextLocator();
}

/** Returns a resolved locator for the branding font select. */
export async function getAdminSettingsBrandingFontSelectLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).brandingFontSelectLocator();
}

/** Returns a resolved locator for the branding Save button. */
export async function getAdminSettingsBrandingSaveLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).brandingSaveLocator();
}

/** Returns a resolved locator for the branding save success message. */
export async function getAdminSettingsBrandingSaveSuccessLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).brandingSaveSuccessLocator();
}

/** Returns a resolved locator for the branding reset button. */
export async function getAdminSettingsBrandingResetButtonLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).brandingResetButtonLocator();
}

/** Returns a resolved locator for the branding reset confirm button. */
export async function getAdminSettingsBrandingResetConfirmLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).brandingResetConfirmLocator();
}

/** Returns a resolved locator for the branding reset success message. */
export async function getAdminSettingsBrandingResetSuccessLocator(
  context: AdminSettingsBehaviorContext,
) {
  return new AdminSettingsPage(context).brandingResetSuccessLocator();
}

// ---------------------------------------------------------------------------
// Pipeline stages — customisation tab (MINCRM-381)
// ---------------------------------------------------------------------------

/** Returns a resolved locator for the pipeline stages table. */
export async function getPipelineStagesTableLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).pipelineStagesTableLocator();
}

/**
 * Returns a resolved locator for the move-up button of a stage row.
 *
 * @param context - Behavior context containing page.
 * @param stageId - UUID of the pipeline stage.
 */
export async function getPipelineStageMoveUpLocator(
  context: AdminSettingsBehaviorContext,
  stageId: string,
) {
  return new AdminSettingsPage(context).pipelineStageMoveUpLocator(stageId);
}

/**
 * Returns a resolved locator for the move-down button of a stage row.
 *
 * @param context - Behavior context containing page.
 * @param stageId - UUID of the pipeline stage.
 */
export async function getPipelineStageMoveDownLocator(
  context: AdminSettingsBehaviorContext,
  stageId: string,
) {
  return new AdminSettingsPage(context).pipelineStageMoveDownLocator(stageId);
}

/** Returns a resolved locator for the pipeline stages feedback status message. */
export async function getPipelineStagesFeedbackLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).pipelineStagesFeedbackLocator();
}

// ---------------------------------------------------------------------------
// SSO configuration (MINCRM-399)
// ---------------------------------------------------------------------------

/** Returns a resolved locator for the SSO section panel. */
export async function getSsoSectionLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).ssoSectionLocator();
}

/** Returns a resolved locator for the SSO protocol selector. */
export async function getSsoProtocolSelectLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).ssoProtocolSelectLocator();
}

/** Returns a resolved locator for the SSO IdP metadata URL input. */
export async function getSsoIdpMetadataUrlInputLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).ssoIdpMetadataUrlInputLocator();
}

/** Returns a resolved locator for the SSO entity ID input. */
export async function getSsoEntityIdInputLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).ssoEntityIdInputLocator();
}

/** Returns a resolved locator for the SSO save button. */
export async function getSsoSaveButtonLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).ssoSaveButtonLocator();
}

/** Returns a resolved locator for the SSO enabled badge (shown when configured). */
export async function getSsoEnabledBadgeLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).ssoEnabledBadgeLocator();
}

/** Returns a resolved locator for the SSO disable button. */
export async function getSsoDisableButtonLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).ssoDisableButtonLocator();
}

/** Returns a resolved locator for the SSO disable confirm button. */
export async function getSsoDisableConfirmButtonLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).ssoDisableConfirmButtonLocator();
}

/** Returns a resolved locator for the SSO save success message. */
export async function getSsoSaveSuccessLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).ssoSaveSuccessLocator();
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
  await context.page.goto(url, { waitUntil: 'networkidle' });
}

/**
 * Navigates directly to the Admin Settings customisation tab (shorthand).
 */
export async function navigateToAdminSettingsCustomisation(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await context.page.goto('/admin/settings?tab=customisation', { waitUntil: 'networkidle' });
}

/**
 * Navigates directly to the Admin Settings general tab (shorthand).
 */
export async function navigateToAdminSettingsGeneral(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await context.page.goto('/admin/settings?tab=general', { waitUntil: 'networkidle' });
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
  const moveUpButton = await getPipelineStageMoveUpLocator(context, stageId);
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
  const moveDownButton = await getPipelineStageMoveDownLocator(context, stageId);
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
  await context.page.waitFor(
    [
      { type: 'testId', value: 'delete-stage-confirm-dialog' },
      { type: 'role', value: 'dialog', options: { name: /delete/i } },
    ],
    state,
    { intent: 'confirmation dialog for deleting a pipeline stage' },
    timeout,
  );
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
  ]);
}

// ---------------------------------------------------------------------------
// SSO login page helpers — keep page.goto/locate/reload out of spec files.
// (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Navigates to the login page and waits for network idle.
 * Used by SSO tests that need to verify the login page as an unauthenticated user.
 */
export async function navigateToLoginPageForSso(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await context.page.goto('/login', { waitUntil: 'networkidle' });
}

/**
 * Resolves the SSO login button locator on the login page.
 */
export async function getSsoLoginButtonLocator(context: AdminSettingsBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'sso-login-button' },
        { type: 'role', value: 'link', options: { name: /sign in with/i } },
      ],
      {
        intent: 'SSO login button on the login page',
        // The login page fetches SSO status asynchronously after load; allow extra
        // probe time for the button to appear after the status request settles.
        fallbackTimeout: 8_000,
      },
    )
    .resolve();
}

// ---------------------------------------------------------------------------
// Webhooks navigation helpers — keep page.goto out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Navigates to the admin settings integrations tab and waits for network idle.
 */
export async function navigateToAdminSettingsIntegrations(
  context: AdminSettingsBehaviorContext,
): Promise<void> {
  await context.page.goto('/admin/settings?tab=integrations', { waitUntil: 'networkidle' });
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
  await context.page.goto('/admin/settings?tab=currency', { waitUntil: 'networkidle' });
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

/**
 * Resolves the Add Pipeline button.
 */
export async function getPipelineAddButtonLocator(context: AdminSettingsBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'add-pipeline-button' },
        { type: 'role', value: 'button', options: { name: /new pipeline/i } },
      ],
      { intent: 'button to open the new pipeline form' },
    )
    .resolve();
}

/**
 * Resolves the new-pipeline name input.
 */
export async function getNewPipelineNameInputLocator(context: AdminSettingsBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'new-pipeline-name-input' },
        { type: 'role', value: 'textbox' },
      ],
      { intent: 'input field for the new pipeline name' },
    )
    .resolve();
}

/**
 * Resolves the create-pipeline submit button.
 */
export async function getCreatePipelineSubmitLocator(context: AdminSettingsBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'create-pipeline-submit-button' },
        { type: 'role', value: 'button', options: { name: /save/i } },
      ],
      { intent: 'submit button to create the new pipeline' },
    )
    .resolve();
}

/**
 * Resolves the pipelines feedback status message.
 */
export async function getPipelinesFeedbackLocator(context: AdminSettingsBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'pipelines-feedback' },
        { type: 'role', value: 'status' },
      ],
      { intent: 'success feedback message after a pipeline operation' },
    )
    .resolve();
}

/**
 * Resolves the edit button for a specific pipeline row.
 */
export async function getPipelineEditButtonLocator(
  pipelineId: string,
  context: AdminSettingsBehaviorContext,
) {
  return context.page
    .locate(
      [
        { type: 'testId', value: `pipeline-edit-button-${pipelineId}` },
        { type: 'role', value: 'button', options: { name: /edit/i } },
      ],
      { intent: 'edit button for the pipeline row to rename' },
    )
    .resolve();
}

/**
 * Resolves the edit input for a specific pipeline row.
 */
export async function getPipelineEditInputLocator(
  pipelineId: string,
  context: AdminSettingsBehaviorContext,
) {
  return context.page
    .locate(
      [
        { type: 'testId', value: `pipeline-edit-input-${pipelineId}` },
        { type: 'role', value: 'textbox' },
      ],
      { intent: 'text input for renaming the pipeline' },
    )
    .resolve();
}

/**
 * Resolves the save button for a specific pipeline row.
 */
export async function getPipelineSaveButtonLocator(
  pipelineId: string,
  context: AdminSettingsBehaviorContext,
) {
  return context.page
    .locate(
      [
        { type: 'testId', value: `pipeline-save-button-${pipelineId}` },
        { type: 'role', value: 'button', options: { name: /save/i } },
      ],
      { intent: 'save button to confirm pipeline rename' },
    )
    .resolve();
}

/**
 * Resolves the delete button for a specific pipeline row.
 */
export async function getPipelineDeleteButtonLocator(
  pipelineId: string,
  context: AdminSettingsBehaviorContext,
) {
  return context.page
    .locate(
      [
        { type: 'testId', value: `pipeline-delete-button-${pipelineId}` },
        { type: 'role', value: 'button', options: { name: /delete/i } },
      ],
      { intent: 'delete button for the pipeline row to remove' },
    )
    .resolve();
}

/**
 * Resolves the delete confirmation panel.
 * eslint-disable-next-line local/require-locator-fallback -- static container div; no stable role alternative
 */
export async function getPipelineDeleteConfirmLocator(context: AdminSettingsBehaviorContext) {
  // eslint-disable-next-line local/require-locator-fallback -- static container div; no stable role alternative
  return context.page
    .locate([{ type: 'testId', value: 'pipeline-delete-confirm' }], {
      intent: 'delete confirmation panel for the pipeline',
    })
    .resolve();
}

/**
 * Resolves the confirm-delete button inside the confirmation panel.
 */
export async function getPipelineDeleteConfirmButtonLocator(context: AdminSettingsBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'pipeline-delete-confirm-button' },
        { type: 'role', value: 'button', options: { name: /delete/i } },
      ],
      { intent: 'confirm button to execute pipeline deletion' },
    )
    .resolve();
}

/**
 * Resolves the pipeline stages pipeline selector dropdown.
 */
export async function getPipelineStagesPipelineSelectorLocator(
  context: AdminSettingsBehaviorContext,
) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'pipeline-stages-pipeline-selector' },
        { type: 'role', value: 'combobox' },
      ],
      { intent: 'dropdown to select which pipeline to manage stages for' },
    )
    .resolve();
}

/**
 * Resolves the pipeline selector on the deals board.
 */
export async function getPipelineBoardSelectorLocator(context: AdminSettingsBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'pipeline-selector' },
        { type: 'role', value: 'combobox' },
      ],
      { intent: 'pipeline selector dropdown above the deals board' },
    )
    .resolve();
}

/**
 * Resolves the pipeline board container.
 * eslint-disable-next-line local/require-locator-fallback -- board container div; no stable role alternative
 */
export async function getPipelineBoardContainerLocator(context: AdminSettingsBehaviorContext) {
  // eslint-disable-next-line local/require-locator-fallback -- board container div; no stable role alternative
  return context.page
    .locate([{ type: 'testId', value: 'pipeline-board' }], {
      intent: 'the main pipeline kanban board container',
    })
    .resolve();
}

/**
 * Resolves the pipeline stage row for a specific stage.
 */
export async function getPipelineStageRowLocator(
  stageId: string,
  context: AdminSettingsBehaviorContext,
) {
  return context.page
    .locate(
      [
        { type: 'testId', value: `pipeline-stage-row-${stageId}` },
        { type: 'text', value: 'Custom Stage One' },
      ],
      { intent: 'row for the custom stage in the pipeline stages table' },
    )
    .resolve();
}

/**
 * Resolves the inline edit button for a pipeline stage row.
 * eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
 */
export async function getPipelineStageEditButtonLocator(
  stageId: string,
  context: AdminSettingsBehaviorContext,
) {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
  return context.page
    .locate([{ type: 'testId', value: `pipeline-stage-edit-${stageId}` }])
    .resolve();
}

/**
 * Resolves the inline save button for a pipeline stage row.
 * eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
 */
export async function getPipelineStageSaveButtonLocator(
  stageId: string,
  context: AdminSettingsBehaviorContext,
) {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
  return context.page
    .locate([{ type: 'testId', value: `pipeline-stage-save-${stageId}` }])
    .resolve();
}

/**
 * Resolves the inline delete button for a pipeline stage row.
 * eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
 */
export async function getPipelineStageDeleteButtonLocator(
  stageId: string,
  context: AdminSettingsBehaviorContext,
) {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
  return context.page
    .locate([{ type: 'testId', value: `pipeline-stage-delete-${stageId}` }])
    .resolve();
}

// ---------------------------------------------------------------------------
// Stage exit requirements UI behaviors (MINCRM-527)
// ---------------------------------------------------------------------------

/**
 * Resolves the input for the required_fields of a pipeline stage's exit requirements.
 * @param stageId - UUID of the pipeline stage.
 */
export async function getPipelineStageExitRequiredInputLocator(
  stageId: string,
  context: AdminSettingsBehaviorContext,
) {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
  return context.page
    .locate([{ type: 'testId', value: `pipeline-stage-exit-required-${stageId}` }])
    .resolve();
}

/**
 * Resolves the input for the warning_fields of a pipeline stage's exit requirements.
 * @param stageId - UUID of the pipeline stage.
 */
export async function getPipelineStageExitWarningInputLocator(
  stageId: string,
  context: AdminSettingsBehaviorContext,
) {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
  return context.page
    .locate([{ type: 'testId', value: `pipeline-stage-exit-warning-${stageId}` }])
    .resolve();
}

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

/** Resolves the feature flags list container. */
export async function getFeatureFlagsListLocator(context: AdminSettingsBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'feature-flags-list' },
        { type: 'role', value: 'region' },
      ],
      { intent: 'container showing the grouped list of feature flags' },
    )
    .resolve();
}

/**
 * Resolves the toggle button for a specific feature flag row.
 * @param flagKey - The flag_key identifier (e.g. 'notes', 'tags').
 */
export async function getFeatureFlagToggleLocator(
  flagKey: string,
  context: AdminSettingsBehaviorContext,
) {
  return context.page
    .locate(
      [
        { type: 'testId', value: `feature-flag-toggle-${flagKey}` },
        { type: 'role', value: 'switch', options: { name: new RegExp(flagKey, 'i') } },
      ],
      { intent: `toggle switch to enable or disable the ${flagKey} feature flag` },
    )
    .resolve();
}

/** Resolves the confirmation dialog for a feature flag toggle. */
export async function getFeatureFlagConfirmDialogLocator(context: AdminSettingsBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'feature-flag-confirm-dialog' },
        { type: 'role', value: 'dialog' },
      ],
      { intent: 'confirmation dialog shown before toggling a feature flag' },
    )
    .resolve();
}

/** Resolves the confirm OK button inside the feature flag confirmation dialog. */
export async function getFeatureFlagConfirmOkLocator(context: AdminSettingsBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'feature-flag-confirm-ok' },
        { type: 'role', value: 'button', options: { name: /confirm/i } },
      ],
      { intent: 'confirm button inside the feature flag toggle confirmation dialog' },
    )
    .resolve();
}

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
        model: 'claude-sonnet-4-20250514',
        deployment_mode: 'cloud_api',
        base_url: '',
        custom_dpa_url: '',
      })
      .catch(() => undefined),
  ]);
}

/** Resolves the AI settings panel locator. */
export async function getAiSettingsPanelLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiSettingsPanelLocator();
}

/** Resolves the AI master toggle locator. */
export async function getAiMasterToggleLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiMasterToggleLocator();
}

/** Resolves the AI toggle confirmation dialog locator. */
export async function getAiToggleConfirmDialogLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiToggleConfirmDialogLocator();
}

/** Resolves the Confirm button inside the AI toggle confirmation dialog. */
export async function getAiToggleConfirmButtonLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiToggleConfirmButtonLocator();
}

/** Resolves the Cancel button inside the AI toggle confirmation dialog. */
export async function getAiToggleCancelButtonLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiToggleCancelButtonLocator();
}

/** Resolves the AI DPA acknowledgment checkbox locator. */
export async function getAiDpaCheckboxLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiDpaCheckboxLocator();
}

/** Resolves the DPA warning banner locator. */
export async function getAiDpaWarningBannerLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiDpaWarningBannerLocator();
}

/** Resolves the AI data posture badge locator. */
export async function getAiDataPostureBadgeLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiDataPostureBadgeLocator();
}

/** Resolves the AI DPA status badge locator. */
export async function getAiDpaStatusBadgeLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiDpaStatusBadgeLocator();
}

/** Resolves the AI Save button locator. */
export async function getAiSaveButtonLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiSaveButtonLocator();
}

/** Resolves the AI Test Connection button locator. */
export async function getAiTestConnectionButtonLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiTestConnectionButtonLocator();
}

/** Resolves the AI test connection result message locator. */
export async function getAiTestConnectionResultLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiTestConnectionResultLocator();
}

/** Resolves the AI model select locator. */
export async function getAiModelSelectLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).aiModelSelectLocator();
}

// ---------------------------------------------------------------------------
// Visibility Settings behaviors (MINCRM-538)
// ---------------------------------------------------------------------------

/** Resolves the visibility settings panel locator. */
export async function getVisibilitySettingsPanelLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).visibilitySettingsPanelLocator();
}

/** Resolves the contacts visibility select locator. */
export async function getVisibilityContactsSelectLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).visibilityContactsSelectLocator();
}

/** Resolves the deals visibility select locator. */
export async function getVisibilityDealsSelectLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).visibilityDealsSelectLocator();
}

/** Resolves the visibility save button locator. */
export async function getVisibilitySaveButtonLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).visibilitySaveButtonLocator();
}

/** Resolves the visibility save success message locator. */
export async function getVisibilitySaveSuccessLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).visibilitySaveSuccessLocator();
}

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
    })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Roles tab — built-in role View button (MINCRM-547)
// ---------------------------------------------------------------------------

/** Returns a resolved locator for the View button on a built-in role card. */
export async function getRoleViewButtonLocator(
  context: AdminSettingsBehaviorContext,
  roleId: string,
) {
  return new AdminSettingsPage(context).roleViewButtonLocator(roleId);
}

/** Returns a resolved locator for the read-only capability panel of a built-in role. */
export async function getRoleCapabilityPanelLocator(
  context: AdminSettingsBehaviorContext,
  roleId: string,
) {
  return new AdminSettingsPage(context).roleCapabilityPanelLocator(roleId);
}

/** Returns a resolved locator for the read-only capability list inside an expanded panel. */
export async function getRoleCapabilityReadOnlyListLocator(context: AdminSettingsBehaviorContext) {
  return new AdminSettingsPage(context).roleCapabilityReadOnlyListLocator();
}

/**
 * Returns a resolved locator for a specific disabled capability checkbox in a built-in role panel.
 * @param capabilityKey - e.g. 'contacts:view'
 */
export async function getRoleReadOnlyCapabilityCheckboxLocator(
  context: AdminSettingsBehaviorContext,
  capabilityKey: string,
) {
  return new AdminSettingsPage(context).roleReadOnlyCapabilityCheckboxLocator(capabilityKey);
}
