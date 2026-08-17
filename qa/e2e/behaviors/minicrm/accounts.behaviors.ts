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
 * MINCRM-139, MINCRM-357
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import {
  gotoAndSettle,
  navigateAndSettle,
  FIRST_INTERACTION_TIMEOUT_MS,
} from '@apps/minicrm/helpers.js';
import type { PageFacade, SafeLocator } from '@framework/fixtures/index.js';
import { AccountsPage } from '@pages/minicrm/AccountsPage.js';
import { AccountDetailPage } from '@pages/minicrm/AccountDetailPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by accounts behaviors. */
export interface AccountsBehaviorContext {
  page: PageFacade;
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
 * const result = await navigateToAccounts({ page });
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
 * const result = await editAccount(account.id, { name: 'Updated Corp' }, { page });
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
  await accountsPage.fillName(fields.name);

  // Fill optional fields when provided.
  if (fields.industry !== undefined) {
    await accountsPage.fillIndustry(fields.industry);
  }
  if (fields.website !== undefined) {
    await accountsPage.fillWebsite(fields.website);
  }
  if (fields.employee_range !== undefined) {
    await accountsPage.fillEmployeeRange(fields.employee_range);
  }
  if (fields.revenue_range !== undefined) {
    await accountsPage.fillRevenueRange(fields.revenue_range);
  }

  // Submit the form.
  await accountsPage.submitCreateForm();

  // Wait for the outcome to settle.
  //
  // Two possible outcomes after clicking submit:
  //
  // 1. Success: a POST fires, the server responds, React closes the form and
  //    re-renders the New Account button. We wait for that button as the
  //    canonical signal (up to 10s).
  //
  // 2. Validation error: HTML5 required-field validation fires synchronously,
  //    no POST is made. The form stays open and the button never reappears.
  //    We time out after 10s and check button visibility — it will be false.
  //
  // We do NOT race with networkidle or a fixed timer. On slow CI mobile runners
  // even 100ms networkidle can fire while a POST is still in-flight, causing
  // the race to resolve before React re-renders the button and yielding a false
  // `created: false` result (MINCRM-139).
  const buttonVisible = await accountsPage.waitForNewAccountButton();

  const finalUrl = context.page.url();
  const created = buttonVisible;
  const validationError = !buttonVisible;

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

  await detailPage.clickDelete();
  await detailPage.confirmDelete();

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

  await detailPage.clickDelete();
  await detailPage.cancelDelete();

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
// ---------------------------------------------------------------------------
// searchAccounts()
// ---------------------------------------------------------------------------

/** Result returned by searchAccounts. */
export interface SearchAccountsResult {
  /** Number of account rows visible after the search settled. */
  rowCount: number;
  /** True when the empty-state placeholder is visible. */
  emptyStateVisible: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to /accounts, types a search term, and waits for results to settle.
 *
 * @param searchTerm - Text to type into the search input.
 * @param context - Playwright fixture context.
 * @returns SearchAccountsResult.
 */
export async function searchAccounts(
  searchTerm: string,
  context: AccountsBehaviorContext,
): Promise<SearchAccountsResult> {
  const accountsPage = new AccountsPage(context);
  await accountsPage.navigate();

  await accountsPage.search(searchTerm);

  // Wait for the DOM to reflect the search result before reading counts.
  // waitForResponse (inside search()) signals the response arrived, but React
  // re-renders asynchronously. Poll until the empty-state element appears OR
  // the row count stabilises at a non-zero value (max 5 s). (MINCRM-418)
  await context.page
    .waitForFunction(
      `document.querySelector('[data-testid="accounts-empty-state"]') !== null || document.querySelectorAll('[data-testid^="account-link-"]').length > 0`,
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => null); // If neither appears within 5 s, fall through and let assertions report the state.

  const rowCount = await accountsPage.rowCount();
  const emptyStateVisible = await accountsPage.emptyStateIsVisible();

  const finalUrl = accountsPage.url();

  return { rowCount, emptyStateVisible, finalUrl };
}

// ---------------------------------------------------------------------------
// cancelAccountEdit()
// ---------------------------------------------------------------------------

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

  await detailPage.cancelEdit();

  await context.page.waitForLoadState('networkidle');

  const backToReadMode = await detailPage.isLoaded();
  const finalUrl = detailPage.url();

  return { backToReadMode, finalUrl };
}

// ---------------------------------------------------------------------------
// API data-fetch helpers (MINCRM-357)
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/v1/accounts/:id. */
export interface AccountRow {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  employee_range: string | null;
  revenue_range: string | null;
  owner_id: string;
  /** Optimistic lock version (MINCRM-349). */
  version: number;
}

/** Shape of paginated account list rows from GET /api/v1/accounts. */
export interface AccountListRow {
  id: string;
  name: string;
  industry: string | null;
}

/**
 * Fetches a single account by ID from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param accountId - Account UUID.
 * @returns The account record.
 */
export async function getAccountById(
  restClient: RestClient,
  accountId: string,
): Promise<AccountRow> {
  const res = await restClient.get<{ account: AccountRow }>(`/api/v1/accounts/${accountId}`);
  return res.body.account;
}

/**
 * Searches for accounts matching the given query and returns the list.
 *
 * @param restClient - Authenticated RestClient.
 * @param search - Search term (URL-encoded internally).
 * @returns Object with total count and data array.
 */
export async function searchAccountsViaApi(
  restClient: RestClient,
  search: string,
): Promise<{ total: number; data: AccountListRow[] }> {
  const res = await restClient.get<{ data: AccountListRow[]; total: number }>(
    `/api/v1/accounts?search=${encodeURIComponent(search)}`,
  );
  return { total: res.body.total, data: res.body.data };
}

/**
 * Fetches a paginated, optionally sorted accounts list from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param options - Query parameters (search, sort, dir, limit, page).
 * @returns Object with data array and total count.
 */
export async function listAccountsViaApi(
  restClient: RestClient,
  options: {
    search?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
    limit?: number;
    page?: number;
  } = {},
): Promise<{ total: number; data: AccountListRow[] }> {
  const params = new URLSearchParams();
  if (options.search) params.set('search', options.search);
  if (options.sort) params.set('sort', options.sort);
  if (options.dir) params.set('dir', options.dir);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.page !== undefined) params.set('page', String(options.page));
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await restClient.get<{ data: AccountListRow[]; total: number }>(
    `/api/v1/accounts${query}`,
  );
  return { total: res.body.total, data: res.body.data };
}

/**
 * Patches arbitrary fields on an account via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param accountId - Account UUID.
 * @param patch - Fields to update (must include version for optimistic locking).
 * @returns The updated account record.
 */
export async function patchAccount(
  restClient: RestClient,
  accountId: string,
  patch: Partial<AccountRow> & { version: number },
): Promise<AccountRow> {
  const res = await restClient.patch<{ account: AccountRow }>(
    `/api/v1/accounts/${accountId}`,
    patch,
  );
  return res.body.account;
}

/**
 * Deletes an account by ID via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param accountId - Account UUID.
 * @returns The HTTP status code.
 */
export async function deleteAccount(restClient: RestClient, accountId: string): Promise<number> {
  const res = await restClient.delete(`/api/v1/accounts/${accountId}`);
  return res.status;
}

/**
 * Creates an account via the API and returns the created record.
 *
 * @param restClient - Authenticated RestClient.
 * @param params - Account fields.
 * @returns The created account record.
 */
export async function createAccountViaApi(
  restClient: RestClient,
  params: { name: string; industry?: string; website?: string; owner_id?: string },
): Promise<AccountRow> {
  const res = await restClient.post<{ account: AccountRow }>('/api/v1/accounts', params);
  return res.body.account;
}

// ---------------------------------------------------------------------------
// Locator-accessor behaviors — wrap AccountDetailPage locators
// so spec files never import @pages/* directly. (MINCRM-367)
// ---------------------------------------------------------------------------

/**
 * Asserts a linked contact row by contact ID is visible on the account
 * detail page.
 *
 * Waits for the linked-contacts section's own loading placeholder to clear
 * first — same independent-query race as
 * expectAccountLinkedContactsEmptyVisible's own docblock describes.
 */
export async function expectAccountLinkedContactVisible(
  contactId: string,
  context: AccountsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  await context.page.waitForFunction(
    `document.querySelector('[aria-labelledby="linked-contacts-heading"] [aria-busy="true"]') === null`,
    undefined,
    { timeout: 10_000 },
  );
  const locator = await new AccountDetailPage(context).linkedContactLocator(contactId);
  await expect(locator).toBeVisible();
}

/**
 * Asserts the empty-state message is visible when no contacts are linked to
 * the account.
 *
 * The account record and its linked-contacts list are TWO INDEPENDENT
 * queries (AccountDetailPage.tsx's own linkedContactsData useQuery is
 * separate from the account's own data fetch) — the page can finish loading
 * (edit button visible) while the linked-contacts section is still on its
 * own loading placeholder (`aria-busy="true"`, no `linked-contacts-empty`
 * testid yet). navigateToAccount's `waitUntil: 'networkidle'` is not a
 * reliable substitute for waiting on this specific query, since
 * `networkidle` can settle before or after any individual fetch depending
 * on other in-flight network activity. Waits for the section's own loading
 * placeholder to be gone before resolving the locator, rather than relying
 * on HealingLocator's own retry budget to paper over the race (same
 * decoupling this repo already applies elsewhere — see
 * waitForContactAccountLinkLoaded's own docblock).
 */
export async function expectAccountLinkedContactsEmptyVisible(
  context: AccountsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  await context.page.waitForFunction(
    `document.querySelector('[aria-labelledby="linked-contacts-heading"] [aria-busy="true"]') === null`,
    undefined,
    { timeout: 10_000 },
  );
  const locator = await new AccountDetailPage(context).linkedContactsEmptyLocator();
  await expect(locator).toBeVisible();
}

/** Waits for the attachments section to become visible on the account detail page. */
export async function waitForAccountAttachmentsSection(
  context: AccountsBehaviorContext,
): Promise<void> {
  const locator = await new AccountDetailPage(context).attachmentsSectionLocator();
  await locator?.waitFor({ state: 'visible' });
}

/**
 * Sets the given files on the file input for the attachments section on the account detail page.
 * Equivalent to the upload interaction a user performs by selecting files.
 */
export async function uploadAccountAttachment(
  context: AccountsBehaviorContext,
  file: Parameters<SafeLocator['setInputFiles']>[0],
): Promise<void> {
  const locator = await new AccountDetailPage(context).attachmentsFileInputLocator();
  await locator.setInputFiles(file);
}

/** Waits for the attachments list to become visible on the account detail page, with an optional timeout (ms). */
export async function waitForAccountAttachmentsList(
  context: AccountsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const locator = await new AccountDetailPage(context).attachmentsListLocator(timeout);
  await locator?.waitFor({ state: 'visible', ...(timeout !== undefined ? { timeout } : {}) });
}

/**
 * Navigates to the accounts list pre-filtered to the current user's records
 * (owner=me) and waits for the page to reach networkidle.
 */
export async function navigateToAccountsOwnedByMe(context: AccountsBehaviorContext): Promise<void> {
  await gotoAndSettle(context.page, '/accounts?owner=me');
}

// ---------------------------------------------------------------------------
// Visibility check helpers — keep page.doesNotExist() out of spec files.
// (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Returns true when no role="alert" element exists in the DOM.
 * Used to assert that an account detail page loaded without errors.
 */
export async function noAlertExists(context: AccountsBehaviorContext): Promise<boolean> {
  return context.page.doesNotExist([{ type: 'role', value: 'alert' }]);
}

/**
 * Clicks the edit button on the account detail page to enter edit mode.
 */
export async function clickAccountEditButton(context: AccountsBehaviorContext): Promise<void> {
  const detailPage = new AccountDetailPage(context);
  await detailPage.clickEdit();
}

/**
 * Returns true when the linked-contact element for the given contact ID is absent.
 * Used to assert a contact was unlinked from an account.
 */
export async function isLinkedContactAbsent(
  contactId: string,
  context: AccountsBehaviorContext,
): Promise<boolean> {
  return context.page.doesNotExist([{ type: 'testId', value: `linked-contact-${contactId}` }]);
}

// ---------------------------------------------------------------------------
// Concurrency / conflict-resolution helpers (MINCRM-400)
// Mirrors the pattern used in contacts.behaviors.ts for F-CC2-style UI tests.
// ---------------------------------------------------------------------------

/**
 * Navigates to the account detail page for the given account ID.
 */
export async function navigateToAccountDetail(
  accountId: string,
  context: AccountsBehaviorContext,
): Promise<void> {
  const detailPage = new AccountDetailPage(context);
  // Settle the feature-flag query before returning. The page object's navigate()
  // is a raw goto, so without this the caller resumes while
  // GET /api/v1/feature-flags/me is still in flight — and useFeatureFlag fails
  // closed, leaving every flag-gated control absent from the DOM rather than
  // merely hidden. navigateToAccount() in helpers.ts has always settled; these
  // *Detail behaviors did not, which is why only the export tests raced.
  // (MINCRM-700, MINCRM-703)
  await navigateAndSettle(context.page, () => detailPage.navigate(accountId));
}

/**
 * Fills a field in the account edit form.
 *
 * @param testId - data-testid of the input field.
 * @param label - i18n label used as fallback strategy.
 * @param value - Value to type.
 */
export async function fillAccountDetailField(
  testId: string,
  label: string,
  value: string,
  context: AccountsBehaviorContext,
): Promise<void> {
  const detailPage = new AccountDetailPage(context);
  await detailPage.fillField(testId, label, value);
}

/**
 * Clicks Save on the account detail edit form and waits for the PATCH response.
 * No status filter — callers such as concurrency tests deliberately trigger
 * 409 responses and must handle the outcome themselves after this returns.
 */
export async function saveAccountDetail(context: AccountsBehaviorContext): Promise<void> {
  const detailPage = new AccountDetailPage(context);
  const patchDone = context.page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/accounts/') && response.request().method() === 'PATCH',
  );
  await detailPage.save();
  await patchDone;
}

/**
 * Returns true when the account detail page is in read mode (Edit button visible).
 */
export async function isAccountDetailLoaded(context: AccountsBehaviorContext): Promise<boolean> {
  const detailPage = new AccountDetailPage(context);
  return detailPage.isLoaded();
}

// ---------------------------------------------------------------------------
// AI churn/expansion signal banner (MINCRM-469)
// ---------------------------------------------------------------------------

/** Returns true when the churn-risk banner is currently visible. */
export async function isChurnRiskBannerVisible(context: AccountsBehaviorContext): Promise<boolean> {
  const detailPage = new AccountDetailPage(context);
  return detailPage.isChurnRiskBannerVisible();
}

/** Returns true when the expansion signal banner is currently visible. */
export async function isExpansionSignalBannerVisible(
  context: AccountsBehaviorContext,
): Promise<boolean> {
  const detailPage = new AccountDetailPage(context);
  return detailPage.isExpansionSignalBannerVisible();
}

// ---------------------------------------------------------------------------
// AI relationship health scoring (MINCRM-467)
// ---------------------------------------------------------------------------

/** Returns true when the relationship health badge is currently visible for an account. */
export async function isAccountHealthBadgeVisible(
  accountId: string,
  context: AccountsBehaviorContext,
): Promise<boolean> {
  const detailPage = new AccountDetailPage(context);
  return detailPage.isHealthBadgeVisible(accountId);
}

/**
 * Clicks the account detail page's "Export PDF" button and waits for the
 * underlying single-record export.pdf HTTP response, returning its status
 * and content-type. (MINCRM-650)
 *
 * Resolves at FIRST_INTERACTION_TIMEOUT_MS, not the healing locator's 2s
 * default: the button renders only under `csvExportEnabled`, and useFeatureFlag
 * fails closed, so until GET /api/v1/feature-flags/me resolves the control is
 * genuinely absent from the DOM. That query has been measured at ~3s under CI's
 * four concurrent workers, so a 2s probe gives up before the button can exist
 * and reports StrategyExhaustedError — indistinguishable from selector drift.
 * (MINCRM-703)
 */
export async function clickAccountExportPdfAndAwaitResponse(
  id: string,
  context: AccountsBehaviorContext,
): Promise<{ status: number; contentType: string }> {
  const detail = new AccountDetailPage(context);
  const responsePromise = context.page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/accounts/${id}/export.pdf`) &&
      response.request().method() === 'GET',
  );
  const button = await detail.exportPdfButtonLocator(FIRST_INTERACTION_TIMEOUT_MS);
  await button.click();
  const response = await responsePromise;
  return {
    status: response.status(),
    contentType: response.headers()['content-type'] ?? '',
  };
}
