/**
 * F9 — i18n: Language Switching
 *
 * Functional regression tests verifying that language switching actually changes
 * the rendered UI language. Prior to this spec the suite had zero tests that
 * asserted any i18n behaviour — the entire feature could silently break without
 * the suite catching it.
 *
 * Test groups (all in a single test.describe.serial block because all five tests
 * mutate or depend on the shared default-language system setting):
 *
 *   F9-L1 — Admin sets system default to 'es'; UI shows Spanish nav label.
 *   F9-L2 — Admin sets system default to 'fr'; change persists across two reloads.
 *   F9-L3 — Per-user preference ('de') overrides system default ('en').
 *   F9-L4 — Language selector in nav changes language immediately and persists.
 *   F9-L5 — Mobile-web only: language selector in mobile nav drawer is functional.
 *
 * State isolation:
 *   Every test resets the system default language to 'en' in a finally block.
 *   Tests are serialised (test.describe.serial) so state mutations cannot race
 *   across test workers.
 *
 * Framework notes:
 *   - setLocale() from @framework/i18n/locale.js switches the framework's active
 *     locale map so t() returns the correct translated string for assertions.
 *   - Always call setLocale('en') in the finally block to restore the framework
 *     locale for subsequent test files.
 *   - All language assertions use nav labels — stable, high-confidence strings
 *     that are unlikely to change during refactors.
 *
 * MINCRM-239
 */

import { test } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginAs, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });
import {
  openMobileNav,
  closeMobileNavViaToggle,
  expectNavLinkHasText,
  expectNavLinkNotHasText,
  expectMobileNavLinkHasText,
  expectMobileNavLinkNotHasText,
  getDesktopLanguageSelectLocator,
  selectMobileLanguageAndWaitForPatch,
  expectMobileNavDrawerVisibleWithLanguageSelect,
  selectLanguageAndWaitForPatch,
} from '@behaviors/minicrm/nav.behaviors.js';
import { deactivateUser } from '@behaviors/minicrm/users.behaviors.js';
import { setUserLanguage, setSystemDefaultLanguage } from '@behaviors/minicrm/setup.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';
import { reloadCurrentPage } from '@behaviors/minicrm/nav.behaviors.js';
import { createTestUser, navigateToDashboard, createTestAdmin } from '@apps/minicrm/helpers.js';
import { setLocale, t } from '@framework/i18n/locale.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Sets the system default language via the API.
 * Callers must ensure restClient is authenticated as admin.
 */
async function setSystemLanguage(
  language: string,
  restClient: RestClient,
  tag: string,
): Promise<void> {
  await setSystemDefaultLanguage(restClient, language).catch((err: unknown) => {
    console.error(`[${tag}] setSystemLanguage(${language}) failed: ${String(err)}`);
  });
}

/**
 * Resets system language to 'en' and restores the framework locale.
 * Called in every finally block — errors are suppressed so teardown never
 * masks the actual test failure.
 */
async function resetLanguage(restClient: RestClient, tag: string): Promise<void> {
  await setSystemLanguage('en', restClient, tag);
  setLocale('en');
}

// ---------------------------------------------------------------------------
// Shared setup — admin auth + known-good system state before/after each test (MINCRM-358)
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await ensureSystemDefaults(restClient);
});

test.afterEach(async ({ restClient }) => {
  await ensureSystemDefaults(restClient);
});

// ---------------------------------------------------------------------------
// Language-switching tests — serialised to prevent concurrent state mutation
// ---------------------------------------------------------------------------

test.describe.serial('Language switching (MINCRM-239)', () => {
  /**
   * F9-L1: Admin sets system default to Spanish.
   * A fresh page load resolves the new default and renders Spanish nav labels.
   */
  test('@functional @serial F9-L1: admin sets system default language to es — UI shows Spanish nav label after reload', async ({
    page,
    restClient,
    testData,
  }) => {
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });
    await setSystemLanguage('es', restClient, 'F9-L1');

    try {
      // Force a full page load so the i18n resolution fires against the new setting.
      await navigateToDashboard(page);

      // Switch the framework locale so t() returns Spanish strings for assertions.
      setLocale('es');

      // On mobile the nav links live inside the collapsed drawer — open it first.
      // Desktop uses the top nav bar which is always visible.
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      if (isMobile) {
        await openMobileNav({ page });
      }

      // The Contacts nav link must read "Contactos" in Spanish.
      const contactsLabel = t('nav.contacts');

      if (isMobile) {
        await expectMobileNavLinkHasText('contacts', contactsLabel, { page });
      } else {
        await expectNavLinkHasText('top', 'contacts', contactsLabel, { page });
      }

      if (isMobile) {
        await closeMobileNavViaToggle({ page });
      }
    } finally {
      await resetLanguage(restClient, 'F9-L1');
    }
  });

  /**
   * F9-L2: Admin sets system default to French.
   * The change persists across two consecutive page reloads.
   */
  /**
   * F9-L2: User personal language preference 'fr' persists across two reloads.
   *
   * Creates a dedicated test rep with preferred_language='fr' so the test is
   * fully isolated — it owns its own user record and session, never touching
   * the admin account or the system default setting. Both Playwright projects
   * can run this test in parallel without interfering with each other.
   */
  test('@functional @serial F9-L2: user language preference fr persists after two reloads', async ({
    page,
    restClient,
  }) => {
    // Create an isolated test rep for this test.
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const repEmail = `f9-l2-rep-${uniqueSuffix}@example.com`;
    const repPassword = 'F9L2RepPass1!';

    const rep = await createTestUser(restClient, {
      name: `F9 L2 Rep ${uniqueSuffix}`,
      email: repEmail,
      role: 'rep',
      password: repPassword,
    });

    // Set the rep's personal language preference to French via the API.
    await loginAs(restClient, repEmail, repPassword);
    await setUserLanguage(restClient, 'fr');
    // Restore admin session for teardown.
    await loginAsAdmin(restClient);

    try {
      // Log in as the rep via the browser.
      await loginViaBrowser(repEmail, repPassword, { page });

      setLocale('fr');

      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      // "Opportunités" differs from English "Deals" — high-confidence French assertion.
      const dealsLabel = t('nav.deals'); // "Opportunités" in French

      // Helper: open mobile nav if needed, assert the label text, then close.
      const assertFrenchNavLabel = async (contextMsg: string) => {
        if (isMobile) await openMobileNav({ page });
        if (isMobile) {
          await expectMobileNavLinkHasText('deals', dealsLabel, { page });
        } else {
          await expectNavLinkHasText('top', 'deals', dealsLabel, { page });
        }
        if (isMobile) await closeMobileNavViaToggle({ page });
        void contextMsg; // contextMsg used implicitly via the assertion label above
      };

      // First check — UI should show French after the initial load.
      await assertFrenchNavLabel('on first load');

      // Reload once.
      await reloadCurrentPage({ page });
      await assertFrenchNavLabel('after first reload');

      // Reload a second time — confirms no reversion to English.
      await reloadCurrentPage({ page });
      await assertFrenchNavLabel('after second reload');
    } finally {
      setLocale('en');
      // Re-authenticate as admin and deactivate the test rep.
      await loginAsAdmin(restClient).catch(() => null);
      await deactivateUser(restClient, rep.id).catch((err: unknown) => {
        console.error(`[F9-L2] teardown: failed to deactivate rep: ${String(err)}`);
      });
    }
  });

  /**
   * F9-L3: Per-user language preference 'de' overrides system default 'en'.
   * A test rep with preferred_language='de' sees German nav labels; the English
   * equivalent for the same key must not be visible.
   */
  test('@functional @serial F9-L3: per-user language preference de overrides system default en', async ({
    page,
    restClient,
  }) => {
    // System default stays 'en'. Create a rep whose profile has preferred_language = 'de'.
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const repEmail = `f9-l3-rep-${uniqueSuffix}@example.com`;
    const repPassword = 'F9L3RepPass1!';

    const rep = await createTestUser(restClient, {
      name: `F9 L3 Rep ${uniqueSuffix}`,
      email: repEmail,
      role: 'rep',
      password: repPassword,
    });

    // Authenticate as the new rep to set their language preference via the API.
    const repRestClient = restClient;
    await loginAs(repRestClient, repEmail, repPassword);
    await setUserLanguage(repRestClient, 'de');

    // Restore admin session for teardown.
    await loginAsAdmin(restClient);

    try {
      // Log in as the rep via the browser so the session cookie is set for page.
      await loginViaBrowser(repEmail, repPassword, { page });

      setLocale('de');

      // On mobile the nav links live inside the collapsed drawer.
      const isMobileL3 = (page.viewportSize()?.width ?? 1024) < 1024;
      if (isMobileL3) await openMobileNav({ page });

      // The Contacts nav link must read "Kontakte" in German.
      const germanContactsLabel = t('nav.contacts'); // "Kontakte"

      if (isMobileL3) {
        await expectMobileNavLinkHasText('contacts', germanContactsLabel, { page });
      } else {
        await expectNavLinkHasText('top', 'contacts', germanContactsLabel, { page });
      }

      // The English equivalent text must not appear anywhere that's visible.
      setLocale('en');
      const englishContactsLabel = t('nav.contacts'); // "Contacts"

      // Verify the specific link shows German, not English.
      if (isMobileL3) {
        await expectMobileNavLinkNotHasText('contacts', englishContactsLabel, { page });
      } else {
        await expectNavLinkNotHasText('top', 'contacts', englishContactsLabel, { page });
      }

      if (isMobileL3) await closeMobileNavViaToggle({ page });

      // Restore framework locale before teardown.
      setLocale('de');
    } finally {
      setLocale('en');
      // Re-authenticate as admin to deactivate the test rep.
      await loginAsAdmin(restClient).catch(() => null);
      await deactivateUser(restClient, rep.id).catch((err: unknown) => {
        console.error(`[F9-L3] teardown: failed to deactivate rep: ${String(err)}`);
      });
      await resetLanguage(restClient, 'F9-L3');
    }
  });

  /**
   * F9-L4: Language selector in the nav header changes language immediately
   * (no page reload required) and the change persists after a manual reload.
   * Runs on both desktop and mobile-web.
   */
  test('@functional @serial F9-L4: nav language selector changes language immediately and persists after reload', async ({
    page,
    restClient,
    testData,
  }) => {
    // Ensure the system default is English so we start from a known baseline.
    await setSystemLanguage('en', restClient, 'F9-L4');
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });
    await navigateToDashboard(page);

    try {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;

      if (isMobile) {
        // On mobile the language selector is inside the mobile nav drawer.
        await openMobileNav({ page });
        await selectMobileLanguageAndWaitForPatch('es', { page });
        await closeMobileNavViaToggle({ page });
      } else {
        // On desktop the language selector is in the nav header.
        const langSelect = await getDesktopLanguageSelectLocator({ page });
        await selectLanguageAndWaitForPatch('es', langSelect, { page });
      }

      // Language change should take effect without a page reload.
      setLocale('es');
      const spanishContactsLabel = t('nav.contacts'); // "Contactos"

      // On mobile, open the drawer to expose the nav links before asserting.
      if (isMobile) await openMobileNav({ page });
      if (isMobile) {
        await expectMobileNavLinkHasText('contacts', spanishContactsLabel, { page });
      } else {
        await expectNavLinkHasText('top', 'contacts', spanishContactsLabel, { page });
      }
      if (isMobile) await closeMobileNavViaToggle({ page });

      // Reload and confirm Spanish persists.
      await reloadCurrentPage({ page });

      if (isMobile) await openMobileNav({ page });
      if (isMobile) {
        await expectMobileNavLinkHasText('contacts', spanishContactsLabel, { page });
      } else {
        await expectNavLinkHasText('top', 'contacts', spanishContactsLabel, { page });
      }
      if (isMobile) await closeMobileNavViaToggle({ page });
    } finally {
      // Reset both system default and the admin user's personal preference via API.
      await setUserLanguage(restClient, null).catch(() => null);
      await resetLanguage(restClient, 'F9-L4');
    }
  });

  /**
   * F9-L5: Mobile-web only.
   * The language selector in the mobile nav drawer changes the UI language when
   * a non-English option is selected. Extends F8-MN6 which only checks presence.
   */
  test('@functional @serial F9-L5: mobile nav language selector changes UI language', async ({
    page,
    restClient,
    testData,
  }) => {
    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
    test.skip(!isMobile, 'F9-L5 only runs under the mobile-web Playwright project');

    await setSystemLanguage('en', restClient, 'F9-L5');
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });
    await navigateToDashboard(page);

    try {
      // Open the mobile nav drawer and verify the drawer + language select are present.
      await openMobileNav({ page });
      await expectMobileNavDrawerVisibleWithLanguageSelect({ page });

      // Select French via the mobile language select.
      await selectMobileLanguageAndWaitForPatch('fr', { page });

      // Close the drawer after language selection.
      await closeMobileNavViaToggle({ page });

      setLocale('fr');
      // Re-open the drawer to expose the now-translated nav labels.
      await openMobileNav({ page });

      const frenchDashboardLabel = t('nav.dashboard'); // "Tableau de bord"
      await expectMobileNavLinkHasText('dashboard', frenchDashboardLabel, { page });

      await closeMobileNavViaToggle({ page });
    } finally {
      // Reset the admin user's personal language preference and system default.
      await setUserLanguage(restClient, null).catch(() => null);
      await resetLanguage(restClient, 'F9-L5');
    }
  });
  // Safety-net: unconditionally restore system language and framework locale after
  // the entire serial block, even if an individual test's finally block failed or
  // the test was aborted before reaching it. Without this, a stale non-English DB
  // setting leaks into tests on the same shard that assert English UI strings.
  test.afterAll(async ({ restClient }) => {
    await setSystemLanguage('en', restClient, 'afterAll');
    setLocale('en');
  });
}); // end Language switching
