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
 * MINCRM-130, MINCRM-110
 */

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
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
