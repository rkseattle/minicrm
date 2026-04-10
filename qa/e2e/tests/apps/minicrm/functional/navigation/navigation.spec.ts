/**
 * F8 — Navigation & Global UI
 *
 * Functional regression tests for all three configurable navigation layout modes
 * (Top Nav, Left Sidebar, Hamburger Menu), deep linking, and global UI behaviours.
 *
 * Test groups:
 *   All Layouts — each destination reachable and active-state indicated (Top, Left, Hamburger)
 *   Layout Switching — switching via Settings takes effect immediately, persists after refresh
 *   Deep Linking — direct URL load of detail pages and not-found handling
 *   Hamburger Menu — open/close mechanics, keyboard accessibility (mobile-web project only)
 *   Global UI — browser back/forward navigation
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators or Page Object calls in this file — all through behaviors
 *   - All test data managed via restClient + TestDataManager
 *   - Tests must pass with --workers=4 (no shared mutable state)
 *
 * AC notes:
 *   - AC1: Layout tests run under both desktop and mobile-web Playwright projects
 *   - AC2: Hamburger Menu mechanics tests only run under mobile-web
 *   - AC3: Layout persistence verified by full page reload assertion
 *   - AC4: All nav links use data-testid following nav-{layout}-{destination} convention
 *
 * Parallelism:
 *   Tests that mutate the global nav-layout system_settings row are all placed inside
 *   a single outer test.describe.serial block. Separate serial describes within that
 *   block would still run in parallel with each other — one outer serial guarantees
 *   every layout-mutating test runs sequentially end-to-end, eliminating cross-group
 *   race conditions on the shared setting (Greptile P1 finding — second round).
 *   Deep-link and Global UI tests use page.goto directly and carry no layout state,
 *   so they are placed outside the serial block and remain parallel-safe.
 *
 * Mobile-web note:
 *   NavTop renders desktop links (nav-top-*) only at lg breakpoint (≥1024 px).
 *   On the mobile-web project viewport (393 px) those links are inside a collapsed
 *   drawer and are not visible. Top Nav layout tests therefore assert via page.goto
 *   for destination reachability and skip active-link class checks on mobile-web.
 *
 * MINCRM-144
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import {
  setNavLayoutViaAPI,
  setNavLayoutViaUI,
  openHamburgerMenu,
  closeHamburgerMenuViaBackdrop,
  closeHamburgerMenuViaCloseButton,
  navigateViaNavLink,
} from '@behaviors/minicrm/nav.behaviors.js';
import { createTestContact, createTestDeal, createTestAccount } from '@apps/minicrm/helpers.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F8] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Destinations accessible to all authenticated users (non-admin).
 * Maps destination slug to expected URL pathname after navigation.
 */
const REP_DESTINATIONS: Record<string, string> = {
  dashboard: '/',
  contacts: '/contacts',
  accounts: '/accounts',
  deals: '/deals',
  tasks: '/tasks',
};

/**
 * Destinations only accessible to admins.
 */
const ADMIN_ONLY_DESTINATIONS: Record<string, string> = {
  users: '/users',
  'win-loss': '/reports/win-loss',
  automation: '/admin/automation',
  settings: '/admin/settings',
};

/**
 * All destinations accessible to admin.
 */
const ALL_ADMIN_DESTINATIONS: Record<string, string> = {
  ...REP_DESTINATIONS,
  ...ADMIN_ONLY_DESTINATIONS,
};

/**
 * Resets the nav layout to 'top' so tests start from a known baseline.
 * Suppresses errors so a failing reset does not mask the actual test failure.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param tag - Test tag for logging.
 */
async function resetNavLayout(restClient: RestClient, tag: string): Promise<void> {
  await setNavLayoutViaAPI('top', restClient).catch((err: unknown) => {
    console.error(`[${tag}] teardown: failed to reset nav layout: ${String(err)}`);
  });
}

// ---------------------------------------------------------------------------
// Layout-mutating tests — single outer serial block
//
// All tests that call setNavLayoutViaAPI / setNavLayoutViaUI mutate the single
// global system_settings nav-layout row. Multiple separate test.describe.serial
// blocks would still run in parallel with each other under --workers=4. A single
// outer test.describe.serial guarantees all layout-dependent tests run sequentially
// end-to-end, eliminating cross-group race conditions on the shared setting.
// ---------------------------------------------------------------------------

test.describe.serial('Layout-mutating tests', () => {
  // ── Top Nav layout ─────────────────────────────────────────────────────────

  test.describe('Top Nav layout', () => {
    test('@functional F8-TN1: top nav — all destinations reachable and correct page loads', async ({
      page,
      healPage,
      restClient,
    }) => {
      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('top', restClient);

      // NavTop renders nav-top-* links only at the lg breakpoint (≥1024 px).
      // On mobile-web (393 px) those links are inside a collapsed drawer and are
      // not visible. Use page.goto for destination reachability on all viewports.
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        for (const [destination, expectedPath] of Object.entries(ALL_ADMIN_DESTINATIONS)) {
          if (isMobile) {
            // Verify the route is reachable via direct navigation.
            await page.goto(expectedPath, { waitUntil: 'networkidle' });
            const actualPath = new URL(page.url()).pathname;
            expect(actualPath, `route ${expectedPath} should be reachable on mobile-web`).toBe(
              expectedPath,
            );
          } else {
            const result = await navigateViaNavLink('top', destination, {
              page,
              healPage,
              testName,
            });
            expect(
              result.linkClicked,
              `top nav link "nav-top-${destination}" should be found and clickable`,
            ).toBe(true);
            const actualPath = new URL(result.finalUrl).pathname;
            expect(
              actualPath,
              `clicking nav-top-${destination} should navigate to ${expectedPath}`,
            ).toBe(expectedPath);
          }
        }
      } finally {
        await resetNavLayout(restClient, 'F8-TN1');
      }
    });

    test('@functional F8-TN2: top nav — active page link is visually indicated', async ({
      page,
      healPage,
      restClient,
    }) => {
      // NavTop desktop links are hidden on mobile-web viewport — skip active-class check.
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(isMobile, 'F8-TN2: nav-top-* desktop links are not visible on mobile-web viewport');

      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('top', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        // Navigate to Contacts and verify the Contacts link carries the active class.
        await navigateViaNavLink('top', 'contacts', { page, healPage, testName });

        const contactsLink = page.getByTestId('nav-top-contacts');
        // Use auto-retrying toHaveClass so React Router's NavLink class update is
        // not read as a one-shot snapshot that can race the re-render cycle.
        await expect(
          contactsLink,
          'active nav-top-contacts should carry indigo active class',
        ).toHaveClass(/text-indigo-700/);

        // A non-active link should not carry the active class.
        const dealsLink = page.getByTestId('nav-top-deals');
        await expect(
          dealsLink,
          'inactive nav-top-deals should not carry the active indigo class',
        ).not.toHaveClass(/text-indigo-700/);
      } finally {
        await resetNavLayout(restClient, 'F8-TN2');
      }
    });
  }); // end Top Nav layout

  // ── Left Sidebar layout ────────────────────────────────────────────────────

  test.describe('Left Nav layout', () => {
    test('@functional F8-LN1: left nav — all destinations reachable and correct page loads', async ({
      page,
      healPage,
      restClient,
    }) => {
      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('left', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        for (const [destination, expectedPath] of Object.entries(ALL_ADMIN_DESTINATIONS)) {
          const result = await navigateViaNavLink('left', destination, {
            page,
            healPage,
            testName,
          });

          expect(
            result.linkClicked,
            `left nav link "nav-left-${destination}" should be found and clickable`,
          ).toBe(true);

          const actualPath = new URL(result.finalUrl).pathname;
          expect(
            actualPath,
            `clicking nav-left-${destination} should navigate to ${expectedPath}`,
          ).toBe(expectedPath);
        }
      } finally {
        await resetNavLayout(restClient, 'F8-LN1');
      }
    });

    test('@functional F8-LN2: left nav — active page link is visually indicated', async ({
      page,
      healPage,
      restClient,
    }) => {
      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('left', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        // Navigate to Accounts and verify the Accounts link carries the active class.
        await navigateViaNavLink('left', 'accounts', { page, healPage, testName });

        const accountsLink = page.getByTestId('nav-left-accounts');
        // Use auto-retrying toHaveClass so React Router's NavLink class update is
        // not read as a one-shot snapshot that can race the re-render cycle.
        await expect(
          accountsLink,
          'active nav-left-accounts should carry indigo active class',
        ).toHaveClass(/text-indigo-700/);

        // A non-active link should not carry the active class.
        const tasksLink = page.getByTestId('nav-left-tasks');
        await expect(
          tasksLink,
          'inactive nav-left-tasks should not carry the active indigo class',
        ).not.toHaveClass(/text-indigo-700/);
      } finally {
        await resetNavLayout(restClient, 'F8-LN2');
      }
    });
  }); // end Left Nav layout

  // ── Hamburger Nav layout ────────────────────────────────────────────────────

  test.describe('Hamburger Nav layout', () => {
    test('@functional F8-HB1: hamburger nav — all destinations reachable and correct page loads', async ({
      page,
      healPage,
      restClient,
    }) => {
      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('hamburger', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        for (const [destination, expectedPath] of Object.entries(ALL_ADMIN_DESTINATIONS)) {
          // navigateViaNavLink opens the menu automatically for the hamburger layout.
          const result = await navigateViaNavLink('hamburger', destination, {
            page,
            healPage,
            testName,
          });

          expect(
            result.linkClicked,
            `hamburger nav link "nav-hamburger-${destination}" should be found and clickable`,
          ).toBe(true);

          const actualPath = new URL(result.finalUrl).pathname;
          expect(
            actualPath,
            `clicking nav-hamburger-${destination} should navigate to ${expectedPath}`,
          ).toBe(expectedPath);
        }
      } finally {
        await resetNavLayout(restClient, 'F8-HB1');
      }
    });

    test('@functional F8-HB2: hamburger nav — active page link is visually indicated when menu is open', async ({
      page,
      healPage,
      restClient,
    }) => {
      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('hamburger', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        // Navigate to Deals via hamburger, then open menu again to check active state.
        await navigateViaNavLink('hamburger', 'deals', { page, healPage, testName });

        // Re-open the menu to inspect the active link class.
        await openHamburgerMenu({ page, healPage, testName });

        const dealsLink = page.getByTestId('nav-hamburger-deals');
        const classAttr = await dealsLink.getAttribute('class');

        // The active class is 'bg-indigo-50 text-indigo-700' per NavHamburger.tsx overlayLinkClass.
        expect(classAttr, 'active nav-hamburger-deals should carry indigo active class').toContain(
          'text-indigo-700',
        );

        // A non-active link should not carry the active class.
        const contactsLink = page.getByTestId('nav-hamburger-contacts');
        const contactsClass = await contactsLink.getAttribute('class');
        expect(
          contactsClass,
          'inactive nav-hamburger-contacts should not carry the active indigo class',
        ).not.toContain('text-indigo-700');
      } finally {
        await resetNavLayout(restClient, 'F8-HB2');
      }
    });
  }); // end Hamburger Nav layout

  // ── Layout switching ────────────────────────────────────────────────────────

  test.describe('Layout switching', () => {
    test('@functional F8-LS1: switching layout in Settings renders the new nav immediately without full page reload', async ({
      page,
      healPage,
      restClient,
    }) => {
      // The nav layout selector in Admin Settings is hidden on mobile viewports
      // (hidden lg:block) because mobile always uses hamburger. Nothing to test here.
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(
        isMobile,
        'F8-LS1: nav layout selector is desktop-only (hidden lg:block on mobile)',
      );

      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('top', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        // Navigate to Admin Settings.
        await page.goto('/admin/settings', { waitUntil: 'networkidle' });

        // Switch to Left Nav.
        await setNavLayoutViaUI('left', { page, healPage, testName });

        // The sidebar nav links should now be visible without a page reload.
        const leftNavLink = page.getByTestId('nav-left-contacts');
        await expect(leftNavLink).toBeVisible();

        // Top nav links should no longer be present.
        const topNavLink = page.getByTestId('nav-top-contacts');
        await expect(topNavLink).not.toBeVisible();

        // Switch to hamburger layout.
        await setNavLayoutViaUI('hamburger', { page, healPage, testName });

        // Hamburger toggle should now be visible; top and left nav links should not.
        const hamburgerToggle = page.getByTestId('nav-menu-toggle');
        await expect(hamburgerToggle).toBeVisible();
        await expect(topNavLink).not.toBeVisible();
        await expect(leftNavLink).not.toBeVisible();
      } finally {
        await resetNavLayout(restClient, 'F8-LS1');
      }
    });

    test('@functional F8-LS2: selected layout persists after page refresh', async ({
      page,
      healPage,
      restClient,
    }) => {
      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('left', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        // Verify the left sidebar is active.
        const leftNavLink = page.getByTestId('nav-left-contacts');
        await expect(leftNavLink).toBeVisible();

        // Full page reload.
        await page.reload({ waitUntil: 'networkidle' });

        // Left sidebar must still be active after reload — not reverted to default.
        await expect(leftNavLink).toBeVisible();
        const topNavLink = page.getByTestId('nav-top-contacts');
        await expect(topNavLink).not.toBeVisible();
      } finally {
        await resetNavLayout(restClient, 'F8-LS2');
      }
    });

    test('@functional F8-LS3: hamburger layout persists after page refresh', async ({
      page,
      healPage,
      restClient,
    }) => {
      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('hamburger', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        // Hamburger toggle must be visible.
        const hamburgerToggle = page.getByTestId('nav-menu-toggle');
        await expect(hamburgerToggle).toBeVisible();

        // Full page reload.
        await page.reload({ waitUntil: 'networkidle' });

        // Hamburger layout must still be active after reload.
        await expect(hamburgerToggle).toBeVisible();
        const topNavLink = page.getByTestId('nav-top-contacts');
        await expect(topNavLink).not.toBeVisible();
        const leftNavLink = page.getByTestId('nav-left-contacts');
        await expect(leftNavLink).not.toBeVisible();
      } finally {
        await resetNavLayout(restClient, 'F8-LS3');
      }
    });
  }); // end Layout switching

  // ── Hamburger Menu mechanics (mobile-web only) ─────────────────────────────

  test.describe('Hamburger Menu mechanics', () => {
    test('@functional F8-HM1: hamburger menu opens on toggle tap', async ({
      page,
      healPage,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(!isMobile, 'F8-HM1 only runs under the mobile-web Playwright project');

      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('hamburger', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        // Drawer should not be visible initially.
        const drawer = page.getByTestId('nav-hamburger-drawer');
        await expect(drawer).not.toBeVisible();

        const result = await openHamburgerMenu({ page, healPage, testName });

        expect(result.drawerVisible, 'hamburger drawer should be visible after toggle tap').toBe(
          true,
        );
        await expect(drawer).toBeVisible();
      } finally {
        await resetNavLayout(restClient, 'F8-HM1');
      }
    });

    test('@functional F8-HM2: hamburger menu closes on outside tap', async ({
      page,
      healPage,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(!isMobile, 'F8-HM2 only runs under the mobile-web Playwright project');

      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('hamburger', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        await openHamburgerMenu({ page, healPage, testName });

        const drawer = page.getByTestId('nav-hamburger-drawer');
        await expect(drawer).toBeVisible();

        const result = await closeHamburgerMenuViaBackdrop({ page, healPage, testName });

        expect(result.drawerClosed, 'hamburger drawer should close on outside tap').toBe(true);
        await expect(drawer).not.toBeVisible();
      } finally {
        await resetNavLayout(restClient, 'F8-HM2');
      }
    });

    test('@functional F8-HM3: hamburger menu closes on navigation', async ({
      page,
      healPage,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(!isMobile, 'F8-HM3 only runs under the mobile-web Playwright project');

      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('hamburger', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        await openHamburgerMenu({ page, healPage, testName });

        const drawer = page.getByTestId('nav-hamburger-drawer');
        await expect(drawer).toBeVisible();

        // Click a link — the NavLink onClick calls closeMenu().
        await navigateViaNavLink('hamburger', 'contacts', { page, healPage, testName });

        // After navigation the drawer should be closed.
        await expect(drawer).not.toBeVisible();
      } finally {
        await resetNavLayout(restClient, 'F8-HM3');
      }
    });

    test('@functional F8-HM4: hamburger menu — all destinations are accessible within the menu', async ({
      page,
      healPage,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(!isMobile, 'F8-HM4 only runs under the mobile-web Playwright project');

      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('hamburger', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        // Open the hamburger menu and verify all admin destinations are visible.
        await openHamburgerMenu({ page, healPage, testName });

        for (const destination of Object.keys(ALL_ADMIN_DESTINATIONS)) {
          const link = page.getByTestId(`nav-hamburger-${destination}`);
          await expect(
            link,
            `nav-hamburger-${destination} should be visible inside the open menu`,
          ).toBeVisible();
        }

        // Close menu before navigating away.
        await closeHamburgerMenuViaCloseButton({ page, healPage, testName });
      } finally {
        await resetNavLayout(restClient, 'F8-HM4');
      }
    });

    test('@functional F8-HM5: hamburger menu is keyboard-accessible (tab + enter)', async ({
      page,
      healPage,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(!isMobile, 'F8-HM5 only runs under the mobile-web Playwright project');

      const testName = test.info().title;
      await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await setNavLayoutViaAPI('hamburger', restClient);

      try {
        await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

        // Focus the hamburger toggle and activate it via keyboard.
        const toggle = page.getByTestId('nav-menu-toggle');
        await toggle.focus();
        await page.keyboard.press('Enter');

        // Drawer should open.
        const drawer = page.getByTestId('nav-hamburger-drawer');
        await expect(drawer).toBeVisible();

        // Focus should move into the drawer on open (NavHamburger.tsx focuses first link).
        // Tab once to reach the first nav link (past the close button), then Enter.
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');

        // After pressing Enter on a nav link the menu closes and navigation occurs.
        await page.waitForLoadState('networkidle').catch(() => null);
        await expect(drawer).not.toBeVisible();
      } finally {
        await resetNavLayout(restClient, 'F8-HM5');
      }
    });
  }); // end Hamburger Menu mechanics
}); // end Layout-mutating tests

// ---------------------------------------------------------------------------
// Deep linking — these tests use page.goto and do not touch nav-layout,
// so they can run in parallel safely outside the serial block.
// ---------------------------------------------------------------------------

test('@functional F8-DL1: deep link to /contacts/:id loads the correct contact detail view', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const contact = await createTestContact(testData, restClient, {
    first_name: 'F8DL1',
    last_name: `DeepLink-${Date.now()}`,
  });

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

  // Navigate directly to the contact detail page without going through the list.
  await page.goto(`/contacts/${contact.id}`, { waitUntil: 'networkidle' });

  // The contact name heading is rendered once data loads.
  const nameHeading = page.getByTestId('contact-name');
  await expect(nameHeading).toBeVisible();
  await expect(nameHeading).toContainText(contact.first_name);
  await expect(nameHeading).toContainText(contact.last_name);

  // URL must match.
  const finalPath = new URL(page.url()).pathname;
  expect(finalPath, 'URL should remain on the contact detail route').toBe(
    `/contacts/${contact.id}`,
  );
});

test('@functional F8-DL2: deep link to /deals/:id loads the correct deal detail view', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const account = await createTestAccount(testData, restClient, {
    name: `F8DL2 Account ${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F8DL2 Deal ${Date.now()}`,
    account_id: account.id,
  });

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

  // Navigate directly to the deal detail page.
  await page.goto(`/deals/${deal.id}`, { waitUntil: 'networkidle' });

  // The deal name heading is rendered once data loads.
  const nameHeading = page.getByTestId('deal-name');
  await expect(nameHeading).toBeVisible();
  await expect(nameHeading).toContainText(deal.name);

  const finalPath = new URL(page.url()).pathname;
  expect(finalPath, 'URL should remain on the deal detail route').toBe(`/deals/${deal.id}`);
});

test('@functional F8-DL3: deep link to a non-existent contact shows a meaningful not-found state', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

  // Use an ID that is extremely unlikely to exist.
  await page.goto('/contacts/00000000-0000-0000-0000-000000000000', { waitUntil: 'networkidle' });

  // ContactDetailPage renders role="alert" with the contacts.notFound message on error.
  // The page must not be blank or show an unhandled 500.
  // React Query's error state may render after networkidle, so give it extra time.
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 10_000 });
});

test('@functional F8-DL4: deep link to admin-only route as rep redirects to dashboard', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Create a rep user for this test.
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const repEmail = `f8-rep-${uniqueSuffix}@example.com`;
  const repPassword = 'F8RepPass1!';

  const inviteRes = await restClient.post<{ user: { id: string }; inviteToken: string }>(
    '/api/users/invite',
    { name: `F8 Rep ${uniqueSuffix}`, email: repEmail, role: 'rep' },
  );
  const { user: rep, inviteToken } = inviteRes.body;
  await restClient.post('/api/users/set-password', { token: inviteToken, password: repPassword });

  try {
    await login({ email: repEmail, password: repPassword }, { page, healPage, testName });

    // Directly navigate to an admin-only route.
    await page.goto('/admin/settings', { waitUntil: 'networkidle' });

    // AdminRoute redirects non-admins to '/'.
    await page
      .waitForURL((url) => new URL(url).pathname === '/', { timeout: 10_000 })
      .catch(() => null);

    const finalPath = new URL(page.url()).pathname;
    expect(finalPath, 'rep deep-linking to /admin/settings should be redirected to /').toBe('/');
  } finally {
    await restClient
      .post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
    await restClient.patch(`/api/users/${rep.id}/deactivate`).catch(() => null);
  }
});

// ---------------------------------------------------------------------------
// Global UI — browser back / forward
// Uses page.goto for history building so it works regardless of viewport/layout.
// ---------------------------------------------------------------------------

test('@functional F8-GU1: browser back and forward navigate correctly between viewed pages', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

  // Build history using page.goto so the test is layout- and viewport-independent.
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.goto('/contacts', { waitUntil: 'networkidle' });
  await page.goto('/accounts', { waitUntil: 'networkidle' });

  // Go back to contacts.
  await page.goBack({ waitUntil: 'networkidle' });
  let pathname = new URL(page.url()).pathname;
  expect(pathname, 'browser back should navigate to /contacts').toBe('/contacts');

  // Go back to dashboard.
  await page.goBack({ waitUntil: 'networkidle' });
  pathname = new URL(page.url()).pathname;
  expect(pathname, 'browser back again should navigate to /').toBe('/');

  // Go forward to contacts.
  await page.goForward({ waitUntil: 'networkidle' });
  pathname = new URL(page.url()).pathname;
  expect(pathname, 'browser forward should navigate back to /contacts').toBe('/contacts');

  // Go forward to accounts.
  await page.goForward({ waitUntil: 'networkidle' });
  pathname = new URL(page.url()).pathname;
  expect(pathname, 'browser forward again should navigate to /accounts').toBe('/accounts');
});

test('@functional F8-GU2: browser tab title is set on load', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

  // The app uses a static <title>MiniCRM</title> in index.html (no per-page title updates).
  // Verify the title is present and non-empty on the dashboard.
  const title = await page.title();
  expect(title.length, 'page title should be non-empty').toBeGreaterThan(0);
  expect(title, 'page title should contain MiniCRM').toContain('MiniCRM');
});
