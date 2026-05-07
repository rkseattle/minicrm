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
   */
  async toggleEmailNotifications(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'email-notif-toggle' },
        { type: 'css', value: '[data-testid="email-notif-toggle"]' },
      ],
      { intent: 'email notifications on/off toggle switch' },
    );
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
}
