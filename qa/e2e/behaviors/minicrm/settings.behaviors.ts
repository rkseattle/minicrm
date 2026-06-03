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
  ]);
}
