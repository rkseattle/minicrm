/**
 * Contacts behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-130, MINCRM-110, MINCRM-138, MINCRM-357
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade, SafeLocator } from '@framework/fixtures/index.js';
import { ContactsPage } from '@pages/minicrm/ContactsPage.js';
import { ContactDetailPage } from '@pages/minicrm/ContactDetailPage.js';
import { EmailDraftPanelPage } from '@pages/minicrm/EmailDraftPanelPage.js';

// ---------------------------------------------------------------------------
// Browser-side evaluate functions
// These run inside page.evaluate() — must not reference Node.js globals.
// Written as plain function expressions to avoid TypeScript DOM type errors
// in the Node-targeted qa tsconfig (lib: ["ES2022"]).
// ---------------------------------------------------------------------------

/** Reads the current clipboard text via the browser's Clipboard API. (MINCRM-437) */
const READ_CLIPBOARD_TEXT = new Function(`
  return navigator.clipboard.readText();
`) as () => Promise<string>;

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by contacts behaviors. */
export interface ContactsBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// navigateToContacts()
// ---------------------------------------------------------------------------

/** Result returned by the navigateToContacts behavior. */
export interface NavigateToContactsResult {
  /**
   * True when the contacts page loaded successfully (New Contact button present).
   */
  loaded: boolean;
  /**
   * The URL the browser settled on after navigation.
   */
  finalUrl: string;
}

/**
 * Navigates to the contacts list page and waits for it to be ready.
 *
 * This is a read-only journey — it does not create, modify, or delete any
 * data. Returns a result object that the caller (test spec) asserts against.
 *
 * @param context - Playwright fixture context.
 * @returns NavigateToContactsResult describing the outcome.
 *
 * @example
 * ```ts
 * const result = await navigateToContacts({ page });
 * expect(result.loaded).toBe(true);
 * expect(result.finalUrl).toContain('/contacts');
 * ```
 */
export async function navigateToContacts(
  context: ContactsBehaviorContext,
): Promise<NavigateToContactsResult> {
  const contactsPage = new ContactsPage(context);

  await contactsPage.navigate();
  const loaded = await contactsPage.isLoaded();
  const finalUrl = contactsPage.url();

  return { loaded, finalUrl };
}

// ---------------------------------------------------------------------------
// waitForContactInList()
// ---------------------------------------------------------------------------

/**
 * Waits until a specific contact row is visible in the contacts list.
 *
 * Use this after navigateToContacts() when the contact was created via API
 * immediately before navigation — the list may still be loading when the
 * test tries to interact with a row.
 *
 * @param id - UUID of the contact to wait for.
 * @param context - Playwright fixture context.
 *
 * @example
 * ```ts
 * await navigateToContacts({ page });
 * await waitForContactInList(c1.id, { page });
 * await page.click([{ type: 'testId', value: `bulk-select-${c1.id}` }]);
 * ```
 */
export async function waitForContactInList(
  id: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.waitForContact(id);
}

// ---------------------------------------------------------------------------
// waitForBulkCheckbox()
// ---------------------------------------------------------------------------

/**
 * Waits until the bulk-select checkbox for a specific contact is attached to
 * the DOM. Call this immediately before clicking a bulk-select checkbox to
 * avoid the 2 s default HealingLocator probe expiring during a background
 * refetch.
 *
 * @param id - UUID of the contact whose checkbox to wait for.
 * @param context - Playwright fixture context.
 *
 * @example
 * ```ts
 * await waitForBulkCheckbox(c1.id, { page });
 * await page.click([{ type: 'testId', value: `bulk-select-${c1.id}` }]);
 * ```
 */
export async function waitForBulkCheckbox(
  id: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.waitForBulkCheckbox(id);
}

// ---------------------------------------------------------------------------
// clickBulkCheckbox()
// ---------------------------------------------------------------------------

/**
 * Clicks the bulk-select checkbox for a specific contact row.
 *
 * @param id - The contact UUID whose checkbox to click.
 * @param context - Playwright fixture context.
 */
export async function clickBulkCheckbox(
  id: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.clickBulkCheckbox(id);
}

// ---------------------------------------------------------------------------
// filterContactsByTerm()
// ---------------------------------------------------------------------------

/**
 * Types a search term into the contacts search box so only matching rows are
 * visible. Use this before selecting specific contacts to ensure they appear on
 * page 1 regardless of total data volume or sort order.
 *
 * @param term - The string to filter by (e.g. a unique email suffix).
 * @param context - Playwright fixture context.
 *
 * @example
 * ```ts
 * await filterContactsByTerm(uniqueSuffix, { page });
 * await waitForContactInList(c1.id, { page });
 * ```
 */
export async function filterContactsByTerm(
  term: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.search(term);
}

// ---------------------------------------------------------------------------
// editContact()
// ---------------------------------------------------------------------------

/**
 * Field changes accepted by editContact.
 * Keys map to ContactDetailPage field testIds and their label fallbacks.
 * Only supplied keys are filled — others are left as-is.
 */
export interface ContactChanges {
  first_name?: string;
  last_name?: string;
}

/** Result returned by the editContact behavior. */
export interface EditContactResult {
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
 * Navigates to a contact's detail page, enters edit mode, applies the supplied
 * field changes, and saves.
 *
 * Returns a result object — the caller (test spec) is responsible for assertions.
 *
 * @param id - Contact UUID.
 * @param changes - Fields to update.
 * @param context - Playwright fixture context.
 * @returns EditContactResult describing the outcome.
 *
 * @example
 * ```ts
 * const result = await editContact(contact.id, { first_name: 'Updated' }, { page });
 * expect(result.saved).toBe(true);
 * ```
 */
export async function editContact(
  id: string,
  changes: ContactChanges,
  context: ContactsBehaviorContext,
): Promise<EditContactResult> {
  const detailPage = new ContactDetailPage(context);

  await detailPage.navigate(id);
  await detailPage.clickEdit();

  // Fill only the supplied fields using their known testId + label pairs.
  const fieldMap: Record<keyof ContactChanges, [string, string]> = {
    first_name: ['contact-first-name', 'First name'],
    last_name: ['contact-last-name', 'Last name'],
  };
  for (const [key, [testId, label]] of Object.entries(fieldMap) as Array<
    [keyof ContactChanges, [string, string]]
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
// createContactViaUI()
// ---------------------------------------------------------------------------

/** Fields accepted by createContactViaUI. first_name, last_name, email are required. */
export interface CreateContactUIFields {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  title?: string;
  department?: string;
}

/** Result returned by createContactViaUI. */
export interface CreateContactViaUIResult {
  /**
   * True when the form submitted successfully (form is no longer visible,
   * New Contact button is back).
   */
  created: boolean;
  /**
   * True when a duplicate-contact warning (409) was surfaced instead of
   * creating the contact.
   */
  duplicateWarning: boolean;
  /**
   * True when the form stayed open with a validation error (e.g. missing
   * required field, invalid email format).
   */
  validationError: boolean;
  /** The URL the browser settled on after the operation. */
  finalUrl: string;
}

/**
 * Navigates to /contacts, opens the inline create form, fills the supplied
 * fields, and submits.
 *
 * Returns a result object describing the outcome — the caller asserts against it.
 *
 * @param fields - Form field values to fill.
 * @param context - Playwright fixture context.
 * @returns CreateContactViaUIResult.
 */
export async function createContactViaUI(
  fields: CreateContactUIFields,
  context: ContactsBehaviorContext,
): Promise<CreateContactViaUIResult> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.navigate();
  await contactsPage.clickNewContact();

  // Fill required fields via page object methods.
  await contactsPage.fillFirstName(fields.first_name);
  await contactsPage.fillLastName(fields.last_name);
  await contactsPage.fillEmail(fields.email);

  // Fill optional fields when provided.
  if (fields.phone !== undefined) {
    await contactsPage.fillPhone(fields.phone);
  }
  if (fields.title !== undefined) {
    await contactsPage.fillTitle(fields.title);
  }
  if (fields.department !== undefined) {
    await contactsPage.fillDepartment(fields.department);
  }

  // Submit the form.
  await contactsPage.submitCreateForm();

  // Short wait for network/React state to settle.
  await context.page.waitForLoadState('networkidle');

  const finalUrl = context.page.url();

  const duplicateWarning = await contactsPage.duplicateWarningIsVisible();
  const formStillVisible = await contactsPage.createFormIsVisible();

  // Created when form is gone and no duplicate warning.
  const created = !formStillVisible && !duplicateWarning;

  // Validation error = form still visible but no duplicate warning.
  const validationError = formStillVisible && !duplicateWarning;

  return { created, duplicateWarning, validationError, finalUrl };
}

// ---------------------------------------------------------------------------
// deleteContactViaUI()
// ---------------------------------------------------------------------------

/** Result returned by deleteContactViaUI. */
export interface DeleteContactViaUIResult {
  /**
   * True when the contact was deleted and the browser navigated back to /contacts.
   */
  deleted: boolean;
  /** The URL the browser settled on after the operation. */
  finalUrl: string;
}

/**
 * Navigates to a contact's detail page, clicks Delete, confirms the modal,
 * and waits for navigation back to /contacts.
 *
 * @param id - Contact UUID.
 * @param context - Playwright fixture context.
 * @returns DeleteContactViaUIResult.
 */
export async function deleteContactViaUI(
  id: string,
  context: ContactsBehaviorContext,
): Promise<DeleteContactViaUIResult> {
  const detailPage = new ContactDetailPage(context);
  await detailPage.navigate(id);

  await detailPage.clickDelete();
  await detailPage.confirmDelete();

  // Wait for navigation back to /contacts.
  await context.page.waitForURL('**/contacts', { timeout: 10_000 }).catch(() => null);
  await context.page.waitForLoadState('networkidle');

  const finalUrl = context.page.url();
  const deleted = new URL(finalUrl).pathname === '/contacts';

  return { deleted, finalUrl };
}

// ---------------------------------------------------------------------------
// cancelDeleteContact()
// ---------------------------------------------------------------------------

/** Result returned by cancelDeleteContact. */
export interface CancelDeleteContactResult {
  /** True when the contact detail page is still showing (deletion was cancelled). */
  stillOnDetailPage: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to a contact's detail page, clicks Delete, then clicks Cancel
 * in the confirmation modal without confirming.
 *
 * @param id - Contact UUID.
 * @param context - Playwright fixture context.
 * @returns CancelDeleteContactResult.
 */
export async function cancelDeleteContact(
  id: string,
  context: ContactsBehaviorContext,
): Promise<CancelDeleteContactResult> {
  const detailPage = new ContactDetailPage(context);
  await detailPage.navigate(id);

  await detailPage.clickDelete();
  await detailPage.cancelDelete();

  // Wait briefly for the modal close animation before checking state.
  await context.page.waitForTimeout(200);

  await context.page.waitForLoadState('networkidle');

  const finalUrl = context.page.url();
  // Still on the contact detail page if path matches /contacts/:id.
  const stillOnDetailPage = new URL(finalUrl).pathname === `/contacts/${id}`;

  return { stillOnDetailPage, finalUrl };
}

// ---------------------------------------------------------------------------
// cancelContactEdit()
// ---------------------------------------------------------------------------

/** Result returned by cancelContactEdit. */
export interface CancelContactEditResult {
  /** True when the detail page returned to read mode (edit button is back). */
  backToReadMode: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to a contact's detail page, enters edit mode, modifies a field,
 * then cancels — verifying the change was not persisted.
 *
 * @param id - Contact UUID.
 * @param fieldValue - A value typed into first_name before cancelling.
 * @param context - Playwright fixture context.
 * @returns CancelContactEditResult.
 */
export async function cancelContactEdit(
  id: string,
  fieldValue: string,
  context: ContactsBehaviorContext,
): Promise<CancelContactEditResult> {
  const detailPage = new ContactDetailPage(context);
  await detailPage.navigate(id);
  await detailPage.clickEdit();

  // Type something to make the cancel meaningful.
  await detailPage.fillField('contact-first-name', 'First name', fieldValue);

  await detailPage.cancelEdit();

  await context.page.waitForLoadState('networkidle');

  const backToReadMode = await detailPage.isLoaded();
  const finalUrl = detailPage.url();

  return { backToReadMode, finalUrl };
}

// ---------------------------------------------------------------------------
// searchContacts()
// ---------------------------------------------------------------------------

/** Result returned by searchContacts. */
export interface SearchContactsResult {
  /** Number of contact rows visible after the search settled. */
  rowCount: number;
  /** True when the empty-state placeholder is visible. */
  emptyStateVisible: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to /contacts, types a search term, and waits for results to settle.
 *
 * @param searchTerm - Text to type into the search input.
 * @param context - Playwright fixture context.
 * @returns SearchContactsResult.
 */
export async function searchContacts(
  searchTerm: string,
  context: ContactsBehaviorContext,
): Promise<SearchContactsResult> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.navigate();

  // search() fills the input and calls waitForLoadState('networkidle'), which
  // covers the debounce + network round-trip before the caller reads rowCount.
  await contactsPage.search(searchTerm);

  const rowCount = await contactsPage.rowCount();
  const emptyStateVisible = await contactsPage.emptyStateIsVisible();

  const finalUrl = contactsPage.url();

  return { rowCount, emptyStateVisible, finalUrl };
}

// ---------------------------------------------------------------------------
// contactRowIsVisible()
// ---------------------------------------------------------------------------

/** Result returned by contactRowIsVisible. */
export interface ContactRowIsVisibleResult {
  /** True when the contact row link is visible in the contacts list. */
  visible: boolean;
}

/**
 * Returns whether a contact row is currently visible in the contacts list.
 * Matches both desktop table links (contact-link-{id}) and mobile card links
 * (contact-card-link-{id}).
 *
 * @param id - Contact UUID.
 * @param context - Playwright fixture context.
 * @returns ContactRowIsVisibleResult.
 */
export async function contactRowIsVisible(
  id: string,
  context: ContactsBehaviorContext,
): Promise<ContactRowIsVisibleResult> {
  try {
    const contactsPage = new ContactsPage(context);
    await contactsPage.waitForContact(id);
    return { visible: true };
  } catch {
    return { visible: false };
  }
}

// ---------------------------------------------------------------------------
// openContactCreateForm()
// ---------------------------------------------------------------------------

/**
 * Navigates to /contacts and opens the inline contact creation form.
 * Use this before filling fields in tests that need to control form interaction
 * at a granular level (e.g. triggering HTML5 validation without waiting for
 * a network round-trip).
 *
 * @param context - Playwright fixture context.
 */
export async function openContactCreateForm(context: ContactsBehaviorContext): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.navigate();
  await contactsPage.clickNewContact();
}

// ---------------------------------------------------------------------------
// fillContactCreateForm()
// ---------------------------------------------------------------------------

/** Partial fields accepted by fillContactCreateForm. All fields optional. */
export interface PartialContactUIFields {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  department?: string;
}

/**
 * Fills any subset of the contact creation form fields.
 * The form must already be open (call openContactCreateForm first).
 * Does NOT submit the form.
 *
 * @param fields - Fields to fill; omitted fields are left unchanged.
 * @param context - Playwright fixture context.
 */
export async function fillContactCreateForm(
  fields: PartialContactUIFields,
  context: ContactsBehaviorContext,
): Promise<void> {
  const contactsPage = new ContactsPage(context);
  if (fields.first_name !== undefined) await contactsPage.fillFirstName(fields.first_name);
  if (fields.last_name !== undefined) await contactsPage.fillLastName(fields.last_name);
  if (fields.email !== undefined) await contactsPage.fillEmail(fields.email);
  if (fields.phone !== undefined) await contactsPage.fillPhone(fields.phone);
  if (fields.title !== undefined) await contactsPage.fillTitle(fields.title);
  if (fields.department !== undefined) await contactsPage.fillDepartment(fields.department);
}

// ---------------------------------------------------------------------------
// submitContactCreateFormAndWaitForValidation()
// ---------------------------------------------------------------------------

/** Result returned by submitContactCreateFormAndWaitForValidation. */
export interface SubmitContactFormValidationResult {
  /** True when the form is still visible (HTML5 validation prevented submission). */
  formStillVisible: boolean;
}

/**
 * Submits the contact creation form without waiting for networkidle.
 * Use this when testing HTML5 validation flows where no network request is
 * sent and networkidle would never fire (e.g. missing required field, invalid
 * email format). The form must already be open and filled.
 *
 * @param context - Playwright fixture context.
 * @returns SubmitContactFormValidationResult.
 */
export async function submitContactCreateFormAndWaitForValidation(
  context: ContactsBehaviorContext,
): Promise<SubmitContactFormValidationResult> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.submitCreateForm();
  const formStillVisible = await contactsPage.createFormIsVisible();
  return { formStillVisible };
}

/**
 * Clicks the submit button on the contact creation form.
 * Does NOT wait for a network round-trip or page state change — the caller is
 * responsible for any subsequent wait (e.g. `page.waitForLoadState('networkidle')`).
 *
 * Use this in error-state tests where a mock route is active and the caller
 * needs to verify behavior after the network response.
 *
 * @param context - Playwright fixture context.
 */
export async function submitContactCreateForm(context: ContactsBehaviorContext): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.submitCreateForm();
}

// ---------------------------------------------------------------------------
// sortContactsByName()
// ---------------------------------------------------------------------------

/** Result returned by sortContactsByName. */
export interface SortContactsByNameResult {
  /** True when the sort button was found and clicked (desktop only). */
  sortClicked: boolean;
}

/**
 * Clicks the "First name" column sort header on the contacts list (desktop only).
 * On mobile viewports where the header is absent, returns sortClicked: false.
 *
 * @param context - Playwright fixture context.
 * @returns SortContactsByNameResult.
 */
export async function sortContactsByName(
  context: ContactsBehaviorContext,
): Promise<SortContactsByNameResult> {
  const contactsPage = new ContactsPage(context);
  const sortClicked = await contactsPage.clickSortByName();
  return { sortClicked };
}

// ---------------------------------------------------------------------------
// bulkReassignContacts()
// ---------------------------------------------------------------------------

/**
 * Opens the bulk-reassign modal from the contacts bulk action bar, selects the
 * given owner, and confirms. Assumes at least one contact is already selected
 * (bulk action bar is visible).
 *
 * @param ownerId - UUID of the owner to assign.
 * @param ownerLabel - Display label of the owner option (shown in the dropdown).
 * @param context - Playwright fixture context.
 */
export async function bulkReassignContacts(
  ownerId: string,
  ownerLabel: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.clickBulkReassign();
  await contactsPage.selectBulkReassignOwner(ownerId, ownerLabel);
  await contactsPage.confirmBulkReassign();
}

// ---------------------------------------------------------------------------
// bulkDeleteContacts()
// ---------------------------------------------------------------------------

/**
 * Opens the bulk-delete confirmation modal from the contacts bulk action bar
 * and confirms deletion. Assumes at least one contact is already selected
 * (bulk action bar is visible).
 *
 * @param context - Playwright fixture context.
 * @param force - When true, uses force:true on the delete and confirm clicks.
 *   Pass true in error-state tests where mock routes cause overlay/scroll issues.
 * @param deletedIds - Optional list of contact IDs whose rows must disappear from
 *   the DOM before this call returns. Passing these ids serializes: server DELETE
 *   committed → React re-render removes rows → then caller may verify via API.
 */
export async function bulkDeleteContacts(
  context: ContactsBehaviorContext,
  force = false,
  deletedIds: string[] = [],
): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.clickBulkDelete();
  await contactsPage.confirmBulkDelete(force);
  if (deletedIds.length > 0) {
    await contactsPage.waitForContactsRemovedFromList(deletedIds);
  }
}

// ---------------------------------------------------------------------------
// API data-fetch helpers (MINCRM-357)
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/v1/contacts/:id. */
export interface ContactRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  account_id: string | null;
  /** Optimistic lock version (MINCRM-349). */
  version: number;
}

/** Shape of paginated contact list rows from GET /api/v1/contacts. */
export interface ContactListRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * Creates a contact via the API and returns the created record.
 *
 * @param restClient - Authenticated RestClient.
 * @param params - Contact fields.
 * @returns The created contact record.
 */
export async function createContactViaApi(
  restClient: RestClient,
  params: {
    first_name: string;
    last_name?: string;
    email?: string;
    account_id?: string;
    owner_id?: string;
  },
): Promise<ContactRow> {
  const res = await restClient.post<{ contact: ContactRow }>('/api/v1/contacts', params);
  return res.body.contact;
}

/**
 * Fetches a single contact by ID from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @returns The contact record.
 */
export async function getContactById(
  restClient: RestClient,
  contactId: string,
): Promise<ContactRow> {
  const res = await restClient.get<{ contact: ContactRow }>(`/api/v1/contacts/${contactId}`);
  return res.body.contact;
}

/**
 * Searches for contacts matching the given query and returns the list.
 *
 * @param restClient - Authenticated RestClient.
 * @param search - Search term (URL-encoded internally).
 * @returns Object with total count and data array.
 */
export async function searchContactsViaApi(
  restClient: RestClient,
  search: string,
): Promise<{ total: number; data: ContactListRow[] }> {
  const res = await restClient.get<{ data: ContactListRow[]; total: number }>(
    `/api/v1/contacts?search=${encodeURIComponent(search)}`,
  );
  return { total: res.body.total, data: res.body.data };
}

/**
 * Fetches the deals linked to a contact.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @returns Array of linked deal IDs.
 */
export async function getContactDeals(
  restClient: RestClient,
  contactId: string,
): Promise<Array<{ id: string }>> {
  const res = await restClient.get<{ deals: Array<{ id: string }> }>(
    `/api/v1/contacts/${contactId}/deals`,
  );
  return res.body.deals;
}

/**
 * Patches a contact's account association.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @param accountId - Account UUID to link, or null to unlink.
 * @param version - Current optimistic-lock version.
 */
export async function patchContactAccount(
  restClient: RestClient,
  contactId: string,
  accountId: string | null,
  version: number,
): Promise<void> {
  await restClient.patch(`/api/v1/contacts/${contactId}`, { account_id: accountId, version });
}

/**
 * Deletes a contact by ID via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @returns The HTTP status code.
 */
export async function deleteContact(restClient: RestClient, contactId: string): Promise<number> {
  const res = await restClient.delete(`/api/v1/contacts/${contactId}`);
  return res.status;
}

/**
 * Fetches a paginated, optionally sorted contacts list from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param options - Query parameters (search, sort, dir, limit, page).
 * @returns Object with data array and total count.
 */
export async function listContactsViaApi(
  restClient: RestClient,
  options: {
    owner?: 'me' | 'my_team';
    search?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
    limit?: number;
    page?: number;
  } = {},
): Promise<{ total: number; data: ContactListRow[] }> {
  const params = new URLSearchParams();
  if (options.owner) params.set('owner', options.owner);
  if (options.search) params.set('search', options.search);
  if (options.sort) params.set('sort', options.sort);
  if (options.dir) params.set('dir', options.dir);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.page !== undefined) params.set('page', String(options.page));
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await restClient.get<{ data: ContactListRow[]; total: number }>(
    `/api/v1/contacts${query}`,
  );
  return { total: res.body.total, data: res.body.data };
}

/**
 * Patches arbitrary fields on a contact via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @param patch - Fields to update (must include version for optimistic locking).
 * @returns The updated contact record.
 */
export async function patchContact(
  restClient: RestClient,
  contactId: string,
  patch: Partial<ContactRow> & { version: number },
): Promise<ContactRow> {
  const res = await restClient.patch<{ contact: ContactRow }>(
    `/api/v1/contacts/${contactId}`,
    patch,
  );
  return res.body.contact;
}

// ---------------------------------------------------------------------------
// Locator-accessor behaviors — wrap ContactDetailPage / ContactsPage locators
// so spec files never import @pages/* directly. (MINCRM-367)
// ---------------------------------------------------------------------------

/**
 * Returns a resolved locator for the account link on the contact detail page.
 */
export async function getContactAccountLink(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.accountLinkLocator();
}

/** Asserts the contact not-found back-to-contacts link is visible. */
export async function expectContactNotFoundBackLinkVisible(
  context: ContactsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new ContactDetailPage(context).notFoundBackLinkLocator();
  await expect(locator).toBeVisible();
}

/**
 * Navigates directly to a contact detail URL by ID and waits for the
 * not-found error state to render.
 *
 * Use domcontentloaded so navigation completes before the API response arrives;
 * the not-found UI only renders after React receives the 404 and transitions
 * from isLoading to isError, so we poll for the alert element's presence.
 *
 * @param id - Contact UUID (may be non-existent to trigger the 404 state).
 * @param context - Playwright fixture context.
 */
export async function navigateToContactNotFound(
  id: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  await context.page.goto(`/contacts/${id}`, { waitUntil: 'domcontentloaded' });
  await context.page.waitForPresent('p[role="alert"]');
}

/** Asserts the Edit button is visible on the contact detail page. */
export async function expectContactEditButtonVisible(
  context: ContactsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new ContactDetailPage(context).editButtonLocator();
  await expect(locator).toBeVisible();
}

/** Asserts the pagination container is visible on the contacts list page. */
export async function expectContactsPaginationVisible(
  context: ContactsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new ContactsPage(context).paginationLocator();
  await expect(locator).toBeVisible();
}

/** Waits for the bulk action bar to become visible, with an optional timeout (ms). */
export async function waitForContactsBulkActionBar(
  context: ContactsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const locator = await new ContactsPage(context).bulkActionBarLocator();
  await locator.waitFor({ state: 'visible', ...(timeout !== undefined ? { timeout } : {}) });
}

/** Waits for the bulk error banner to attach and asserts it is visible. */
export async function waitForContactsBulkError(
  context: ContactsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new ContactsPage(context).bulkErrorLocator();
  await locator.waitFor({ state: 'attached', ...(timeout !== undefined ? { timeout } : {}) });
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts a contact row link is visible by contact ID, with an optional timeout (ms). */
export async function expectContactRowVisible(
  id: string,
  context: ContactsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new ContactsPage(context).contactLinkLocator(id);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/**
 * Returns whether the duplicate-email warning is currently visible.
 */
export async function getContactsDuplicateWarningVisible(
  context: ContactsBehaviorContext,
): Promise<boolean> {
  const contactsPage = new ContactsPage(context);
  return contactsPage.duplicateWarningIsVisible();
}

/**
 * Returns a resolved locator for the loading indicator on the contacts page.
 */
export async function getContactsLoadingIndicator(context: ContactsBehaviorContext) {
  const contactsPage = new ContactsPage(context);
  return contactsPage.loadingIndicatorLocator();
}

/** Waits for the send email button to become visible. */
export async function waitForContactSendEmailButton(
  context: ContactsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const locator = await new ContactDetailPage(context).sendEmailButtonLocator();
  await locator.waitFor({ state: 'visible', ...(timeout !== undefined ? { timeout } : {}) });
}

/** Returns true when the send email button is visible. */
export async function isContactSendEmailButtonVisible(
  context: ContactsBehaviorContext,
): Promise<boolean> {
  const locator = await new ContactDetailPage(context).sendEmailButtonLocator();
  return locator.isVisible();
}

/** Waits for the send email modal to detach (auto-close after submission). */
export async function waitForContactSendEmailModalDetached(
  context: ContactsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const locator = await new ContactDetailPage(context).sendEmailModalLocator();
  await locator.waitFor({ state: 'detached', ...(timeout !== undefined ? { timeout } : {}) });
}

/** Waits for the send email success message to become visible and returns its text. */
export async function waitForContactSendEmailSuccessAndGetText(
  context: ContactsBehaviorContext,
  timeout?: number,
): Promise<string> {
  const locator = await new ContactDetailPage(context).sendEmailSuccessLocator();
  await locator.waitFor({ state: 'visible', ...(timeout !== undefined ? { timeout } : {}) });
  return (await locator.textContent()) ?? '';
}

/**
 * Opens the send email modal, fills subject and body, then submits.
 */
export async function sendEmailFromContact(
  subject: string,
  body: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const detailPage = new ContactDetailPage(context);
  await detailPage.clickSendEmail();
  await detailPage.fillSendEmailSubject(subject);
  await detailPage.fillSendEmailBody(body);
  await detailPage.submitSendEmail();
}

/**
 * Returns a resolved locator for the custom fields read grid on a contact detail page.
 */
export async function getContactCustomFieldsReadGrid(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.customFieldsReadGridLocator();
}

/**
 * Returns a resolved locator for the custom fields edit grid on a contact detail page.
 */
export async function getContactCustomFieldsEditGrid(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.customFieldsEditGridLocator();
}

/** Clicks the Edit button on the contact detail page. */
export async function clickContactEdit(context: ContactsBehaviorContext): Promise<void> {
  const detailPage = new ContactDetailPage(context);
  await detailPage.clickEdit();
}

/** Clicks Save on the contact detail page edit form. */
export async function saveContact(context: ContactsBehaviorContext): Promise<void> {
  const detailPage = new ContactDetailPage(context);
  // Register listener before clicking so the PATCH is always captured even if
  // the server responds before the next await resolves. (MINCRM-418)
  // No status filter — callers such as concurrency tests deliberately trigger
  // 409 responses and must handle the outcome themselves after this returns.
  const patchDone = context.page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/contacts/') && response.request().method() === 'PATCH',
  );
  await detailPage.save();
  await patchDone;
}

/** Returns true when the contact detail page is in read mode (edit button visible). */
export async function isContactDetailLoaded(context: ContactsBehaviorContext): Promise<boolean> {
  const detailPage = new ContactDetailPage(context);
  return detailPage.isLoaded();
}

/**
 * Waits until the contact detail page is in read mode (edit button visible).
 * Use after saveContact() when the caller needs the page to be out of edit mode
 * before continuing — e.g. before reloading or reading the persisted state.
 *
 * @param timeout - Maximum ms to wait.
 */
export async function waitForContactDetailReadMode(
  context: ContactsBehaviorContext,
  timeout = 8_000,
): Promise<void> {
  await context.page.waitForFunction(
    `document.querySelector('[data-testid="edit-contact-button"]') !== null`,
    undefined,
    { timeout },
  );
}

/** Waits for the attachments section to appear on the contact detail page. */
export async function waitForContactAttachmentsSection(
  context: ContactsBehaviorContext,
): Promise<void> {
  const locator = await new ContactDetailPage(context).attachmentsSectionLocator();
  await locator?.waitFor({ state: 'visible' });
}

/** Uploads a file via the contact detail page attachments file input. */
export async function uploadContactAttachment(
  context: ContactsBehaviorContext,
  file: Parameters<SafeLocator['setInputFiles']>[0],
): Promise<void> {
  const locator = await new ContactDetailPage(context).attachmentsFileInputLocator();
  await locator.setInputFiles(file);
}

/** Waits for the attachments list to become visible on the contact detail page. */
export async function waitForContactAttachmentsList(
  context: ContactsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const locator = await new ContactDetailPage(context).attachmentsListLocator();
  await locator?.waitFor({ state: 'visible', ...(timeout !== undefined ? { timeout } : {}) });
}

/** Clicks the delete button for a specific attachment on the contact detail page. */
export async function clickContactAttachmentDelete(
  attachmentId: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const locator = await new ContactDetailPage(context).attachmentDeleteLocator(attachmentId);
  await locator.click();
}

/** Waits for the upload error to become visible on the contact detail page. */
export async function waitForContactAttachmentsUploadError(
  context: ContactsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const locator = await new ContactDetailPage(context).attachmentsUploadErrorLocator();
  await locator.waitFor({ state: 'visible', ...(timeout !== undefined ? { timeout } : {}) });
}

/**
 * Confirms deletion in the attachment delete confirmation dialog on the contact detail page.
 */
export async function confirmContactAttachmentDelete(
  context: ContactsBehaviorContext,
): Promise<void> {
  const detailPage = new ContactDetailPage(context);
  await detailPage.confirmAttachmentDelete();
}

// ---------------------------------------------------------------------------
// ContactsPage thin-wrapper behaviors (MINCRM-367)
// ---------------------------------------------------------------------------

/**
 * Clicks the New Contact button to open the create form.
 */
export async function clickNewContact(context: ContactsBehaviorContext): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.clickNewContact();
}

/**
 * Submits the contact create form.
 */
export async function submitContactCreateFormAction(
  context: ContactsBehaviorContext,
): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.submitCreateForm();
}

/** Asserts the contact create form is visible. */
export async function expectContactsCreateFormVisible(
  context: ContactsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new ContactsPage(context).createFormLocator();
  await expect(locator).toBeVisible();
}

/** Asserts the first-name input in the create form has the given value. */
export async function expectContactsFirstNameInputHasValue(
  value: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new ContactsPage(context).firstNameInputLocator();
  await expect(locator).toHaveValue(value);
}

/**
 * Clicks the bulk-delete button on the contacts list.
 */
export async function clickContactsBulkDelete(context: ContactsBehaviorContext): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.clickBulkDelete();
}

/** Waits for the confirm-delete modal to become visible on the contacts list. */
export async function waitForContactsConfirmDeleteModal(
  context: ContactsBehaviorContext,
): Promise<void> {
  const locator = await new ContactsPage(context).confirmDeleteModalLocator();
  await locator.waitFor({ state: 'visible' });
}

/**
 * Cancels a bulk delete by dismissing the confirmation dialog.
 */
export async function cancelContactsBulkDelete(context: ContactsBehaviorContext): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.cancelBulkDelete();
}

/**
 * Clicks the bulk-reassign button on the contacts list.
 */
export async function clickContactsBulkReassign(context: ContactsBehaviorContext): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.clickBulkReassign();
}

/** Waits for the bulk-reassign modal to become visible on the contacts list. */
export async function waitForContactsBulkReassignModal(
  context: ContactsBehaviorContext,
): Promise<void> {
  const locator = await new ContactsPage(context).bulkReassignModalLocator();
  await locator.waitFor({ state: 'visible' });
}

/**
 * Cancels the bulk-reassign modal without reassigning.
 */
export async function cancelContactsBulkReassign(context: ContactsBehaviorContext): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.cancelBulkReassign();
}

/** Asserts a contact link is visible in the contacts list by contact ID. */
export async function expectContactsContactLinkVisible(
  contactId: string,
  context: ContactsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new ContactsPage(context).contactLinkLocator(contactId);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/**
 * Navigates to the contact detail page for the given contact ID.
 */
export async function navigateToContactDetail(
  contactId: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const detailPage = new ContactDetailPage(context);
  await detailPage.navigate(contactId);
}

/**
 * Fills a field in the contact edit form.
 *
 * @param testId - data-testid of the input field.
 * @param label - i18n label used as fallback strategy.
 * @param value - Value to type.
 */
export async function fillContactDetailField(
  testId: string,
  label: string,
  value: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const detailPage = new ContactDetailPage(context);
  await detailPage.fillField(testId, label, value);
}

/**
 * Navigates to the contacts list pre-filtered to the current user's records
 * (owner=me) and waits for the page to reach networkidle.
 *
 * Used by layout tests that need an empty-state to appear immediately without
 * relying on the owner-filter UI controls loading first.
 */
export async function navigateToContactsOwnedByMe(context: ContactsBehaviorContext): Promise<void> {
  await context.page.goto('/contacts?owner=me', { waitUntil: 'networkidle' });
}

// ---------------------------------------------------------------------------
// Visibility check helpers — keep page.isNotVisible() / doesNotExist() out of
// spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Returns true when the bulk-action bar is absent or hidden.
 * Used after bulk operations to confirm the bar has been dismissed.
 */
export async function isBulkActionBarHidden(context: ContactsBehaviorContext): Promise<boolean> {
  return context.page.isNotVisible([{ type: 'testId', value: 'bulk-action-bar' }]);
}

/**
 * Navigates to the contacts list using domcontentloaded wait (not networkidle).
 * Use when the test intentionally intercepts requests that would delay networkidle.
 */
export async function navigateToContactsDomReady(context: ContactsBehaviorContext): Promise<void> {
  await context.page.goto('/contacts', { waitUntil: 'domcontentloaded' });
}

/**
 * Returns true when no aria-busy element is present or visible.
 * Used to assert that the loading indicator has gone away.
 */
export async function isLoadingIndicatorGone(context: ContactsBehaviorContext): Promise<boolean> {
  return context.page.isNotVisible([
    { type: 'css', value: '[aria-busy="true"]' },
    { type: 'css', value: 'p[aria-busy]' },
  ]);
}

// ---------------------------------------------------------------------------
// GDPR erasure flow — keep page.waitFor/click/fill out of spec files.
// (MINCRM-418)
// ---------------------------------------------------------------------------

/** Result returned by performGdprErasure. */
export interface GdprErasureResult {
  /** True when the erasure modal was dismissed (hidden) after submission. */
  modalDismissed: boolean;
}

/**
 * Waits for the GDPR privacy section, clicks Erase, fills the confirmation
 * word, submits, and waits for the modal to be dismissed.
 *
 * @param confirmWord - The word the user must type to enable the submit button (e.g. 'ERASE').
 * @param context - Behavior context with page.
 */
export async function performGdprErasure(
  confirmWord: string,
  context: ContactsBehaviorContext,
): Promise<GdprErasureResult> {
  await context.page.waitFor(
    [
      { type: 'testId', value: 'gdpr-privacy-section' },
      { type: 'role', value: 'region', options: { name: /gdpr/i } },
    ],
    'visible',
    { intent: 'GDPR privacy section on contact detail page' },
  );

  await context.page.click(
    [
      { type: 'testId', value: 'gdpr-erase-button' },
      { type: 'role', value: 'button', options: { name: /erase personal data/i } },
    ],
    { intent: 'button to open GDPR erasure confirmation modal' },
  );

  // gdpr-erase-modal-overlay (the fixed backdrop div) is listed first because
  // mobile Chrome's UA stylesheet can affect <dialog> element visibility
  // detection even when the element is rendered (MINCRM-554).
  await context.page.waitFor(
    [
      { type: 'testId', value: 'gdpr-erase-modal-overlay' },
      { type: 'testId', value: 'gdpr-erase-modal' },
      { type: 'role', value: 'dialog', options: { name: /erase/i } },
    ],
    'visible',
    { intent: 'GDPR erasure confirmation modal' },
  );

  await context.page.fill(
    confirmWord,
    [
      { type: 'testId', value: 'gdpr-erase-confirm-input' },
      { type: 'role', value: 'textbox', options: { name: /type erase/i } },
    ],
    { intent: 'confirmation input that accepts ERASE to enable the submit button' },
  );

  await context.page.click(
    [
      { type: 'testId', value: 'gdpr-erase-confirm-button' },
      { type: 'role', value: 'button', options: { name: /confirm.*erase/i } },
    ],
    { intent: 'confirm button that submits the GDPR erasure request' },
  );

  // isNotVisible() handles the race where the server responds fast enough that
  // the modal is already dismissed before this line runs. waitFor('hidden')
  // calls resolve() first, which throws StrategyExhaustedError when the element
  // is absent. isNotVisible() uses Playwright's native waitFor({state:'hidden'})
  // which treats absence as immediate success — no StrategyExhaustedError.
  // 30s budget: the erasure API deletes data server-side and can be slow under CI load.
  await context.page.isNotVisible(
    [
      { type: 'testId', value: 'gdpr-erase-modal-overlay' },
      { type: 'testId', value: 'gdpr-erase-modal' },
    ],
    30_000,
  );

  return { modalDismissed: true };
}

/** Asserts the contact name heading is visible on the detail page. */
export async function expectContactNameVisible(context: ContactsBehaviorContext): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'contact-name' },
        { type: 'role', value: 'heading', options: { level: 1 } },
      ],
      { intent: 'contact name heading on the detail page' },
    )
    .resolve();
  await expect(locator).toBeVisible();
}

/** Asserts the contact name heading contains the given text. */
export async function expectContactNameContainsText(
  text: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'contact-name' },
        { type: 'role', value: 'heading', options: { level: 1 } },
      ],
      { intent: 'contact name heading on the detail page' },
    )
    .resolve();
  await expect(locator).toContainText(text);
}

/** Asserts the contact not-found alert is visible, with an optional timeout (ms). */
export async function expectContactNotFoundVisible(
  context: ContactsBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detailPage = new ContactDetailPage(context);
  const locator = await detailPage.notFoundAlertLocator(timeout);
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Returns the text content of the email field on the contact detail page. */
export async function getContactEmailFieldText(context: ContactsBehaviorContext): Promise<string> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'detail-email' },
        { type: 'css', value: '[data-testid="detail-email"]' },
      ],
      { intent: 'email value field on the contact detail page' },
    )
    .resolve();
  return (await locator.textContent()) ?? '';
}

// ---------------------------------------------------------------------------
// Owner-filter UI behaviors (MINCRM-545)
// ---------------------------------------------------------------------------

/**
 * Navigates to the contacts list filtered by the given owner value.
 * Waits for the page to reach networkidle before returning.
 *
 * @param context - Playwright fixture context.
 * @param owner - Owner filter value to set in the URL.
 */
export async function navigateToContactsWithOwnerFilter(
  context: ContactsBehaviorContext,
  owner: 'me' | 'my_team' | 'all',
): Promise<void> {
  const param = owner === 'all' ? '' : `?owner=${owner}`;
  await context.page.goto(`/contacts${param}`, { waitUntil: 'networkidle' });
}

/**
 * Clicks the "My Team" button in the three-way owner filter toggle on the
 * contacts list and waits for the URL to update to ?owner=my_team.
 *
 * @param context - Playwright fixture context.
 */
export async function clickMyTeamOwnerFilter(context: ContactsBehaviorContext): Promise<void> {
  await context.page.click(
    [
      { type: 'testId', value: 'filter-owner-my-team' },
      { type: 'role', value: 'button', options: { name: /my team/i } },
    ],
    { intent: 'My Team button in the three-way owner filter toggle on contacts list' },
  );
  await context.page.waitForURL(/owner=my_team/);
}

/**
 * Clicks the "All" button in the three-way owner filter toggle on the contacts
 * list and waits for the ?owner URL param to be cleared.
 *
 * @param context - Playwright fixture context.
 */
export async function clickAllOwnerFilter(context: ContactsBehaviorContext): Promise<void> {
  await context.page.click(
    [
      { type: 'testId', value: 'filter-owner-all' },
      { type: 'role', value: 'button', options: { name: /all/i } },
    ],
    { intent: 'All button in the owner filter toggle to clear owner scoping on contacts list' },
  );
  await context.page.waitForURL((url) => !new URL(url).searchParams.has('owner'));
}

/**
 * Returns the current URL of the contacts page. Use this after interacting
 * with the owner filter toggle to assert the ?owner param state.
 *
 * @param context - Playwright fixture context.
 */
export function getContactsPageUrl(context: ContactsBehaviorContext): string {
  return context.page.url();
}

// ---------------------------------------------------------------------------
// AI champion/blocker detection (MINCRM-466)
// ---------------------------------------------------------------------------

/** Returns true when the champion/blocker badge is currently visible for a contact. */
export async function isChampionBlockerBadgeVisible(
  contactId: string,
  context: ContactsBehaviorContext,
): Promise<boolean> {
  const detail = new ContactDetailPage(context);
  return detail.isChampionBlockerBadgeVisible(contactId);
}

// ---------------------------------------------------------------------------
// AI email draft generation (MINCRM-437)
// ---------------------------------------------------------------------------

/** Result returned by draftEmailFromContactDetail. */
export interface DraftEmailResult {
  /** HTTP status code returned by POST /contacts/:id/email-draft. */
  status: number;
}

/**
 * Clicks the "Draft Email" button on the contact detail page and waits for
 * the email-draft POST to resolve. Registers the response wait before
 * clicking so a fast server response is never missed. Does not assert —
 * callers branch on `status` per the network-response-first pattern
 * (MINCRM-418).
 */
export async function draftEmailFromContactDetail(
  context: ContactsBehaviorContext,
): Promise<DraftEmailResult> {
  const detail = new ContactDetailPage(context);

  const responseReceived = context.page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('/email-draft'),
    { timeout: 30_000 },
  );
  await detail.clickDraftEmail();
  const response = await responseReceived;

  return { status: response.status() };
}

/** Returns true when the "Draft Email" button is currently visible on the contact detail page. */
export async function isDraftEmailButtonVisible(
  context: ContactsBehaviorContext,
): Promise<boolean> {
  const detail = new ContactDetailPage(context);
  return detail.isDraftEmailButtonVisible();
}

/** Returns the current values of the email draft panel's subject and body fields. */
export async function getEmailDraftPanelValues(
  context: ContactsBehaviorContext,
): Promise<{ subject: string; body: string }> {
  const panel = new EmailDraftPanelPage(context);
  const [subjectLocator, bodyLocator] = await Promise.all([
    panel.subjectInputLocator(),
    panel.bodyInputLocator(),
  ]);
  const [subject, body] = await Promise.all([
    subjectLocator.inputValue(),
    bodyLocator.inputValue(),
  ]);
  return { subject, body };
}

/** Selects a tone in the email draft panel, triggering a regeneration. */
export async function selectEmailDraftTone(
  tone: string,
  context: ContactsBehaviorContext,
): Promise<void> {
  const panel = new EmailDraftPanelPage(context);
  await panel.selectTone(tone);
}

/** Clicks the copy-to-clipboard button in the email draft panel. */
export async function copyEmailDraftToClipboard(context: ContactsBehaviorContext): Promise<void> {
  const panel = new EmailDraftPanelPage(context);
  await panel.clickCopyToClipboard();
}

/** Reads the current clipboard text via the browser's Clipboard API. */
export async function readClipboardText(context: ContactsBehaviorContext): Promise<string> {
  return context.page.evaluate(READ_CLIPBOARD_TEXT);
}

/** Clicks the dismiss button in the email draft panel. */
export async function dismissEmailDraftPanel(context: ContactsBehaviorContext): Promise<void> {
  const panel = new EmailDraftPanelPage(context);
  await panel.clickDismiss();
}

/** Returns true when the email draft panel is currently visible. */
export async function isEmailDraftPanelVisible(context: ContactsBehaviorContext): Promise<boolean> {
  const present = await context.page
    .waitForPresent('[data-testid="email-draft-panel"]', 500)
    .then(() => true)
    .catch(() => false);
  if (!present) return false;
  const panel = new EmailDraftPanelPage(context);
  const locator = await panel.panelLocator();
  return locator.isVisible().catch(() => false);
}
