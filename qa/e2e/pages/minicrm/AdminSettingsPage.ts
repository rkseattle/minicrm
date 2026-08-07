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

/** Valid tab keys for the Admin Settings page (MINCRM-259, MINCRM-563). */
export type AdminSettingsTab =
  | 'workspace'
  | 'branding'
  | 'pipelines'
  | 'users'
  | 'security'
  | 'notifications'
  | 'integrations'
  | 'ai'
  | 'flags'
  | 'platform';

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
   * @param section - Optional sub-section within the tab (currently only the
   *   'ai' tab has sub-sections, e.g. 'usage-budgets'). Ignored if `tab` is
   *   omitted. (MINCRM-653)
   */
  async navigate(tab?: AdminSettingsTab, section?: string): Promise<void> {
    const params = new URLSearchParams();
    if (tab) params.set('tab', tab);
    if (tab && section) params.set('section', section);
    const query = params.toString();
    const path = query ? `${AdminSettingsPage.PATH}?${query}` : AdminSettingsPage.PATH;
    await this.page.goto(path, { waitUntil: 'networkidle' });
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the admin settings page heading.
   *
   * The role-based fallback uses an EXACT name match on level-1 rather than a
   * bare `heading` role with no name filter: an active settings tab renders
   * its own h2/h3 sub-headings (e.g. "Navigation Layout" on the General tab)
   * in the same DOM tree, so an unscoped heading role matches whichever tab
   * is active too — see AutomationPage.headingLocator() for the identical
   * failure mode.
   */
  async settingsHeadingLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'settings-heading' },
          {
            type: 'role',
            value: 'heading',
            options: { name: 'Admin Settings', exact: true, level: 1 },
          },
        ],
        { intent: 'admin settings page heading' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the settings save button (general tab).
   */
  async settingsSaveLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'settings-save' },
          { type: 'role', value: 'button', options: { name: /save/i } },
        ],
        { intent: 'save button on admin settings general tab' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the default currency settings section.
   */
  async currencySectionLocator(timeout?: number) {
    // eslint-disable-next-line local/require-locator-fallback -- panel has no accessible name; role:region matches every settings panel
    return this.page
      .locate([{ type: 'testId', value: 'currency-section' }], {
        intent: 'default currency settings section on admin settings page',
      })
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the email notifications section container.
   */
  async emailNotificationsSectionLocator(timeout?: number) {
    // eslint-disable-next-line local/require-locator-fallback -- panel has no accessible name; role:region matches every settings panel
    return this.page
      .locate([{ type: 'testId', value: 'email-notifications-section' }], {
        intent: 'email notifications section on admin settings page',
      })
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the webhook settings section container.
   */
  async webhookSectionLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'webhook-settings-section' },
          { type: 'css', value: '[data-testid="webhook-settings-section"]' },
        ],
        { intent: 'webhook subscriptions section on admin settings integrations tab' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the webhook URL input field.
   */
  async webhookUrlInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'webhook-url-input' },
          { type: 'role', value: 'textbox' },
        ],
        { intent: 'URL input field in the add webhook subscription form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the webhook secret reveal modal.
   */
  async webhookSecretRevealLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'webhook-secret-reveal' },
          { type: 'css', value: '[data-testid="webhook-secret-reveal"]' },
        ],
        { intent: 'modal that reveals the webhook signing secret after creation' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the webhook secret value input.
   */
  async webhookSecretValueLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'webhook-secret-value' },
          { type: 'css', value: '[data-testid="webhook-secret-value"]' },
        ],
        { intent: 'read-only input displaying the webhook signing secret' },
      )
      .resolve(timeout);
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
  async webhookDeleteConfirmLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'webhook-delete-confirm' },
          { type: 'role', value: 'dialog' },
        ],
        { intent: 'confirmation dialog shown before deleting a webhook subscription' },
      )
      .resolve(timeout);
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
      .resolve(timeout)
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
  async exchangeRatesSectionLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'exchange-rates-section' },
          { type: 'role', value: 'region', options: { name: /exchange rate/i } },
        ],
        { intent: 'exchange rates configuration section on admin settings page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the home currency select dropdown.
   */
  async homeCurrencySelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'home-currency-select' },
          { type: 'role', value: 'combobox', options: { name: /home currency/i } },
        ],
        { intent: 'home currency select dropdown on exchange rates section' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the add currency form.
   */
  async addCurrencyFormLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-currency-form' },
          { type: 'css', value: '[data-testid="add-currency-form"]' },
        ],
        { intent: 'inline form for adding a new exchange rate currency row' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the currency code select in the add-currency form.
   */
  async addCurrencyCodeSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-currency-code-select' },
          { type: 'role', value: 'combobox', options: { name: /currency/i } },
        ],
        { intent: 'currency code dropdown in the add-currency inline form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the exchange rate input in the add-currency form.
   */
  async addCurrencyRateInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-currency-rate-input' },
          { type: 'role', value: 'spinbutton', options: { name: /rate/i } },
        ],
        { intent: 'exchange rate numeric input in the add-currency inline form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the save-exchange-rates success message.
   */
  async exchangeRateSaveSuccessLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'exchange-rate-save-success' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success message after saving exchange rate configuration' },
      )
      .resolve(timeout);
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
  async customFieldsSectionLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-fields-section' },
          { type: 'role', value: 'region', options: { name: /custom field/i } },
        ],
        { intent: 'custom fields configuration section on admin settings page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the custom fields entity select dropdown.
   */
  async customFieldsEntitySelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-fields-entity-select' },
          { type: 'role', value: 'combobox', options: { name: /entity/i } },
        ],
        { intent: 'entity type selector for custom fields on admin settings page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the add-field inline form.
   */
  async addFieldFormLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-field-form' },
          { type: 'css', value: '[data-testid="add-field-form"]' },
        ],
        { intent: 'inline form for adding a new custom field definition' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the field name input in the add-field form.
   */
  async addFieldNameInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-field-name-input' },
          { type: 'label', value: 'name', options: { exact: false } },
        ],
        { intent: 'field name text input in the add-custom-field inline form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the custom fields feedback / success message.
   */
  async customFieldsFeedbackLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-fields-feedback' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'feedback message after adding or removing a custom field' },
      )
      .resolve(timeout);
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
    // Register the listener before clicking so the PUT response is always
    // captured even when the server responds before the next await resolves.
    const putDone = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/settings/currencies') &&
        response.request().method() === 'PUT',
    );
    await this.page.click(
      [
        { type: 'testId', value: 'exchange-rate-save-button' },
        { type: 'role', value: 'button', options: { name: /save/i } },
      ],
      { intent: 'save button to persist exchange rate configuration' },
    );
    await putDone;
  }

  // ---------------------------------------------------------------------------
  // Custom fields interactions
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the confirm button in the delete-field dialog.
   */
  async deleteFieldConfirmLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'delete-field-confirm' },
          { type: 'role', value: 'button', options: { name: /confirm|delete/i } },
        ],
        { intent: 'confirm button in the custom field delete confirmation dialog' },
      )
      .resolve(timeout);
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
  async brandingFormLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-form' },
          { type: 'role', value: 'form' },
        ],
        { intent: 'custom branding configuration form on admin settings page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the branding company name input.
   */
  async brandingCompanyNameLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-company-name' },
          { type: 'role', value: 'textbox', options: { name: /company name/i } },
        ],
        { intent: 'company name text input in the branding settings form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the branding primary colour hex text input.
   */
  async brandingColorTextLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-color-text' },
          { type: 'role', value: 'textbox', options: { name: /hex colour/i } },
        ],
        { intent: 'hex colour text input in the branding settings form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the branding font family select dropdown.
   */
  async brandingFontSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-font-select' },
          { type: 'role', value: 'combobox', options: { name: /font/i } },
        ],
        { intent: 'font family dropdown in the branding settings form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the branding Save button.
   */
  async brandingSaveLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-save' },
          { type: 'role', value: 'button', options: { name: /save/i } },
        ],
        { intent: 'save button for the branding configuration form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the branding save success message.
   */
  async brandingSaveSuccessLocator(timeout?: number) {
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
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the branding reset button.
   */
  async brandingResetButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-reset-button' },
          { type: 'role', value: 'button', options: { name: /reset branding/i } },
        ],
        { intent: 'reset to defaults button in the branding settings panel' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the branding reset confirm button.
   */
  async brandingResetConfirmLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-reset-confirm-button' },
          { type: 'role', value: 'button', options: { name: /reset/i } },
        ],
        { intent: 'confirm button in the branding reset confirmation dialog' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the branding reset success message.
   */
  async brandingResetSuccessLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'branding-reset-success' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success message after resetting branding to defaults', fallbackTimeout: 8_000 },
      )
      .resolve(timeout);
  }

  // ---------------------------------------------------------------------------
  // Pipeline stages — customisation tab (MINCRM-381)
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the pipeline stages table.
   */
  async pipelineStagesTableLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'pipeline-stages-table' },
          { type: 'role', value: 'table' },
        ],
        { intent: 'table listing all pipeline stages on the customisation tab' },
      )
      .resolve(timeout);
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
  async pipelineStagesFeedbackLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'pipeline-stages-feedback' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success or error feedback message in the pipeline stages section' },
      )
      .resolve(timeout);
  }

  // ── SSO locators (MINCRM-399) ─────────────────────────────────────────────

  /** Returns a resolved locator for the SSO section panel. */
  async ssoSectionLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-section' },
          { type: 'css', value: '[data-testid="sso-section"]' },
        ],
        { intent: 'SSO configuration section on the integrations settings tab' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the SSO protocol selector. */
  async ssoProtocolSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-protocol-select' },
          { type: 'role', value: 'combobox', options: { name: /protocol/i } },
        ],
        { intent: 'dropdown for selecting SAML or OIDC as the SSO protocol' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the SSO IdP metadata URL input. */
  async ssoIdpMetadataUrlInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-idp-metadata-url-input' },
          { type: 'css', value: '[data-testid="sso-idp-metadata-url-input"]' },
        ],
        { intent: 'input field for the identity provider metadata URL' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the SSO entity ID / client ID input. */
  async ssoEntityIdInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-entity-id-input' },
          { type: 'css', value: '[data-testid="sso-entity-id-input"]' },
        ],
        { intent: 'input field for the SP entity ID or OIDC client ID' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the SSO save button. */
  async ssoSaveButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-save-button' },
          { type: 'role', value: 'button', options: { name: /save sso/i } },
        ],
        { intent: 'button to save the SSO configuration' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the SSO enabled badge. */
  async ssoEnabledBadgeLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-enabled-badge' },
          { type: 'css', value: '[data-testid="sso-enabled-badge"]' },
        ],
        {
          intent: 'status badge showing that SSO is currently enabled and configured',
          // Badge renders after the save success message; allow extra probe time
          // so the locator resolves before the caller's toBeVisible assertion.
          fallbackTimeout: 5_000,
        },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the SSO disable button. */
  async ssoDisableButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-disable-button' },
          { type: 'role', value: 'button', options: { name: /disable sso/i } },
        ],
        { intent: 'button to initiate SSO disable with confirmation' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the SSO disable confirmation button. */
  async ssoDisableConfirmButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-disable-confirm-button' },
          { type: 'role', value: 'button', options: { name: /yes.*disable sso/i } },
        ],
        { intent: 'button to confirm disabling SSO after the confirmation prompt appears' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the SSO save success message. */
  async ssoSaveSuccessLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'sso-save-success' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success message shown after SSO configuration is saved' },
      )
      .resolve(timeout);
  }

  // ---------------------------------------------------------------------------
  // AI Settings locators (MINCRM-457)
  // ---------------------------------------------------------------------------

  /** Returns a resolved locator for the AI settings panel container. */
  async aiSettingsPanelLocator(timeout?: number) {
    // eslint-disable-next-line local/require-locator-fallback -- panel has no accessible name; role:region matches every settings panel
    return this.page
      .locate([{ type: 'testId', value: 'ai-settings-panel' }], {
        intent: 'main panel containing the AI provider and model configuration form',
      })
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for an AI settings sub-navigation tab.
   * (MINCRM-653)
   *
   * @param section - Sub-section key, e.g. 'general', 'usage-budgets',
   *   'data-retention', 'data-minimization'.
   */
  async aiSettingsSubNavTabLocator(section: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `ai-settings-tab-${section}` },
          { type: 'role', value: 'tab' },
        ],
        { intent: `sub-navigation tab for the AI settings "${section}" section` },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the currently active AI settings
   * sub-section panel. (MINCRM-653)
   *
   * @param section - Sub-section key matching the active tab.
   */
  async aiSettingsSubPanelLocator(section: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `ai-settings-panel-${section}` },
          { type: 'role', value: 'tabpanel' },
        ],
        { intent: `content panel for the AI settings "${section}" section` },
      )
      .resolve();
  }

  /** Returns a resolved locator for the AI master toggle switch. */
  async aiMasterToggleLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-master-toggle' },
          { type: 'role', value: 'switch', options: { name: /ai/i } },
        ],
        { intent: 'toggle switch to enable or disable all AI features globally' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the AI toggle confirmation dialog. */
  async aiToggleConfirmDialogLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-toggle-confirm-dialog' },
          { type: 'role', value: 'dialog' },
        ],
        { intent: 'confirmation dialog shown before enabling or disabling AI globally' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the Confirm button inside the AI toggle dialog. */
  async aiToggleConfirmButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-toggle-confirm-button' },
          { type: 'role', value: 'button', options: { name: /confirm/i } },
        ],
        { intent: 'confirm button inside the AI toggle confirmation dialog' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the Cancel button inside the AI toggle dialog. */
  async aiToggleCancelButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-toggle-cancel-button' },
          { type: 'role', value: 'button', options: { name: /cancel/i } },
        ],
        { intent: 'cancel button inside the AI toggle confirmation dialog' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the AI provider select. */
  async aiProviderSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-provider-select' },
          { type: 'role', value: 'combobox', options: { name: /provider/i } },
        ],
        { intent: 'select input for choosing the AI provider' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the AI model select. */
  async aiModelSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-model-select' },
          { type: 'role', value: 'combobox', options: { name: /model/i } },
        ],
        { intent: 'select input for choosing the AI model' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the AI API key input field. */
  async aiApiKeyInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-api-key-input' },
          { type: 'css', value: '[data-testid="ai-api-key-input"]' },
        ],
        { intent: 'input field for entering the AI provider API key' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the masked API key display. */
  async aiApiKeyMaskedLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-api-key-masked' },
          { type: 'css', value: '[data-testid="ai-api-key-masked"]' },
        ],
        { intent: 'masked display showing that an API key is stored without revealing its value' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the Test Connection button. */
  async aiTestConnectionButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-test-connection-button' },
          { type: 'role', value: 'button', options: { name: /test connection/i } },
        ],
        { intent: 'button to test the AI provider API key and model connectivity' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the test connection result message. */
  async aiTestConnectionResultLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-test-connection-result' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'message showing the result of the test connection attempt' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the AI DPA acknowledgment checkbox. */
  async aiDpaCheckboxLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-dpa-checkbox' },
          { type: 'role', value: 'checkbox', options: { name: /dpa|data processing/i } },
        ],
        { intent: 'checkbox to acknowledge the data processing agreement with the AI provider' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the DPA warning banner. */
  async aiDpaWarningBannerLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-dpa-warning-banner' },
          { type: 'role', value: 'alert' },
        ],
        {
          intent:
            'warning banner shown when the data processing agreement has not been acknowledged',
        },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the data posture badge. */
  async aiDataPostureBadgeLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-data-posture-badge' },
          { type: 'css', value: '[data-testid="ai-data-posture-badge"]' },
        ],
        { intent: 'badge showing the current data posture classification for AI usage' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the Save button in the AI configuration section. */
  async aiSaveButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-config-save-button' },
          { type: 'role', value: 'button', options: { name: /save/i } },
        ],
        { intent: 'button to save the AI provider and model configuration' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the AI DPA status badge. */
  async aiDpaStatusBadgeLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-dpa-status-badge' },
          { type: 'css', value: '[data-testid="ai-dpa-status-badge"]' },
        ],
        { intent: 'badge showing the current DPA acknowledgment status' },
      )
      .resolve(timeout);
  }

  // ---------------------------------------------------------------------------
  // Visibility Settings locators (MINCRM-538)
  // ---------------------------------------------------------------------------

  /** Returns a resolved locator for the visibility settings panel container. */
  async visibilitySettingsPanelLocator(timeout?: number) {
    // eslint-disable-next-line local/require-locator-fallback -- panel has no accessible name; role:region matches every settings panel
    return this.page
      .locate([{ type: 'testId', value: 'visibility-settings-panel' }], {
        intent: 'main panel for per-object data visibility policy configuration',
      })
      .resolve(timeout);
  }

  /** Returns a resolved locator for the contacts visibility select element. */
  async visibilityContactsSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'visibility-contacts-select' },
          { type: 'role', value: 'combobox', options: { name: /contacts/i } },
        ],
        { intent: 'select for choosing the contacts visibility policy (private, team, or org)' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the deals visibility select element. */
  async visibilityDealsSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'visibility-deals-select' },
          { type: 'role', value: 'combobox', options: { name: /deals/i } },
        ],
        { intent: 'select for choosing the deals visibility policy (private, team, or org)' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the accounts visibility select element. */
  async visibilityAccountsSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'visibility-accounts-select' },
          { type: 'role', value: 'combobox', options: { name: /accounts/i } },
        ],
        { intent: 'select for choosing the accounts visibility policy (private, team, or org)' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the save button in visibility settings. */
  async visibilitySaveButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'visibility-settings-save-button' },
          { type: 'role', value: 'button', options: { name: /save/i } },
        ],
        { intent: 'button that saves the visibility policy changes' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the visibility save success message. */
  async visibilitySaveSuccessLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'visibility-settings-success' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success message confirming the visibility settings were saved' },
      )
      .resolve(timeout);
  }

  // ---------------------------------------------------------------------------
  // Roles tab (MINCRM-547)
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the View button on a built-in role card.
   * @param roleId - The role's UUID from the API response.
   */
  async roleViewButtonLocator(roleId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `role-view-button-${roleId}` },
          { type: 'role', value: 'button', options: { name: /view/i } },
        ],
        { intent: 'View button on a built-in role card to expand capability details' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the read-only capability panel for a built-in role.
   * @param roleId - The role's UUID from the API response.
   */
  async roleCapabilityPanelLocator(roleId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `role-capability-panel-${roleId}` },
          { type: 'testId', value: 'capability-readonly-list' },
        ],
        { intent: 'read-only capability panel expanded below a built-in role card' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the read-only capability list inside an expanded panel. */
  async roleCapabilityReadOnlyListLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'capability-readonly-list' },
          { type: 'testId', value: 'readonly-capability-group-contacts' },
        ],
        { intent: 'grouped read-only capability list with disabled checkboxes' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for a specific disabled capability checkbox in a built-in role panel.
   * @param capabilityKey - e.g. 'contacts:view'
   */
  async roleReadOnlyCapabilityCheckboxLocator(capabilityKey: string) {
    const [ns, action] = capabilityKey.split(':');
    return this.page
      .locate(
        [
          { type: 'testId', value: `readonly-capability-checkbox-${capabilityKey}` },
          {
            type: 'role',
            value: 'checkbox',
            options: { name: new RegExp(`${ns}.*${action}`, 'i') },
          },
        ],
        {
          intent: `disabled read-only checkbox for the ${capabilityKey} capability in a built-in role panel`,
        },
      )
      .resolve();
  }

  // ---------------------------------------------------------------------------
  // AI session retention section (MINCRM-447)
  // ---------------------------------------------------------------------------

  /** Returns a resolved locator for the AI session retention days input. */
  async aiSessionRetentionDaysInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-session-retention-days-input' },
          { type: 'role', value: 'spinbutton' },
        ],
        { intent: 'AI session retention days numeric input on the AI settings tab' },
      )
      .resolve(timeout);
  }

  /** Fills the AI session retention days input with the given value. */
  async fillAiSessionRetentionDays(days: string) {
    await this.page.fill(days, [
      { type: 'testId', value: 'ai-session-retention-days-input' },
      { type: 'role', value: 'spinbutton' },
    ]);
  }

  /** Clicks the AI session retention save button. */
  async clickAiSessionRetentionSave() {
    await this.page.click([
      { type: 'testId', value: 'ai-session-retention-save-button' },
      { type: 'role', value: 'button', options: { name: /save/i } },
    ]);
  }

  /** Returns a resolved locator for the AI session retention validation error element. */
  async aiSessionRetentionValidationErrorLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-session-retention-validation-error' },
          { type: 'role', value: 'alert' },
        ],
        { intent: 'client-side validation error below the retention days input' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the AI session retention save-success indicator. */
  async aiSessionRetentionSaveSuccessLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-session-retention-save-success' },
          { type: 'text', value: 'saved' },
        ],
        { intent: 'success confirmation message after saving the retention window' },
      )
      .resolve(timeout);
  }

  // ---------------------------------------------------------------------------
  // AI retention stats + manual purge (MINCRM-462)
  // ---------------------------------------------------------------------------

  /** Returns a resolved locator for the retention stats summary text. */
  async aiRetentionStatsLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-retention-stats' },
          { type: 'text', value: 'storing' },
        ],
        { intent: 'session/message counts summary on the AI session retention section' },
      )
      .resolve(timeout);
  }

  /** Clicks the "Purge now" button, opening the manual purge confirmation dialog. */
  async clickAiPurgeNow() {
    await this.page.click([
      { type: 'testId', value: 'ai-purge-now-button' },
      { type: 'role', value: 'button', options: { name: /purge now/i } },
    ]);
  }

  /** Clicks the confirm button inside the manual purge confirmation dialog. */
  async clickAiPurgeConfirm() {
    await this.page.click([
      { type: 'testId', value: 'ai-purge-confirm-button' },
      { type: 'role', value: 'button', options: { name: /purge now/i } },
    ]);
  }

  /** Returns a resolved locator for the manual purge "accepted" confirmation message. */
  async aiPurgeAcceptedLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-purge-accepted' },
          { type: 'text', value: 'started' },
        ],
        { intent: 'confirmation message shown after the manual AI session purge is accepted' },
      )
      .resolve(timeout);
  }

  // ---------------------------------------------------------------------------
  // AI data minimization / field exclusions (MINCRM-461)
  // ---------------------------------------------------------------------------

  /** Returns a resolved locator for the always-excluded fields list container. */
  async aiAlwaysExcludedFieldsLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-always-excluded-fields' },
          { type: 'role', value: 'group' },
        ],
        { intent: 'container listing the immutable always-excluded AI field names' },
      )
      .resolve(timeout);
  }

  /** Clicks the standard-field exclusion toggle for the given entity type and field name. */
  async clickAiFieldExclusionToggle(entityType: string, fieldName: string) {
    await this.page.click([
      { type: 'testId', value: `field-exclusion-toggle-${entityType}-${fieldName}` },
      { type: 'role', value: 'checkbox' },
    ]);
  }

  /** Returns a resolved locator for the standard-field exclusion toggle's current checked state. */
  async aiFieldExclusionToggleLocator(entityType: string, fieldName: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `field-exclusion-toggle-${entityType}-${fieldName}` },
          { type: 'role', value: 'checkbox' },
        ],
        { intent: `AI field exclusion checkbox for ${entityType}.${fieldName}` },
      )
      .resolve();
  }

  /** Clicks the data hygiene sub-section's manual "run now" button. (MINCRM-476) */
  async clickDataHygieneRunNowButton(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'hygiene-run-now-button' },
        { type: 'role', value: 'button', options: { name: /run/i } },
      ],
      { intent: 'button to trigger an immediate data hygiene scan outside the nightly schedule' },
    );
  }

  /** Returns a resolved locator for the data hygiene "run accepted" confirmation message. (MINCRM-476) */
  async dataHygieneRunAcceptedLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'hygiene-run-accepted' },
          { type: 'css', value: '[data-testid="hygiene-run-accepted"]' },
        ],
        { intent: 'confirmation message shown after a manual data hygiene scan is accepted' },
      )
      .resolve(timeout);
  }
}
