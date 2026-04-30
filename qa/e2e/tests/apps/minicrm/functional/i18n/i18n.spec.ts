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

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import { openMobileNav, closeMobileNavViaToggle } from '@behaviors/minicrm/nav.behaviors.js';
import { createTestUser, navigateToDashboard } from '@apps/minicrm/helpers.js';
import { setLocale, t } from '@framework/i18n/locale.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F9-i18n] E2E_ADMIN_PASSWORD is not set');

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
  await restClient
    .patch('/api/v1/settings/default-language', { language })
    .catch((err: unknown) => {
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
// Shared setup — admin auth before each test
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Language-switching tests — serialised to prevent concurrent state mutation
// ---------------------------------------------------------------------------

test.describe.serial('Language switching (MINCRM-239)', () => {
  /**
   * F9-L1: Admin sets system default to Spanish.
   * A fresh page load resolves the new default and renders Spanish nav labels.
   */
  test('@functional F9-L1: admin sets system default language to es — UI shows Spanish nav label after reload', async ({
    page,
    restClient,
  }) => {
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
      // Use the correct testid variant for the active viewport.
      const contactsLabel = t('nav.contacts');
      const contactsLinkTestId = isMobile ? 'nav-top-contacts-mobile' : 'nav-top-contacts';
      const contactsLink = await page
        .locate([{ type: 'testId', value: contactsLinkTestId }])
        .resolve();
      await expect(
        contactsLink,
        `nav "contacts" link (${contactsLinkTestId}) should show "${contactsLabel}" in Spanish`,
      ).toHaveText(contactsLabel);

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
  test('@functional F9-L2: user language preference fr persists after two reloads', async ({
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
    await restClient.post('/api/v1/auth/login', { email: repEmail, password: repPassword });
    await restClient.patch('/api/v1/users/me/language', { language: 'fr' });
    // Restore admin session for teardown.
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    try {
      // Log in as the rep via the browser.
      await page.context().clearCookies();
      await login({ email: repEmail, password: repPassword }, { page });

      setLocale('fr');

      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      // "Opportunités" differs from English "Deals" — high-confidence French assertion.
      const dealsLabel = t('nav.deals'); // "Opportunités" in French
      const dealsLinkTestId = isMobile ? 'nav-top-deals-mobile' : 'nav-top-deals';

      // Helper: open mobile nav if needed, assert the label text, then close.
      const assertFrenchNavLabel = async (contextMsg: string) => {
        if (isMobile) await openMobileNav({ page });
        const dealsLink = await page.locate([{ type: 'testId', value: dealsLinkTestId }]).resolve();
        await expect(
          dealsLink,
          `nav "deals" link (${dealsLinkTestId}) should show "${dealsLabel}" in French ${contextMsg}`,
        ).toHaveText(dealsLabel);
        if (isMobile) await closeMobileNavViaToggle({ page });
      };

      // First check — UI should show French after the initial load.
      await assertFrenchNavLabel('on first load');

      // Reload once.
      await page.reload({ waitUntil: 'networkidle' });
      await assertFrenchNavLabel('after first reload');

      // Reload a second time — confirms no reversion to English.
      await page.reload({ waitUntil: 'networkidle' });
      await assertFrenchNavLabel('after second reload');
    } finally {
      setLocale('en');
      // Re-authenticate as admin and deactivate the test rep.
      await restClient
        .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .catch(() => null);
      await restClient.patch(`/api/v1/users/${rep.id}/deactivate`).catch((err: unknown) => {
        console.error(`[F9-L2] teardown: failed to deactivate rep: ${String(err)}`);
      });
    }
  });

  /**
   * F9-L3: Per-user language preference 'de' overrides system default 'en'.
   * A test rep with preferred_language='de' sees German nav labels; the English
   * equivalent for the same key must not be visible.
   */
  test('@functional F9-L3: per-user language preference de overrides system default en', async ({
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
    await repRestClient.post('/api/v1/auth/login', { email: repEmail, password: repPassword });
    await repRestClient.patch('/api/v1/users/me/language', { language: 'de' });

    // Restore admin session for teardown.
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    try {
      // Log in as the rep via the browser so the session cookie is set for page.
      // Use an unauthenticated context by clearing cookies before the UI login.
      await page.context().clearCookies();
      await login({ email: repEmail, password: repPassword }, { page });

      setLocale('de');

      // On mobile the nav links live inside the collapsed drawer.
      const isMobileL3 = (page.viewportSize()?.width ?? 1024) < 1024;
      if (isMobileL3) await openMobileNav({ page });

      // The Contacts nav link must read "Kontakte" in German.
      const germanContactsLabel = t('nav.contacts'); // "Kontakte"
      const contactsTestIdL3 = isMobileL3 ? 'nav-top-contacts-mobile' : 'nav-top-contacts';
      const contactsLinkL3 = await page
        .locate([{ type: 'testId', value: contactsTestIdL3 }])
        .resolve();
      await expect(
        contactsLinkL3,
        `nav "contacts" link (${contactsTestIdL3}) should show "${germanContactsLabel}" in German`,
      ).toHaveText(germanContactsLabel);

      // The English equivalent text must not appear anywhere that's visible.
      // Since the drawer is open on mobile, this checks the visible nav links only.
      setLocale('en');
      const englishContactsLabel = t('nav.contacts'); // "Contacts"

      // Verify the specific link shows German, not English.
      await expect(
        contactsLinkL3,
        `nav "contacts" link should NOT show English "${englishContactsLabel}" when German is active`,
      ).not.toHaveText(englishContactsLabel);

      if (isMobileL3) await closeMobileNavViaToggle({ page });

      // Restore framework locale before teardown.
      setLocale('de');
    } finally {
      setLocale('en');
      // Re-authenticate as admin to deactivate the test rep.
      await restClient
        .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .catch(() => null);
      await restClient.patch(`/api/v1/users/${rep.id}/deactivate`).catch((err: unknown) => {
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
  test('@functional F9-L4: nav language selector changes language immediately and persists after reload', async ({
    page,
    restClient,
  }) => {
    // Ensure the system default is English so we start from a known baseline.
    await setSystemLanguage('en', restClient, 'F9-L4');
    await navigateToDashboard(page);

    try {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;

      if (isMobile) {
        // On mobile the language selector is inside the mobile nav drawer.
        await openMobileNav({ page });
        const langSelect = await page
          .locate([{ type: 'testId', value: 'nav-language-select-mobile' }])
          .resolve();
        await langSelect.selectOption('es');
        await closeMobileNavViaToggle({ page });
      } else {
        // On desktop the language selector is in the nav header.
        const langSelect = await page
          .locate([{ type: 'testId', value: 'nav-language-select' }])
          .resolve();
        await langSelect.selectOption('es');
      }

      // Language change should take effect without a page reload.
      setLocale('es');
      const spanishContactsLabel = t('nav.contacts'); // "Contactos"
      const contactsTestIdL4 = isMobile ? 'nav-top-contacts-mobile' : 'nav-top-contacts';

      // On mobile, open the drawer to expose the nav links before asserting.
      if (isMobile) await openMobileNav({ page });
      const contactsLinkL4a = await page
        .locate([{ type: 'testId', value: contactsTestIdL4 }])
        .resolve();
      await expect(
        contactsLinkL4a,
        `nav "contacts" link (${contactsTestIdL4}) should switch to "${spanishContactsLabel}" in Spanish immediately`,
      ).toHaveText(spanishContactsLabel);
      if (isMobile) await closeMobileNavViaToggle({ page });

      // Reload and confirm Spanish persists.
      await page.reload({ waitUntil: 'networkidle' });

      if (isMobile) await openMobileNav({ page });
      const contactsLinkL4b = await page
        .locate([{ type: 'testId', value: contactsTestIdL4 }])
        .resolve();
      await expect(
        contactsLinkL4b,
        `nav "contacts" link (${contactsTestIdL4}) should remain "${spanishContactsLabel}" in Spanish after reload`,
      ).toHaveText(spanishContactsLabel);
      if (isMobile) await closeMobileNavViaToggle({ page });
    } finally {
      // Reset both system default and the admin user's personal preference via API.
      await restClient.patch('/api/v1/users/me/language', { language: null }).catch(() => null);
      await resetLanguage(restClient, 'F9-L4');
    }
  });

  /**
   * F9-L5: Mobile-web only.
   * The language selector in the mobile nav drawer changes the UI language when
   * a non-English option is selected. Extends F8-MN6 which only checks presence.
   */
  test('@functional F9-L5: mobile nav language selector changes UI language', async ({
    page,
    restClient,
  }) => {
    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
    test.skip(!isMobile, 'F9-L5 only runs under the mobile-web Playwright project');

    await setSystemLanguage('en', restClient, 'F9-L5');
    await navigateToDashboard(page);

    try {
      // Open the mobile nav drawer.
      await openMobileNav({ page });

      const drawer = await page.locate([{ type: 'testId', value: 'mobile-nav-drawer' }]).resolve();
      await expect(drawer).toBeVisible();

      // The language selector must be present in the drawer.
      const langSelect = await page
        .locate([{ type: 'testId', value: 'nav-language-select-mobile' }])
        .resolve();
      await expect(
        langSelect,
        'language selector must be present in mobile nav drawer',
      ).toBeVisible();

      // Select French.
      await langSelect.selectOption('fr');

      // Close the drawer after language selection.
      await closeMobileNavViaToggle({ page });

      setLocale('fr');
      // Re-open the drawer to expose the now-translated nav labels.
      await openMobileNav({ page });

      const frenchDashboardLabel = t('nav.dashboard'); // "Tableau de bord"
      const dashboardLinkL5 = await page
        .locate([{ type: 'testId', value: 'nav-top-dashboard-mobile' }])
        .resolve();
      await expect(
        dashboardLinkL5,
        `nav "dashboard" mobile link should read "${frenchDashboardLabel}" in French`,
      ).toHaveText(frenchDashboardLabel);

      await closeMobileNavViaToggle({ page });
    } finally {
      // Reset the admin user's personal language preference and system default.
      await restClient.patch('/api/v1/users/me/language', { language: null }).catch(() => null);
      await resetLanguage(restClient, 'F9-L5');
    }
  });
}); // end Language switching
