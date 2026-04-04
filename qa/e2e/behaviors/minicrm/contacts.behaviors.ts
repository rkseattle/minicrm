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
 * MINCRM-130
 */

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { ContactsPage } from '@pages/minicrm/ContactsPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by contacts behaviors. */
export interface ContactsBehaviorContext {
  page: Page;
  healPage: HealPage;
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
 * const result = await navigateToContacts({ page, healPage });
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
