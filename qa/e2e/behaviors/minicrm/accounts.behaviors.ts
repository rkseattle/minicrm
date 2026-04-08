/**
 * Accounts behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-139
 */

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { t } from '@framework/i18n/locale.js';
import { AccountsPage } from '@pages/minicrm/AccountsPage.js';
import { AccountDetailPage } from '@pages/minicrm/AccountDetailPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by accounts behaviors. */
export interface AccountsBehaviorContext {
  page: Page;
  healPage: HealPage;
  /** Current test name forwarded to Page Object constructors for heal audit records. */
  testName: string;
}

// ---------------------------------------------------------------------------
// navigateToAccounts()
// ---------------------------------------------------------------------------

/** Result returned by the navigateToAccounts behavior. */
export interface NavigateToAccountsResult {
  /**
   * True when the accounts page loaded successfully (New Account button present).
   */
  loaded: boolean;
  /**
   * The URL the browser settled on after navigation.
   */
  finalUrl: string;
}

/**
 * Navigates to the accounts list page and waits for it to be ready.
 *
 * @param context - Playwright fixture context.
 * @returns NavigateToAccountsResult describing the outcome.
 *
 * @example
 * ```ts
 * const result = await navigateToAccounts({ page, healPage, testName: 'my test' });
 * expect(result.loaded).toBe(true);
 * ```
 */
export async function navigateToAccounts(
  context: AccountsBehaviorContext,
): Promise<NavigateToAccountsResult> {
  const accountsPage = new AccountsPage(context);

  await accountsPage.navigate();
  const loaded = await accountsPage.isLoaded();
  const finalUrl = accountsPage.url();

  return { loaded, finalUrl };
}

// ---------------------------------------------------------------------------
// editAccount()
// ---------------------------------------------------------------------------

/**
 * Field changes accepted by editAccount.
 * Only supplied keys are filled — others are left as-is.
 */
export interface AccountChanges {
  name?: string;
  industry?: string;
}

/** Result returned by the editAccount behavior. */
export interface EditAccountResult {
  /**
   * True when the detail page reloaded in read mode after saving.
   */
  saved: boolean;
  /**
   * The URL the browser settled on after saving.
   */
  finalUrl: string;
}

/**
 * Navigates to an account's detail page, enters edit mode, applies the supplied
 * field changes, and saves.
 *
 * @param id - Account UUID.
 * @param changes - Fields to update.
 * @param context - Playwright fixture context.
 * @returns EditAccountResult describing the outcome.
 *
 * @example
 * ```ts
 * const result = await editAccount(account.id, { name: 'Updated Corp' }, { page, healPage, testName });
 * expect(result.saved).toBe(true);
 * ```
 */
export async function editAccount(
  id: string,
  changes: AccountChanges,
  context: AccountsBehaviorContext,
): Promise<EditAccountResult> {
  const detailPage = new AccountDetailPage(context);

  await detailPage.navigate(id);
  await detailPage.clickEdit();

  const fieldMap: Record<keyof AccountChanges, [string, string]> = {
    name: ['account-name-input', 'Company name'],
    industry: ['account-industry', 'Industry'],
  };
  for (const [key, [testId, label]] of Object.entries(fieldMap) as Array<
    [keyof AccountChanges, [string, string]]
  >) {
    if (changes[key] !== undefined) {
      await detailPage.fillField(testId, label, changes[key] as string);
    }
  }

  await detailPage.save();

  // After save the page returns to read mode — the edit button reappears.
  const saved = await detailPage.isLoaded();
  const finalUrl = detailPage.url();
  return { saved, finalUrl };
}

// ---------------------------------------------------------------------------
// createAccountViaUI()
// ---------------------------------------------------------------------------

/** Fields accepted by createAccountViaUI. name is required. */
export interface CreateAccountUIFields {
  name: string;
  industry?: string;
  website?: string;
  employee_range?: string;
  revenue_range?: string;
}

/** Result returned by createAccountViaUI. */
export interface CreateAccountViaUIResult {
  /**
   * True when the form submitted successfully (form is no longer visible,
   * New Account button is back).
   */
  created: boolean;
  /**
   * True when the form stayed open with a validation error (e.g. missing
   * required field).
   */
  validationError: boolean;
  /** The URL the browser settled on after the operation. */
  finalUrl: string;
}

/**
 * Navigates to /accounts, opens the inline create form, fills the supplied
 * fields, and submits.
 *
 * @param fields - Form field values to fill.
 * @param context - Playwright fixture context.
 * @returns CreateAccountViaUIResult.
 */
export async function createAccountViaUI(
  fields: CreateAccountUIFields,
  context: AccountsBehaviorContext,
): Promise<CreateAccountViaUIResult> {
  const accountsPage = new AccountsPage(context);
  await accountsPage.navigate();
  await accountsPage.clickNewAccount();

  // Fill required name field.
  await context.healPage.fill(fields.name, [
    { type: 'testId', value: 'account-name-input' },
    { type: 'label', value: 'Company name', options: { exact: false } },
  ]);

  // Fill optional fields when provided.
  if (fields.industry !== undefined) {
    await context.healPage.fill(fields.industry, [
      { type: 'testId', value: 'account-industry' },
      { type: 'label', value: 'Industry', options: { exact: false } },
    ]);
  }
  if (fields.website !== undefined) {
    await context.healPage.fill(fields.website, [
      { type: 'testId', value: 'account-website' },
      { type: 'label', value: 'Website', options: { exact: false } },
    ]);
  }
  if (fields.employee_range !== undefined) {
    await context.healPage.fill(fields.employee_range, [
      { type: 'testId', value: 'account-employee-range' },
      { type: 'label', value: 'Employee count', options: { exact: false } },
    ]);
  }
  if (fields.revenue_range !== undefined) {
    await context.healPage.fill(fields.revenue_range, [
      { type: 'testId', value: 'account-revenue-range' },
      { type: 'label', value: 'Revenue range', options: { exact: false } },
    ]);
  }

  // Submit the form.
  await context.healPage.click([
    { type: 'testId', value: 'account-form-submit' },
    { type: 'role', value: 'button', options: { name: t('accounts.save'), exact: false } },
  ]);

  await context.page.waitForLoadState('networkidle');

  const finalUrl = context.page.url();

  // Check form still visible (validation error).
  const formLocator = context.page.locator('[data-testid="account-form"]');
  const formStillVisible = await formLocator.isVisible().catch(() => false);

  const created = !formStillVisible;
  const validationError = formStillVisible;

  return { created, validationError, finalUrl };
}

// ---------------------------------------------------------------------------
// deleteAccountViaUI()
// ---------------------------------------------------------------------------

/** Result returned by deleteAccountViaUI. */
export interface DeleteAccountViaUIResult {
  /**
   * True when the account was deleted and the browser navigated back to /accounts.
   */
  deleted: boolean;
  /** The URL the browser settled on after the operation. */
  finalUrl: string;
}

/**
 * Navigates to an account's detail page, clicks Delete, confirms the modal,
 * and waits for navigation back to /accounts.
 *
 * @param id - Account UUID.
 * @param context - Playwright fixture context.
 * @returns DeleteAccountViaUIResult.
 */
export async function deleteAccountViaUI(
  id: string,
  context: AccountsBehaviorContext,
): Promise<DeleteAccountViaUIResult> {
  const detailPage = new AccountDetailPage(context);
  await detailPage.navigate(id);

  // Click the Delete button to open the confirmation modal.
  await context.healPage.click([
    { type: 'testId', value: 'delete-account-button' },
    { type: 'role', value: 'button', options: { name: t('accounts.delete'), exact: false } },
  ]);

  // Confirm deletion in the modal.
  await context.healPage.click([
    { type: 'testId', value: 'confirm-delete-confirm' },
    { type: 'role', value: 'button', options: { name: t('common.delete'), exact: false } },
  ]);

  // Wait for navigation back to /accounts.
  await context.page.waitForURL('**/accounts', { timeout: 10_000 }).catch(() => null);
  await context.page.waitForLoadState('networkidle');

  const finalUrl = context.page.url();
  const deleted = new URL(finalUrl).pathname === '/accounts';

  return { deleted, finalUrl };
}

// ---------------------------------------------------------------------------
// cancelDeleteAccount()
// ---------------------------------------------------------------------------

/** Result returned by cancelDeleteAccount. */
export interface CancelDeleteAccountResult {
  /** True when the account detail page is still showing (deletion was cancelled). */
  stillOnDetailPage: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to an account's detail page, clicks Delete, then clicks Cancel
 * in the confirmation modal without confirming.
 *
 * @param id - Account UUID.
 * @param context - Playwright fixture context.
 * @returns CancelDeleteAccountResult.
 */
export async function cancelDeleteAccount(
  id: string,
  context: AccountsBehaviorContext,
): Promise<CancelDeleteAccountResult> {
  const detailPage = new AccountDetailPage(context);
  await detailPage.navigate(id);

  // Click the Delete button.
  await context.healPage.click([
    { type: 'testId', value: 'delete-account-button' },
    { type: 'role', value: 'button', options: { name: t('accounts.delete'), exact: false } },
  ]);

  // Click Cancel in the confirmation modal.
  await context.healPage.click([
    { type: 'testId', value: 'confirm-delete-cancel' },
    { type: 'role', value: 'button', options: { name: t('common.cancel'), exact: false } },
  ]);

  // Wait briefly for the modal close animation.
  await context.page.waitForTimeout(200);
  await context.page.waitForLoadState('networkidle');

  const finalUrl = context.page.url();
  const stillOnDetailPage = new URL(finalUrl).pathname === `/accounts/${id}`;

  return { stillOnDetailPage, finalUrl };
}

// ---------------------------------------------------------------------------
// cancelAccountEdit()
// ---------------------------------------------------------------------------

/** Result returned by cancelAccountEdit. */
export interface CancelAccountEditResult {
  /** True when the detail page returned to read mode (edit button is back). */
  backToReadMode: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to an account's detail page, enters edit mode, modifies a field,
 * then cancels — verifying the change was not persisted.
 *
 * @param id - Account UUID.
 * @param fieldValue - A value typed into the name field before cancelling.
 * @param context - Playwright fixture context.
 * @returns CancelAccountEditResult.
 */
export async function cancelAccountEdit(
  id: string,
  fieldValue: string,
  context: AccountsBehaviorContext,
): Promise<CancelAccountEditResult> {
  const detailPage = new AccountDetailPage(context);
  await detailPage.navigate(id);
  await detailPage.clickEdit();

  // Type something to make the cancel meaningful.
  await detailPage.fillField('account-name-input', 'Company name', fieldValue);

  // Click Cancel.
  await context.healPage.click([
    { type: 'testId', value: 'account-form-cancel' },
    { type: 'role', value: 'button', options: { name: t('accounts.cancel'), exact: false } },
  ]);

  await context.page.waitForLoadState('networkidle');

  const backToReadMode = await detailPage.isLoaded();
  const finalUrl = detailPage.url();

  return { backToReadMode, finalUrl };
}
