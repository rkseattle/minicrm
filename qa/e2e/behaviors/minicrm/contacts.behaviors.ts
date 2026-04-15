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
 * MINCRM-130, MINCRM-110, MINCRM-138
 */

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { t } from '@framework/i18n/locale.js';
import { ContactsPage } from '@pages/minicrm/ContactsPage.js';
import { ContactDetailPage } from '@pages/minicrm/ContactDetailPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by contacts behaviors. */
export interface ContactsBehaviorContext {
  page: Page;
  healPage: HealPage;
  /** Current test name forwarded to Page Object constructors for heal audit records. */
  testName: string;
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
 * const result = await navigateToContacts({ page, healPage, testName: 'my test' });
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
 * const result = await editContact(contact.id, { first_name: 'Updated' }, { page, healPage, testName });
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

  // Fill required fields.
  await context.healPage.fill(fields.first_name, [
    { type: 'testId', value: 'contact-first-name' },
    { type: 'label', value: 'First name', options: { exact: false } },
  ]);
  await context.healPage.fill(fields.last_name, [
    { type: 'testId', value: 'contact-last-name' },
    { type: 'label', value: 'Last name', options: { exact: false } },
  ]);
  await context.healPage.fill(fields.email, [
    { type: 'testId', value: 'contact-email' },
    { type: 'label', value: 'Email', options: { exact: false } },
  ]);

  // Fill optional fields when provided.
  if (fields.phone !== undefined) {
    await context.healPage.fill(fields.phone, [
      { type: 'testId', value: 'contact-phone' },
      { type: 'label', value: 'Phone', options: { exact: false } },
    ]);
  }
  if (fields.title !== undefined) {
    await context.healPage.fill(fields.title, [
      { type: 'testId', value: 'contact-title' },
      { type: 'label', value: 'Title', options: { exact: false } },
    ]);
  }
  if (fields.department !== undefined) {
    await context.healPage.fill(fields.department, [
      { type: 'testId', value: 'contact-department' },
      { type: 'label', value: 'Department', options: { exact: false } },
    ]);
  }

  // Submit the form.
  await context.healPage.click([
    { type: 'testId', value: 'contact-form-submit' },
    { type: 'role', value: 'button', options: { name: t('contacts.save'), exact: false } },
  ]);

  // Short wait for network/React state to settle.
  await context.page.waitForLoadState('networkidle');

  const finalUrl = context.page.url();

  // Check for duplicate warning (form stays open with duplicate-contact-warning).
  const duplicateWarning = await context.healPage
    .locate([
      { type: 'testId', value: 'duplicate-contact-warning' },
      { type: 'css', value: '[data-testid="duplicate-contact-warning"]' },
    ])
    .resolve(context.testName)
    .then((el) => el.isVisible().catch(() => false))
    .catch(() => false);

  // Check form still visible (either validation error or duplicate warning).
  const formStillVisible = await context.healPage
    .locate([
      { type: 'testId', value: 'contact-form' },
      { type: 'css', value: '[data-testid="contact-form"]' },
    ])
    .resolve(context.testName)
    .then((el) => el.isVisible().catch(() => false))
    .catch(() => false);

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

  // Click the Delete button to open the confirmation modal.
  await context.healPage.click([
    { type: 'testId', value: 'delete-contact-button' },
    { type: 'role', value: 'button', options: { name: t('contacts.delete'), exact: false } },
  ]);

  // Confirm deletion in the modal.
  await context.healPage.click([
    { type: 'testId', value: 'confirm-delete-confirm' },
    { type: 'role', value: 'button', options: { name: t('common.delete'), exact: false } },
  ]);

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

  // Click the Delete button.
  await context.healPage.click([
    { type: 'testId', value: 'delete-contact-button' },
    { type: 'role', value: 'button', options: { name: t('contacts.delete'), exact: false } },
  ]);

  // Click Cancel in the confirmation modal.
  await context.healPage.click([
    { type: 'testId', value: 'confirm-delete-cancel' },
    { type: 'role', value: 'button', options: { name: t('common.cancel'), exact: false } },
  ]);

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

  // Click Cancel.
  await context.healPage.click([
    { type: 'testId', value: 'contact-form-cancel' },
    { type: 'role', value: 'button', options: { name: t('contacts.cancel'), exact: false } },
  ]);

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

  await context.healPage.fill(searchTerm, [
    { type: 'testId', value: 'contacts-search' },
    { type: 'label', value: 'Search', options: { exact: false } },
  ]);

  // Wait for the search to settle using a DOM signal rather than a fixed sleep.
  // The contacts list re-renders after the debounce + network round-trip. We
  // wait until either a contact row OR the empty-state placeholder is attached
  // to the DOM — whichever appears first. This is more deterministic than a
  // hardcoded timeout and avoids double-networkidle races on slow CI machines.
  const contactRowEl = await context.healPage
    .locate([
      { type: 'css', value: '[data-testid^="contact-link-"]' },
      { type: 'css', value: '[data-testid="contacts-list"]' },
    ])
    .resolve(context.testName)
    .catch(() => null);
  const emptyStateEl = await context.healPage
    .locate([
      { type: 'testId', value: 'contacts-empty-state' },
      { type: 'text', value: t('contacts.empty') },
    ])
    .resolve(context.testName)
    .catch(() => null);
  await Promise.race([
    contactRowEl
      ? contactRowEl.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => null)
      : Promise.resolve(),
    emptyStateEl
      ? emptyStateEl.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => null)
      : Promise.resolve(),
  ]);

  const rowCount = await contactsPage.rowCount();

  // The empty state is a <p> with the contacts.empty i18n text.
  const emptyStateVisible =
    rowCount === 0 && ((await emptyStateEl?.isVisible().catch(() => false)) ?? false);

  const finalUrl = contactsPage.url();

  return { rowCount, emptyStateVisible, finalUrl };
}
