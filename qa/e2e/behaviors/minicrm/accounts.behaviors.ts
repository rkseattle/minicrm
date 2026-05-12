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
import type { PageFacade } from '@framework/fixtures/index.js';
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
