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
import type { PageFacade } from '@framework/fixtures/index.js';
import { ContactsPage } from '@pages/minicrm/ContactsPage.js';
import { ContactDetailPage } from '@pages/minicrm/ContactDetailPage.js';

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
 */
export async function bulkDeleteContacts(
  context: ContactsBehaviorContext,
  force = false,
): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.clickBulkDelete();
  await contactsPage.confirmBulkDelete(force);
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
    search?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
    limit?: number;
    page?: number;
  } = {},
): Promise<{ total: number; data: ContactListRow[] }> {
  const params = new URLSearchParams();
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

/**
 * Returns a resolved locator for the contact name heading on the detail page.
 */
export async function getContactNameLocator(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.contactNameLocator();
}

/**
 * Returns a resolved locator for the "not found" alert on a contact detail page.
 * @param timeout - Optional timeout passed to the locator.
 */
export async function getContactNotFoundLocator(
  context: ContactsBehaviorContext,
  timeout?: number,
) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.notFoundAlertLocator(timeout);
}

/**
 * Returns a resolved locator for the "back to contacts" link on the 404 page.
 */
export async function getContactNotFoundBackLink(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.notFoundBackLinkLocator();
}

/**
 * Returns a resolved locator for the Edit button on the contact detail page.
 */
export async function getContactEditButtonLocator(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.editButtonLocator();
}

/**
 * Returns a resolved locator for the pagination container on the contacts list page.
 */
export async function getContactsPaginationLocator(context: ContactsBehaviorContext) {
  const contactsPage = new ContactsPage(context);
  return contactsPage.paginationLocator();
}

/**
 * Returns a resolved locator for the bulk action bar on the contacts list page.
 */
export async function getContactsBulkActionBarLocator(context: ContactsBehaviorContext) {
  const contactsPage = new ContactsPage(context);
  return contactsPage.bulkActionBarLocator();
}

/**
 * Returns a resolved locator for the bulk operation error banner.
 */
export async function getContactsBulkErrorLocator(context: ContactsBehaviorContext) {
  const contactsPage = new ContactsPage(context);
  return contactsPage.bulkErrorLocator();
}

/**
 * Returns a resolved locator for a contact row link by contact ID.
 */
export async function getContactRowLocator(id: string, context: ContactsBehaviorContext) {
  const contactsPage = new ContactsPage(context);
  return contactsPage.contactLinkLocator(id);
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

/**
 * Returns a resolved locator for the send email button on a contact detail page.
 */
export async function getContactSendEmailButtonLocator(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.sendEmailButtonLocator();
}

/**
 * Returns a resolved locator for the send email compose modal.
 */
export async function getContactSendEmailModalLocator(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.sendEmailModalLocator();
}

/**
 * Returns a resolved locator for the send email success message.
 */
export async function getContactSendEmailSuccessLocator(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.sendEmailSuccessLocator();
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
  await detailPage.save();
}

/** Returns true when the contact detail page is in read mode (edit button visible). */
export async function isContactDetailLoaded(context: ContactsBehaviorContext): Promise<boolean> {
  const detailPage = new ContactDetailPage(context);
  return detailPage.isLoaded();
}

/**
 * Returns a resolved locator for the attachments section on the contact detail page.
 */
export async function getContactAttachmentsSectionLocator(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.attachmentsSectionLocator();
}

/**
 * Returns a resolved locator for the attachments file input on the contact detail page.
 */
export async function getContactAttachmentsFileInputLocator(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.attachmentsFileInputLocator();
}

/**
 * Returns a resolved locator for the attachments list on the contact detail page.
 */
export async function getContactAttachmentsListLocator(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.attachmentsListLocator();
}

/**
 * Returns a resolved locator for an attachment's delete button by attachment ID.
 */
export async function getContactAttachmentDeleteLocator(
  attachmentId: string,
  context: ContactsBehaviorContext,
) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.attachmentDeleteLocator(attachmentId);
}

/**
 * Returns a resolved locator for the attachments upload error on the contact detail page.
 */
export async function getContactAttachmentsUploadErrorLocator(context: ContactsBehaviorContext) {
  const detailPage = new ContactDetailPage(context);
  return detailPage.attachmentsUploadErrorLocator();
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

/**
 * Returns a resolved locator for the contact create form.
 */
export async function getContactsCreateFormLocator(context: ContactsBehaviorContext) {
  const contactsPage = new ContactsPage(context);
  return contactsPage.createFormLocator();
}

/**
 * Returns a resolved locator for the first-name input in the contact create form.
 */
export async function getContactsFirstNameInputLocator(context: ContactsBehaviorContext) {
  const contactsPage = new ContactsPage(context);
  return contactsPage.firstNameInputLocator();
}

/**
 * Clicks the bulk-delete button on the contacts list.
 */
export async function clickContactsBulkDelete(context: ContactsBehaviorContext): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.clickBulkDelete();
}

/**
 * Returns a resolved locator for the confirm-delete modal on the contacts list.
 */
export async function getContactsConfirmDeleteModalLocator(context: ContactsBehaviorContext) {
  const contactsPage = new ContactsPage(context);
  return contactsPage.confirmDeleteModalLocator();
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

/**
 * Returns a resolved locator for the bulk-reassign modal on the contacts list.
 */
export async function getContactsBulkReassignModalLocator(context: ContactsBehaviorContext) {
  const contactsPage = new ContactsPage(context);
  return contactsPage.bulkReassignModalLocator();
}

/**
 * Cancels the bulk-reassign modal without reassigning.
 */
export async function cancelContactsBulkReassign(context: ContactsBehaviorContext): Promise<void> {
  const contactsPage = new ContactsPage(context);
  await contactsPage.cancelBulkReassign();
}

/**
 * Returns a resolved locator for a contact link in the contacts list by contact ID.
 */
export async function getContactsContactLinkLocator(
  contactId: string,
  context: ContactsBehaviorContext,
) {
  const contactsPage = new ContactsPage(context);
  return contactsPage.contactLinkLocator(contactId);
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
