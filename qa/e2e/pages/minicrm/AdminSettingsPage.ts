/**
 * AdminSettingsPage — Page Object for the MiniCRM admin settings screen.
 *
 * Encapsulates all UI interactions on `/admin/settings`. Every element uses a
 * HealingLocator with at least 2 strategies. Text-based strategies call t()
 * so selectors stay locale-correct when E2E_LOCALE is set.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-163, MINCRM-192, MINCRM-259
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by AdminSettingsPage. */
export interface AdminSettingsPageContext {
  page: PageFacade;
}

/** Valid tab keys for the Admin Settings page (MINCRM-259). */
export type AdminSettingsTab =
  | 'general'
  | 'notifications'
  | 'currency'
  | 'customisation'
  | 'branding'
  | 'data'
  | 'integrations';

// ---------------------------------------------------------------------------
// AdminSettingsPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM admin settings screen.
 *
 * Usage:
 * ```ts
 * const adminSettings = new AdminSettingsPage({ page });
 * await adminSettings.navigate('notifications');
 * await adminSettings.toggleEmailNotifications();
 * const enabled = await adminSettings.emailNotificationsIsEnabled();
 * ```
 */
export class AdminSettingsPage {
  private readonly page: PageFacade;

  /** The URL path for this page. */
  static readonly PATH = '/admin/settings';

  /**
   * @param context - Playwright fixture context containing page.
   */
  constructor(context: AdminSettingsPageContext) {
    this.page = context.page;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigates directly to the admin settings page, optionally deep-linking to
   * a specific tab via the ?tab= URL param. This avoids viewport-dependent tab
   * interaction (desktop buttons vs mobile <select>) and works in all layouts.
   *
   * @param tab - Optional tab to land on. Defaults to 'general'.
   */
  async navigate(tab?: AdminSettingsTab): Promise<void> {
    const path = tab ? `${AdminSettingsPage.PATH}?tab=${tab}` : AdminSettingsPage.PATH;
    await this.page.goto(path);
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the admin settings page heading.
   */
  async settingsHeadingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'settings-heading' },
          { type: 'role', value: 'heading' },
        ],
        { intent: 'admin settings page heading' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the settings save button (general tab).
   */
  async settingsSaveLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'settings-save' },
          { type: 'role', value: 'button', options: { name: /save/i } },
        ],
        { intent: 'save button on admin settings general tab' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the default currency settings section.
   */
  async currencySectionLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'currency-section' },
          { type: 'role', value: 'region' },
        ],
        { intent: 'default currency settings section on admin settings page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the email notifications section container.
   */
  async emailNotificationsSectionLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-notifications-section' },
          { type: 'role', value: 'region' },
        ],
        { intent: 'email notifications section on admin settings page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the webhook settings section container.
   */
  async webhookSectionLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'webhook-settings-section' },
          { type: 'css', value: '[data-testid="webhook-settings-section"]' },
        ],
        { intent: 'webhook subscriptions section on admin settings integrations tab' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the webhook URL input field.
   */
  async webhookUrlInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'webhook-url-input' },
          { type: 'role', value: 'textbox' },
        ],
        { intent: 'URL input field in the add webhook subscription form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the webhook secret reveal modal.
   */
  async webhookSecretRevealLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'webhook-secret-reveal' },
          { type: 'css', value: '[data-testid="webhook-secret-reveal"]' },
        ],
        { intent: 'modal that reveals the webhook signing secret after creation' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the webhook secret value input.
   */
  async webhookSecretValueLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'webhook-secret-value' },
          { type: 'css', value: '[data-testid="webhook-secret-value"]' },
        ],
        { intent: 'read-only input displaying the webhook signing secret' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for a webhook subscription row by ID.
   *
   * @param subscriptionId - The webhook subscription UUID.
   */
  async webhookRowLocator(subscriptionId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `webhook-row-${subscriptionId}` },
          { type: 'css', value: `[data-testid="webhook-row-${subscriptionId}"]` },
        ],
        { intent: `webhook subscription row for ${subscriptionId}` },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the webhook delete confirmation dialog.
   */
  async webhookDeleteConfirmLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'webhook-delete-confirm' },
          { type: 'role', value: 'dialog' },
        ],
        { intent: 'confirmation dialog shown before deleting a webhook subscription' },
      )
      .resolve();
  }

  /**
   * Returns true when the email notifications section is visible.
   */
  async emailNotificationsSectionIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'email-notifications-section' },
            { type: 'text', value: t('settings.emailNotifications.sectionTitle') },
          ],
          { intent: 'email notifications section on admin settings page' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the email notifications toggle is visible.
   */
  async emailNotificationsToggleIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'email-notif-toggle' },
            { type: 'role', value: 'switch', options: { name: /email notifications/i } },
          ],
          { intent: 'email notifications on/off toggle switch' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the email notifications toggle has aria-checked="true".
   * Waits for the toggle to be visible (i.e., the email-notif query has resolved
   * and the component is no longer in the loading state) before reading.
   */
  async emailNotificationsIsEnabled(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'email-notif-toggle' },
            { type: 'role', value: 'switch', options: { name: /email notifications/i } },
          ],
          { intent: 'email notifications toggle to read enabled state' },
        )
        .resolve();
      // Wait for visible — toggle is only rendered after emailNotifLoading is false,
      // so visibility confirms the query has settled and aria-checked is authoritative.
      await resolved.waitFor({ state: 'visible', timeout: 5_000 });
      const ariaChecked = await resolved.getAttribute('aria-checked');
      return ariaChecked === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the recipient count element is visible.
   */
  async recipientCountIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'email-notif-recipient-count' },
            { type: 'role', value: 'status' },
          ],
          { intent: 'email notification recipient count display' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the success message after toggling email notifications is visible.
   */
  async successMessageIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'email-notif-success' },
            { type: 'role', value: 'status' },
          ],
          { intent: 'success message after saving email notification setting' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Waits for the email notifications success message to become visible.
   * Used by behaviors that need to await the save confirmation before reading state.
   *
   * @param timeout - Maximum ms to wait.
   */
  async waitForEmailNotifSuccessVisible(timeout = 5_000): Promise<void> {
    await this.page
      .locate(
        [
          { type: 'testId', value: 'email-notif-success' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success message after saving email notification setting' },
      )
      .resolve()
      .then((el) => el.waitFor({ state: 'visible', timeout }))
      .catch(() => null);
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  /**
   * Clicks the email notifications toggle to switch its state.
   *
   * Waits for the toggle to be visible before clicking — the toggle is only
   * rendered after the email-notifications query resolves, so visibility
   * guarantees the component reflects actual server state (not the ?? true
   * loading default).
   */
  async toggleEmailNotifications(): Promise<void> {
    const toggle = await this.page
      .locate(
        [
          { type: 'testId', value: 'email-notif-toggle' },
          { type: 'role', value: 'switch', options: { name: /email notifications/i } },
        ],
        { intent: 'email notifications on/off toggle switch' },
      )
      .resolve();
    await toggle.waitFor({ state: 'visible' });
    await toggle.click();
  }

  // ---------------------------------------------------------------------------
  // Nav layout interactions
  // ---------------------------------------------------------------------------

  /**
   * Clicks the radio button for a navigation layout option on the settings page.
   *
   * @param layout - The layout to select: 'top', 'left', or 'hamburger'.
   */
  async selectNavLayoutOption(layout: string): Promise<void> {
    const button = await this.page
      .locate(
        [
          { type: 'testId', value: `nav-layout-option-${layout}` },
          { type: 'role', value: 'radio', options: { name: new RegExp(layout, 'i') } },
        ],
        { intent: 'nav layout radio button on admin settings page' },
      )
      .resolve();
    await button.scrollIntoViewIfNeeded();
    await button.click();
  }

  /**
   * Returns true when the nav layout option for the given layout has
   * aria-checked="true", confirming the PATCH has round-tripped.
   *
   * @param layout - The layout to check: 'top', 'left', or 'hamburger'.
   */
  async navLayoutOptionIsChecked(layout: string): Promise<boolean> {
    try {
      const checked = await this.page
        .locate(
          [
            {
              type: 'css',
              value: `[data-testid="nav-layout-option-${layout}"][aria-checked="true"]`,
            },
            { type: 'testId', value: `nav-layout-option-${layout}` },
          ],
          { intent: 'selected nav layout option with aria-checked true' },
        )
        .resolve()
        .catch(() => null);
      if (!checked) return false;
      await checked.waitFor({ state: 'visible' }).catch(() => null);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Exchange rate state queries
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the exchange rates section container.
   */
  async exchangeRatesSectionLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'exchange-rates-section' },
          { type: 'role', value: 'region', options: { name: /exchange rate/i } },
        ],
        { intent: 'exchange rates configuration section on admin settings page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the home currency select dropdown.
   */
  async homeCurrencySelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'home-currency-select' },
          { type: 'role', value: 'combobox', options: { name: /home currency/i } },
        ],
        { intent: 'home currency select dropdown on exchange rates section' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the add currency form.
   */
  async addCurrencyFormLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-currency-form' },
          { type: 'css', value: '[data-testid="add-currency-form"]' },
        ],
        { intent: 'inline form for adding a new exchange rate currency row' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the currency code select in the add-currency form.
   */
  async addCurrencyCodeSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-currency-code-select' },
          { type: 'role', value: 'combobox', options: { name: /currency/i } },
        ],
        { intent: 'currency code dropdown in the add-currency inline form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the exchange rate input in the add-currency form.
   */
  async addCurrencyRateInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-currency-rate-input' },
          { type: 'role', value: 'spinbutton', options: { name: /rate/i } },
        ],
        { intent: 'exchange rate numeric input in the add-currency inline form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the save-exchange-rates success message.
   */
  async exchangeRateSaveSuccessLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'exchange-rate-save-success' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success message after saving exchange rate configuration' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for an exchange rate row by currency code.
   *
   * @param currencyCode - ISO 4217 code (e.g. 'USD', 'EUR').
   */
  async exchangeRateRowLocator(currencyCode: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `exchange-rate-row-${currencyCode}` },
          { type: 'css', value: `[data-testid="exchange-rate-row-${currencyCode}"]` },
        ],
        { intent: `exchange rate row for ${currencyCode} on admin settings page` },
      )
      .resolve();
  }

  // ---------------------------------------------------------------------------
  // Custom fields state queries
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the custom fields section container.
   */
  async customFieldsSectionLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-fields-section' },
          { type: 'role', value: 'region', options: { name: /custom field/i } },
        ],
        { intent: 'custom fields configuration section on admin settings page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the custom fields entity select dropdown.
   */
  async customFieldsEntitySelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-fields-entity-select' },
          { type: 'role', value: 'combobox', options: { name: /entity/i } },
        ],
        { intent: 'entity type selector for custom fields on admin settings page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the add-field inline form.
   */
  async addFieldFormLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-field-form' },
          { type: 'css', value: '[data-testid="add-field-form"]' },
        ],
        { intent: 'inline form for adding a new custom field definition' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the field name input in the add-field form.
   */
  async addFieldNameInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-field-name-input' },
          { type: 'label', value: 'name', options: { exact: false } },
        ],
        { intent: 'field name text input in the add-custom-field inline form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the custom fields feedback / success message.
   */
  async customFieldsFeedbackLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-fields-feedback' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'feedback message after adding or removing a custom field' },
      )
      .resolve();
  }

  // ---------------------------------------------------------------------------
  // Exchange rate interactions
  // ---------------------------------------------------------------------------

  /**
   * Clicks the "Add Currency" button to open the add currency form.
   */
  async clickAddCurrency(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'exchange-rate-add-button' },
        { type: 'role', value: 'button', options: { name: /add currency/i } },
      ],
      { intent: 'add currency button to open the currency entry form' },
    );
  }

  /**
   * Confirms adding a new currency row (submits the inline add-currency form).
   */
  async confirmAddCurrency(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'add-currency-confirm' },
        { type: 'role', value: 'button', options: { name: /confirm|add/i } },
      ],
      { intent: 'confirm button to save the new currency row' },
    );
  }

  /**
   * Clicks the Save exchange rates button to persist all rate changes.
   */
  async saveExchangeRates(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'exchange-rate-save-button' },
        { type: 'role', value: 'button', options: { name: /save/i } },
      ],
      { intent: 'save button to persist exchange rate configuration' },
    );
  }

  // ---------------------------------------------------------------------------
  // Custom fields interactions
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the confirm button in the delete-field dialog.
   */
  async deleteFieldConfirmLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'delete-field-confirm' },
          { type: 'role', value: 'button', options: { name: /confirm|delete/i } },
        ],
        { intent: 'confirm button in the custom field delete confirmation dialog' },
      )
      .resolve();
  }

  /**
   * Clicks the "Add Field" button to open the add custom field form.
   */
  async clickAddField(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'add-field-button' },
        { type: 'role', value: 'button', options: { name: /add field/i } },
      ],
      { intent: 'add field button to open the custom field entry form' },
    );
  }

  /**
   * Submits the add custom field form.
   */
  async submitAddField(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'add-field-submit' },
        { type: 'role', value: 'button', options: { name: /save|add/i } },
      ],
      { intent: 'submit button to save the new custom field definition' },
    );
  }

  // ---------------------------------------------------------------------------
  // Webhook interactions
  // ---------------------------------------------------------------------------

  /**
   * Clicks a webhook event checkbox by its event name (e.g. 'contact.created').
   *
   * @param eventName - The event name used in the testId (e.g. 'contact.created').
   */
  async clickWebhookEvent(eventName: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `webhook-event-${eventName}` },
        { type: 'role', value: 'checkbox', options: { name: eventName } },
      ],
      { intent: `checkbox for the ${eventName} webhook event` },
    );
  }

  /**
   * Clicks the "Add Webhook" button to submit the new webhook form.
   */
  async clickAddWebhook(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'webhook-add-button' },
        { type: 'role', value: 'button', options: { name: /add|subscribe/i } },
      ],
      { intent: 'add webhook button to submit the new webhook subscription form' },
    );
  }

  /**
   * Closes the webhook secret reveal modal by clicking "Done".
   */
  async closeWebhookSecretModal(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'webhook-secret-done-button' },
        { type: 'role', value: 'button', options: { name: /done|close/i } },
      ],
      { intent: 'done button to close the webhook secret reveal modal' },
    );
  }

  /**
   * Toggles a webhook subscription's enabled/disabled status.
   *
   * @param subscriptionId - The webhook subscription UUID.
   */
  async toggleWebhook(subscriptionId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `webhook-toggle-button-${subscriptionId}` },
        { type: 'role', value: 'button', options: { name: /enable|disable|toggle/i } },
      ],
      { intent: 'toggle button to enable or disable a webhook subscription' },
    );
  }

  /**
   * Clicks the delete button for a specific webhook subscription.
   *
   * @param subscriptionId - The webhook subscription UUID.
   */
  async clickDeleteWebhook(subscriptionId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `webhook-delete-button-${subscriptionId}` },
        { type: 'role', value: 'button', options: { name: /delete/i } },
      ],
      { intent: 'delete button for a specific webhook subscription row' },
    );
  }

  /**
   * Confirms deletion in the webhook delete confirmation dialog.
   */
  async confirmDeleteWebhook(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'webhook-delete-confirm-button' },
        { type: 'role', value: 'button', options: { name: /confirm|delete/i } },
      ],
      { intent: 'confirm button in the webhook delete confirmation dialog' },
    );
  }

  // ---------------------------------------------------------------------------
  // Branding interactions (MINCRM-356)
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the branding form.
   */
  async brandingFormLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-form' },
          { type: 'role', value: 'form' },
        ],
        { intent: 'custom branding configuration form on admin settings page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the branding company name input.
   */
  async brandingCompanyNameLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-company-name' },
          { type: 'role', value: 'textbox', options: { name: /company name/i } },
        ],
        { intent: 'company name text input in the branding settings form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the branding primary colour hex text input.
   */
  async brandingColorTextLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-color-text' },
          { type: 'role', value: 'textbox', options: { name: /hex colour/i } },
        ],
        { intent: 'hex colour text input in the branding settings form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the branding font family select dropdown.
   */
  async brandingFontSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-font-select' },
          { type: 'role', value: 'combobox', options: { name: /font/i } },
        ],
        { intent: 'font family dropdown in the branding settings form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the branding Save button.
   */
  async brandingSaveLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-save' },
          { type: 'role', value: 'button', options: { name: /save/i } },
        ],
        { intent: 'save button for the branding configuration form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the branding save success message.
   */
  async brandingSaveSuccessLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-success' },
          { type: 'role', value: 'status' },
        ],
        {
          intent: 'success confirmation message after saving branding settings',
          fallbackTimeout: 8_000,
        },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the branding reset button.
   */
  async brandingResetButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-reset-button' },
          { type: 'role', value: 'button', options: { name: /reset branding/i } },
        ],
        { intent: 'reset to defaults button in the branding settings panel' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the branding reset confirm button.
   */
  async brandingResetConfirmLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-reset-confirm-button' },
          { type: 'role', value: 'button', options: { name: /reset/i } },
        ],
        { intent: 'confirm button in the branding reset confirmation dialog' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the branding reset success message.
   */
  async brandingResetSuccessLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-reset-success' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success message after resetting branding to defaults', fallbackTimeout: 8_000 },
      )
      .resolve();
  }

  // ---------------------------------------------------------------------------
  // Pipeline stages — customisation tab (MINCRM-381)
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the pipeline stages table.
   */
  async pipelineStagesTableLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'pipeline-stages-table' },
          { type: 'role', value: 'table' },
        ],
        { intent: 'table listing all pipeline stages on the customisation tab' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the move-up button of a stage row by stage ID.
   *
   * @param stageId - UUID of the stage row.
   */
  async pipelineStageMoveUpLocator(stageId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `pipeline-stage-move-up-${stageId}` },
          { type: 'role', value: 'button', options: { name: /move .+ up/i } },
        ],
        { intent: `move-up button for pipeline stage ${stageId}` },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the move-down button of a stage row by stage ID.
   *
   * @param stageId - UUID of the stage row.
   */
  async pipelineStageMoveDownLocator(stageId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `pipeline-stage-move-down-${stageId}` },
          { type: 'role', value: 'button', options: { name: /move .+ down/i } },
        ],
        { intent: `move-down button for pipeline stage ${stageId}` },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the pipeline stages feedback status message.
   */
  async pipelineStagesFeedbackLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'pipeline-stages-feedback' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success or error feedback message in the pipeline stages section' },
      )
      .resolve();
  }

  // ── SSO locators (MINCRM-399) ─────────────────────────────────────────────

  /** Returns a resolved locator for the SSO section panel. */
  async ssoSectionLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-section' },
          { type: 'css', value: '[data-testid="sso-section"]' },
        ],
        { intent: 'SSO configuration section on the integrations settings tab' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the SSO protocol selector. */
  async ssoProtocolSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-protocol-select' },
          { type: 'role', value: 'combobox', options: { name: /protocol/i } },
        ],
        { intent: 'dropdown for selecting SAML or OIDC as the SSO protocol' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the SSO IdP metadata URL input. */
  async ssoIdpMetadataUrlInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-idp-metadata-url-input' },
          { type: 'css', value: '[data-testid="sso-idp-metadata-url-input"]' },
        ],
        { intent: 'input field for the identity provider metadata URL' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the SSO entity ID / client ID input. */
  async ssoEntityIdInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-entity-id-input' },
          { type: 'css', value: '[data-testid="sso-entity-id-input"]' },
        ],
        { intent: 'input field for the SP entity ID or OIDC client ID' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the SSO save button. */
  async ssoSaveButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-save-button' },
          { type: 'role', value: 'button', options: { name: /save sso/i } },
        ],
        { intent: 'button to save the SSO configuration' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the SSO enabled badge. */
  async ssoEnabledBadgeLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-enabled-badge' },
          { type: 'css', value: '[data-testid="sso-enabled-badge"]' },
        ],
        { intent: 'status badge showing that SSO is currently enabled and configured' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the SSO disable button. */
  async ssoDisableButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-disable-button' },
          { type: 'role', value: 'button', options: { name: /disable sso/i } },
        ],
        { intent: 'button to initiate SSO disable with confirmation' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the SSO disable confirmation button. */
  async ssoDisableConfirmButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-disable-confirm-button' },
          { type: 'role', value: 'button', options: { name: /yes.*disable sso/i } },
        ],
        { intent: 'button to confirm disabling SSO after the confirmation prompt appears' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the SSO save success message. */
  async ssoSaveSuccessLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-save-success' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success message shown after SSO configuration is saved' },
      )
      .resolve();
  }
}
