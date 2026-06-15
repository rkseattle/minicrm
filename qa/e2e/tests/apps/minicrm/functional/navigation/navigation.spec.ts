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
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });
import {
  inviteUserViaApi,
  setUserPassword,
  deactivateUser,
} from '@behaviors/minicrm/users.behaviors.js';
import {
  setNavLayoutViaAPI,
  setNavLayoutViaUI,
  openHamburgerMenu,
  closeHamburgerMenuViaBackdrop,
  closeHamburgerMenuViaCloseButton,
  navigateViaNavLink,
  openMobileNav,
  closeMobileNavViaToggle,
  navigateViaMobileNavLink,
  getNavLinkLocator,
  getAdminSectionDividerLocator,
  getHamburgerDrawerLocator,
  getMobileNavDrawerLocator,
  getMenuToggleLocator,
  getMobileNavLinkLocator,
  getMobileLogoutButtonLocator,
  getMobileLanguageSelectLocator,
  reloadCurrentPage,
  waitForNavLink,
  navigateToUrlAndWait,
  waitForRedirectToDashboard,
  waitForCssSelector,
  waitForUrl,
  isNavLinkHidden,
  hamburgerDrawerDoesNotExist,
  isMobileNavDrawerHidden,
  navigateBack,
  navigateForward,
} from '@behaviors/minicrm/nav.behaviors.js';
import {
  getContactNameLocator,
  getContactNotFoundLocator,
} from '@behaviors/minicrm/contacts.behaviors.js';
import {
  getDealNameHeadingLocator,
  pipelineBoardIsLoaded,
} from '@behaviors/minicrm/deals.behaviors.js';
import {
  createTestContact,
  createTestDeal,
  createTestAccount,
  navigateToDashboard,
  navigateToAdminSettings,
  navigateToContacts,
  navigateToAccounts,
  navigateToContact,
  navigateToDeal,
  createTestAdmin,
} from '@apps/minicrm/helpers.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

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
  reports: '/reports',
};

/**
 * Destinations only accessible to admins.
 */
const ADMIN_ONLY_DESTINATIONS: Record<string, string> = {
  users: '/users',
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

/**
 * Sets the nav layout to 'hamburger' in a way that is guaranteed to be visible
 * to the browser page immediately — no stale React Query cache risk.
 *
 * On desktop: uses the Settings UI (setNavLayoutViaUI), which calls
 * queryClient.setQueryData() and bypasses the 5-minute staleTime window.
 *
 * On mobile: the nav layout selector is hidden (hidden lg:block), so we fall
 * back to the API + page.reload() to force a fresh fetch past the stale cache.
 *
 * @param page - The PageFacade for the current browser context.
 * @param restClient - Admin-authenticated RestClient (used only on mobile path).
 */
async function activateHamburgerLayout(page: PageFacade, restClient: RestClient): Promise<void> {
  const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
  if (isMobile) {
    await setNavLayoutViaAPI('hamburger', restClient);
    await navigateToDashboard(page);
    await reloadCurrentPage({ page });
  } else {
    await navigateToAdminSettings(page);
    const result = await setNavLayoutViaUI('hamburger', { page });
    expect(result.clicked, 'hamburger layout option must be clickable').toBe(true);
    // Wait for aria-checked on the option to confirm the PATCH has round-tripped
    // before navigating away. Without this, goto('/') may fetch the layout before
    // the server write commits and serve the stale value.
    await waitForCssSelector(
      '[data-testid="nav-layout-option-hamburger"][aria-checked="true"]',
      { page },
      10_000,
    );
    // Re-assert via API immediately before the goto to minimise the race window
    // where a parallel worker's ensureSystemDefaults can reset nav_layout to
    // 'top' between the UI PATCH and the fresh GET triggered by navigateToDashboard.
    await setNavLayoutViaAPI('hamburger', restClient);
    await navigateToDashboard(page);
  }
}

// ---------------------------------------------------------------------------
// Shared setup — admin auth + known-good system state (MINCRM-358)
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page, restClient, testData }) => {
  await loginAsAdmin(restClient);
  await ensureSystemDefaults(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
});

// afterEach intentionally omitted — every layout-mutating test resets its own
// state in a finally block via resetNavLayout(). A file-level afterEach calling
// ensureSystemDefaults() fires between every test in the serial block and races
// with parallel workers also calling ensureSystemDefaults(), resetting nav_layout
// to 'top' while the next test's activateHamburgerLayout is running. (MINCRM-415)

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
    test('@functional @serial F8-TN1: top nav — all destinations reachable and correct page loads', async ({
      page,
      restClient,
    }) => {
      await setNavLayoutViaAPI('top', restClient);
      // MINCRM-192: storageState loads cookies but does not navigate the page.
      // Explicitly load the app root so the nav renders before link-click assertions.
      await navigateToDashboard(page);

      // NavTop renders nav-top-* links only at the lg breakpoint (≥1024 px).
      // On mobile-web (393 px) those links are inside a collapsed drawer and are
      // not visible. Use page.goto for destination reachability on all viewports.
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;

      try {
        for (const [destination, expectedPath] of Object.entries(ALL_ADMIN_DESTINATIONS)) {
          if (isMobile) {
            await navigateToUrlAndWait(expectedPath, { page });
            const actualPath = new URL(page.url()).pathname;
            expect(actualPath, `route ${expectedPath} should be reachable on mobile-web`).toBe(
              expectedPath,
            );
          } else {
            const result = await navigateViaNavLink('top', destination, {
              page,
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

    test('@functional @serial F8-TN2: top nav — active page link is visually indicated', async ({
      page,
      restClient,
    }) => {
      // NavTop desktop links are hidden on mobile-web viewport — skip active-class check.
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(isMobile, 'F8-TN2: nav-top-* desktop links are not visible on mobile-web viewport');

      await setNavLayoutViaAPI('top', restClient);
      await navigateToDashboard(page);

      try {
        // Navigate to Contacts and verify the Contacts link carries the active class.
        await navigateViaNavLink('top', 'contacts', { page });

        const contactsLink = await getNavLinkLocator('top', 'contacts', { page });
        // Use auto-retrying toHaveClass so React Router's NavLink class update is
        // not read as a one-shot snapshot that can race the re-render cycle.
        await expect(
          contactsLink,
          'active nav-top-contacts should carry primary active class',
        ).toHaveClass(/text-primary-700/);

        // A non-active link should not carry the active class.
        const dealsLink = await getNavLinkLocator('top', 'deals', { page });
        await expect(
          dealsLink,
          'inactive nav-top-deals should not carry the active primary class',
        ).not.toHaveClass(/text-primary-700/);
      } finally {
        await resetNavLayout(restClient, 'F8-TN2');
      }
    });
  }); // end Top Nav layout

  // ── Left Sidebar layout ────────────────────────────────────────────────────

  test.describe('Left Nav layout', () => {
    test('@functional @serial F8-LN1: left nav — all destinations reachable and correct page loads', async ({
      page,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(isMobile, 'F8-LN1: NavLeft is not rendered on mobile — mobile always uses NavTop');

      await setNavLayoutViaAPI('left', restClient);
      await navigateToDashboard(page);

      try {
        for (const [destination, expectedPath] of Object.entries(ALL_ADMIN_DESTINATIONS)) {
          const result = await navigateViaNavLink('left', destination, {
            page,
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

    test('@functional @serial F8-LN2: left nav — active page link is visually indicated', async ({
      page,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(isMobile, 'F8-LN2: NavLeft is not rendered on mobile — mobile always uses NavTop');

      await setNavLayoutViaAPI('left', restClient);
      await navigateToDashboard(page);

      try {
        // Navigate to Accounts and verify the Accounts link carries the active class.
        await navigateViaNavLink('left', 'accounts', { page });

        const accountsLink = await getNavLinkLocator('left', 'accounts', { page });
        // Use auto-retrying toHaveClass so React Router's NavLink class update is
        // not read as a one-shot snapshot that can race the re-render cycle.
        await expect(
          accountsLink,
          'active nav-left-accounts should carry primary active class',
        ).toHaveClass(/text-primary-700/);

        // A non-active link should not carry the active class.
        const tasksLink = await getNavLinkLocator('left', 'tasks', { page });
        await expect(
          tasksLink,
          'inactive nav-left-tasks should not carry the active primary class',
        ).not.toHaveClass(/text-primary-700/);
      } finally {
        await resetNavLayout(restClient, 'F8-LN2');
      }
    });
  }); // end Left Nav layout

  // ── Hamburger Nav layout ────────────────────────────────────────────────────

  test.describe('Hamburger Nav layout', () => {
    test('@functional @serial F8-HB1: hamburger nav — all destinations reachable and correct page loads', async ({
      page,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;

      if (isMobile) {
        // On mobile the Settings UI is hidden (hidden lg:block) so we set the
        // layout via API, then navigate to the app root so NavHamburger renders.
        await setNavLayoutViaAPI('hamburger', restClient);
        await navigateToDashboard(page);
      } else {
        // On desktop, switch to hamburger via the Settings UI so the app
        // re-renders in place — avoids the race between a server-side PATCH
        // and a subsequent page.goto where React may fetch a stale cached layout.
        await navigateToAdminSettings(page);
        const layoutSet = await setNavLayoutViaUI('hamburger', { page });
        expect(layoutSet.clicked, 'hamburger layout option must be clickable').toBe(true);
        await navigateToDashboard(page);
      }

      try {
        // F8-HB1 tests route reachability under hamburger layout, not drawer
        // open/close mechanics (those are covered by F8-HM1–HM5). Use page.goto
        // per destination — same approach as F8-TN1 on mobile-web.
        for (const [_destination, expectedPath] of Object.entries(ALL_ADMIN_DESTINATIONS)) {
          await navigateToUrlAndWait(expectedPath, { page });
          const actualPath = new URL(page.url()).pathname;
          expect(
            actualPath,
            `route ${expectedPath} should be reachable under hamburger layout`,
          ).toBe(expectedPath);
        }
      } finally {
        await resetNavLayout(restClient, 'F8-HB1');
      }
    });

    test('@functional @serial F8-HB2: hamburger nav — active page link is visually indicated when menu is open', async ({
      page,
      restClient,
    }) => {
      // NavHamburger only renders on desktop — mobile always uses NavTop regardless
      // of the stored layout setting. Active link styling inside the hamburger drawer
      // is a desktop-only concern.
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(isMobile, 'F8-HB2: NavHamburger is desktop-only; mobile always renders NavTop');

      await activateHamburgerLayout(page, restClient);

      try {
        // Navigate to Deals via hamburger, then open menu again to check active state.
        await navigateViaNavLink('hamburger', 'deals', { page });

        // Confirm the URL has settled on /deals before reopening the menu.
        // The hamburger link click uses force:true (bypasses actionability), so
        // React Router's location update may not be committed by the time
        // openHamburgerMenu triggers a fresh popover mount — waiting for the
        // URL guarantees the browser location is correct.
        await waitForUrl('**/deals', { page }, 10_000);

        // With v7_startTransition enabled, React Router wraps location updates in
        // startTransition — the browser URL changes before React commits the new
        // location to NavLink. Confirm the pipeline board is rendered before
        // re-opening the menu; this guarantees React has committed the /deals route
        // so NavLink sees the correct active location on the next render. (MINCRM-404)
        await pipelineBoardIsLoaded({ page });

        // Re-open the menu to inspect the active link class.
        await openHamburgerMenu({ page });

        // openHamburgerMenu() waits for the drawer container to be visible, but
        // React may not have committed the NavLink children to the DOM yet at that
        // instant. Wait for a known link to confirm the drawer content is rendered
        // before resolving any specific link locator.
        await waitForNavLink('nav-hamburger-dashboard', { page }, 10_000);

        const dealsLink = await getNavLinkLocator('hamburger', 'deals', { page });

        // The active class is 'bg-primary-50 text-primary-700' per NavHamburger.tsx overlayLinkClass.
        // toHaveClass retries until the assertion passes (up to default timeout), avoiding the
        // one-shot getAttribute race with React reconciliation after navigation.
        await expect(
          dealsLink,
          'active nav-hamburger-deals should carry primary active class',
        ).toHaveClass(/text-primary-700/);

        // A non-active link should not carry the active class.
        const contactsLink = await getNavLinkLocator('hamburger', 'contacts', { page });
        await expect(
          contactsLink,
          'inactive nav-hamburger-contacts should not carry the active primary class',
        ).not.toHaveClass(/text-primary-700/);
      } finally {
        await resetNavLayout(restClient, 'F8-HB2');
      }
    });
  }); // end Hamburger Nav layout

  // ── Admin section divider (MINCRM-261) — parametrized across all layouts ────
  //
  // F8-AD1 through F8-AD4 were four separate tests checking the same assertion
  // in four nav layouts. Merged into one parametrized test in MINCRM-409.

  test.describe('Admin section divider', () => {
    type DividerVariant = {
      label: string;
      layout: 'left' | 'top' | 'hamburger' | 'top-mobile';
      skipOnMobile: boolean;
      skipOnDesktop: boolean;
      setup: (
        page: Parameters<Parameters<typeof test>[2]>[0]['page'],
        restClient: Parameters<Parameters<typeof test>[2]>[0]['restClient'],
      ) => Promise<void>;
      teardown: (
        page: Parameters<Parameters<typeof test>[2]>[0]['page'],
        restClient: Parameters<Parameters<typeof test>[2]>[0]['restClient'],
      ) => Promise<void>;
    };

    const DIVIDER_VARIANTS: DividerVariant[] = [
      {
        label: 'left nav',
        layout: 'left',
        skipOnMobile: true,
        skipOnDesktop: false,
        setup: async (_page, restClient) => {
          await setNavLayoutViaAPI('left', restClient);
          await navigateToDashboard(_page);
        },
        teardown: async (_page, restClient) => {
          await resetNavLayout(restClient, 'F8-AD1-left');
        },
      },
      {
        label: 'top nav (desktop)',
        layout: 'top',
        skipOnMobile: true,
        skipOnDesktop: false,
        setup: async (_page, restClient) => {
          await setNavLayoutViaAPI('top', restClient);
          await navigateToDashboard(_page);
        },
        teardown: async (_page, restClient) => {
          await resetNavLayout(restClient, 'F8-AD1-top');
        },
      },
      {
        label: 'hamburger nav',
        layout: 'hamburger',
        skipOnMobile: true,
        skipOnDesktop: false,
        setup: async (_page, restClient) => {
          await activateHamburgerLayout(_page, restClient);
          await openHamburgerMenu({ page: _page });
        },
        teardown: async (_page, restClient) => {
          await closeHamburgerMenuViaCloseButton({ page: _page }).catch(() => undefined);
          await resetNavLayout(restClient, 'F8-AD1-hamburger');
        },
      },
      {
        label: 'mobile drawer',
        layout: 'top-mobile',
        skipOnMobile: false,
        skipOnDesktop: true,
        setup: async (_page, _restClient) => {
          await navigateToDashboard(_page);
          await openMobileNav({ page: _page });
        },
        teardown: async (_page, _restClient) => {
          await closeMobileNavViaToggle({ page: _page }).catch(() => undefined);
        },
      },
    ];

    for (const variant of DIVIDER_VARIANTS) {
      test(
        `@functional @serial F8-AD1: admin sees Administration divider across all layouts — ${variant.label}`,
        { tag: ['@functional', '@serial'] },
        async ({ page, restClient }) => {
          const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
          if (variant.skipOnMobile && isMobile) {
            test.skip(true, `F8-AD1 [${variant.label}]: not applicable on mobile-web viewport`);
          }
          if (variant.skipOnDesktop && !isMobile) {
            test.skip(
              true,
              `F8-AD1 [${variant.label}]: only runs under the mobile-web Playwright project`,
            );
          }

          await variant.setup(page, restClient);
          try {
            const divider = await getAdminSectionDividerLocator(variant.layout, { page });
            await expect(
              divider,
              `Administration divider should be visible in ${variant.label} for admin`,
            ).toBeVisible();
          } finally {
            await variant.teardown(page, restClient);
          }
        },
      );
    }
  }); // end Admin section divider

  // ── Layout switching ────────────────────────────────────────────────────────

  test.describe('Layout switching', () => {
    // Layout-switch tests navigate to Admin Settings, trigger a PATCH, then
    // reload — give each test 60 s to absorb CI resource contention.
    test.setTimeout(60_000);

    test('@functional @serial F8-LS1: switching layout in Settings renders the new nav immediately without full page reload', async ({
      page,
      restClient,
    }) => {
      // The nav layout selector in Admin Settings is hidden on mobile viewports
      // (hidden lg:block) because mobile always uses hamburger. Nothing to test here.
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(
        isMobile,
        'F8-LS1: nav layout selector is desktop-only (hidden lg:block on mobile)',
      );

      await setNavLayoutViaAPI('top', restClient);

      try {
        // Navigate to Admin Settings.
        await navigateToAdminSettings(page);

        // Switch to Left Nav.
        await setNavLayoutViaUI('left', { page });

        // The sidebar nav links should now be visible without a page reload.

        const leftNavLink = await getNavLinkLocator('left', 'contacts', { page });
        await expect(leftNavLink).toBeVisible();

        expect(
          await isNavLinkHidden('nav-top-contacts', { page }),
          'nav-top-contacts should not be visible after switching to left layout',
        ).toBe(true);

        await setNavLayoutViaUI('hamburger', { page });

        const hamburgerToggle = await getMenuToggleLocator({ page });
        await expect(hamburgerToggle).toBeVisible();
        expect(
          await isNavLinkHidden('nav-top-contacts', { page }),
          'nav-top-contacts should not be visible in hamburger layout',
        ).toBe(true);
        expect(
          await isNavLinkHidden('nav-left-contacts', { page }),
          'nav-left-contacts should not be visible in hamburger layout',
        ).toBe(true);
      } finally {
        await resetNavLayout(restClient, 'F8-LS1');
      }
    });

    // F8-LS2 and F8-LS3 were the same test with different layout inputs. Merged
    // into one parametrized test in MINCRM-409.
    const PERSISTENCE_VARIANTS: Array<{
      layout: 'left' | 'hamburger';
      label: string;
      skipOnMobile: boolean;
      activate: (
        page: Parameters<Parameters<typeof test>[2]>[0]['page'],
        restClient: Parameters<Parameters<typeof test>[2]>[0]['restClient'],
      ) => Promise<void>;
      assertActive: (
        page: Parameters<Parameters<typeof test>[2]>[0]['page'],
        restClient: Parameters<Parameters<typeof test>[2]>[0]['restClient'],
      ) => Promise<void>;
    }> = [
      {
        layout: 'left',
        label: 'left layout',
        skipOnMobile: true,
        activate: async (_page, restClient) => {
          await setNavLayoutViaAPI('left', restClient);
          await navigateToDashboard(_page);
        },
        assertActive: async (_page, restClient) => {
          const leftNavLink = await getNavLinkLocator('left', 'contacts', { page: _page });
          await expect(leftNavLink).toBeVisible();
          await setNavLayoutViaAPI('left', restClient);
          await reloadCurrentPage({ page: _page });
          await expect(leftNavLink).toBeVisible();
          expect(
            await isNavLinkHidden('nav-top-contacts', { page: _page }),
            'nav-top-contacts should not be visible after reload in left layout',
          ).toBe(true);
        },
      },
      {
        layout: 'hamburger',
        label: 'hamburger layout',
        skipOnMobile: false,
        activate: async (_page, restClient) => {
          await activateHamburgerLayout(_page, restClient);
        },
        assertActive: async (_page, restClient) => {
          await setNavLayoutViaAPI('hamburger', restClient);
          await reloadCurrentPage({ page: _page });
          const hamburgerToggle = await getMenuToggleLocator({ page: _page });
          await expect(hamburgerToggle).toBeVisible();
          await setNavLayoutViaAPI('hamburger', restClient);
          await reloadCurrentPage({ page: _page });
          await expect(hamburgerToggle).toBeVisible();
          expect(
            await isNavLinkHidden('nav-top-contacts', { page: _page }),
            'nav-top-contacts should not be visible in hamburger layout',
          ).toBe(true);
          expect(
            await isNavLinkHidden('nav-left-contacts', { page: _page }),
            'nav-left-contacts should not be visible in hamburger layout',
          ).toBe(true);
        },
      },
    ];

    for (const variant of PERSISTENCE_VARIANTS) {
      test(
        `@functional @serial F8-LS2: selected layout persists after page refresh — ${variant.label}`,
        { tag: ['@functional', '@serial'] },
        async ({ page, restClient }) => {
          const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
          if (variant.skipOnMobile && isMobile) {
            test.skip(
              true,
              `F8-LS2 [${variant.label}]: NavLeft is not rendered on mobile — mobile always uses NavTop`,
            );
          }

          await variant.activate(page, restClient);
          try {
            await variant.assertActive(page, restClient);
          } finally {
            await resetNavLayout(restClient, `F8-LS2-${variant.layout}`);
          }
        },
      );
    }
  }); // end Layout switching

  // ── Hamburger Menu mechanics (mobile-web only) ─────────────────────────────

  test.describe('Hamburger Menu mechanics', () => {
    test('@functional @serial F8-HM1: hamburger menu opens on toggle tap', async ({
      page,
      restClient,
    }) => {
      // NavHamburger is desktop-only — mobile always renders NavTop regardless of
      // the layout setting. Mobile nav drawer mechanics are covered by F8-MN tests.
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(isMobile, 'F8-HM1: NavHamburger is desktop-only; see F8-MN for mobile nav');

      await activateHamburgerLayout(page, restClient);

      try {
        expect(
          await hamburgerDrawerDoesNotExist({ page }),
          'hamburger drawer should not exist before toggle tap',
        ).toBe(true);

        const result = await openHamburgerMenu({ page });

        expect(result.drawerVisible, 'hamburger drawer should be visible after toggle tap').toBe(
          true,
        );
        const drawer = await getHamburgerDrawerLocator({ page });
        await expect(drawer).toBeVisible();
      } finally {
        await resetNavLayout(restClient, 'F8-HM1');
      }
    });

    test('@functional @serial F8-HM2: hamburger menu closes on outside tap', async ({
      page,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(isMobile, 'F8-HM2: NavHamburger is desktop-only; see F8-MN for mobile nav');

      await activateHamburgerLayout(page, restClient);

      try {
        await openHamburgerMenu({ page });

        const drawer = await getHamburgerDrawerLocator({ page });
        await expect(drawer).toBeVisible();

        const result = await closeHamburgerMenuViaBackdrop({ page });

        expect(result.drawerClosed, 'hamburger drawer should close on outside tap').toBe(true);
        await expect(drawer).not.toBeVisible();
      } finally {
        await resetNavLayout(restClient, 'F8-HM2');
      }
    });

    test('@functional @serial F8-HM3: hamburger menu closes on navigation', async ({
      page,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(isMobile, 'F8-HM3: NavHamburger is desktop-only; see F8-MN for mobile nav');

      await activateHamburgerLayout(page, restClient);

      try {
        await openHamburgerMenu({ page });

        const drawer = await getHamburgerDrawerLocator({ page });
        await expect(drawer).toBeVisible();

        // Click a link — the NavLink onClick calls closeMenu().
        await navigateViaNavLink('hamburger', 'contacts', { page });

        // After navigation the drawer should be closed.
        await expect(drawer).not.toBeVisible();
      } finally {
        await resetNavLayout(restClient, 'F8-HM3');
      }
    });

    test('@functional @serial F8-HM4: hamburger menu — all destinations are accessible within the menu', async ({
      page,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(isMobile, 'F8-HM4: NavHamburger is desktop-only; see F8-MN for mobile nav');

      await activateHamburgerLayout(page, restClient);

      try {
        // Open the hamburger menu and verify all admin destinations are visible.
        await openHamburgerMenu({ page });

        for (const destination of Object.keys(ALL_ADMIN_DESTINATIONS)) {
          const link = await getNavLinkLocator('hamburger', destination, { page });
          await expect(
            link,
            `nav-hamburger-${destination} should be visible inside the open menu`,
          ).toBeVisible();
        }

        // Close menu before navigating away.
        await closeHamburgerMenuViaCloseButton({ page });
      } finally {
        await resetNavLayout(restClient, 'F8-HM4');
      }
    });

    test('@functional @serial F8-HM5: hamburger menu is keyboard-accessible (tab + enter)', async ({
      page,
      restClient,
    }) => {
      const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
      test.skip(isMobile, 'F8-HM5: NavHamburger is desktop-only; see F8-MN for mobile nav');

      await activateHamburgerLayout(page, restClient);

      try {
        // Focus the hamburger toggle and activate it via keyboard.

        const toggle = await getMenuToggleLocator({ page });
        await toggle.focus();
        await page.keyboard.press('Enter');

        // Drawer should open.
        const drawer = await getHamburgerDrawerLocator({ page });
        await expect(drawer).toBeVisible();

        // Focus should move into the drawer on open (NavHamburger.tsx focuses first link).
        // Tab once to reach the first nav link (past the close button), then Enter.
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');

        // After pressing Enter on a nav link the menu closes and navigation occurs.
        // Wait for the drawer to collapse — this is what the test actually needs to
        // be true and is more reliable than networkidle under CI load.
        await expect(drawer).not.toBeVisible();
      } finally {
        await resetNavLayout(restClient, 'F8-HM5');
      }
    });
  }); // end Hamburger Menu mechanics
}); // end Layout-mutating tests

// ---------------------------------------------------------------------------
// Mobile nav mechanics (mobile-web project only)
//
// On mobile viewports NavBar always renders NavTop regardless of the stored
// layout setting. These tests exercise the mobile nav drawer (mobile-nav-drawer)
// which is NavTop's built-in mobile hamburger drawer. No layout API calls needed.
// All interactions use the mobile nav behaviors.
// ---------------------------------------------------------------------------

test.describe('Mobile nav mechanics', () => {
  test('@functional F8-MN1: mobile nav drawer opens on toggle tap', async ({ page }) => {
    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
    test.skip(!isMobile, 'F8-MN1 only runs under the mobile-web Playwright project');

    await navigateToDashboard(page);

    expect(
      await isMobileNavDrawerHidden({ page }),
      'mobile nav drawer should be hidden before toggle tap',
    ).toBe(true);

    const result = await openMobileNav({ page });

    expect(result.drawerVisible, 'mobile nav drawer should be visible after toggle tap').toBe(true);
    const drawer = await getMobileNavDrawerLocator({ page });
    await expect(drawer).toBeVisible();
  });

  test('@functional F8-MN3: mobile nav drawer closes on toggle tap when open', async ({ page }) => {
    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
    test.skip(!isMobile, 'F8-MN3 only runs under the mobile-web Playwright project');

    await navigateToDashboard(page);

    await openMobileNav({ page });

    const drawer = await getMobileNavDrawerLocator({ page });
    await expect(drawer).toBeVisible();

    const result = await closeMobileNavViaToggle({ page });

    expect(result.drawerClosed, 'mobile nav drawer should close on toggle tap').toBe(true);
    await expect(drawer).not.toBeVisible();
  });

  test('@functional F8-MN4: mobile nav drawer closes on navigation', async ({ page }) => {
    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
    test.skip(!isMobile, 'F8-MN4 only runs under the mobile-web Playwright project');

    await navigateToDashboard(page);

    await openMobileNav({ page });

    const drawer = await getMobileNavDrawerLocator({ page });
    await expect(drawer).toBeVisible();

    await navigateViaMobileNavLink('contacts', { page });

    // NavTop's NavLink onClick calls closeMobileMenu() — drawer should be gone.
    await expect(drawer).not.toBeVisible();
  });

  test('@functional F8-MN5: mobile nav drawer — all rep destinations accessible', async ({
    page,
  }) => {
    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
    test.skip(!isMobile, 'F8-MN5 only runs under the mobile-web Playwright project');

    await navigateToDashboard(page);

    await openMobileNav({ page });

    const drawer = await getMobileNavDrawerLocator({ page });
    await expect(drawer).toBeVisible();

    for (const destination of Object.keys(REP_DESTINATIONS)) {
      const link = await getMobileNavLinkLocator(destination, { page });
      await expect(
        link,
        `nav-top-${destination}-mobile should be visible in the open mobile drawer`,
      ).toBeVisible();
    }

    await closeMobileNavViaToggle({ page });
  });

  test('@functional F8-MN6: mobile nav drawer — logout and language selector present', async ({
    page,
  }) => {
    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
    test.skip(!isMobile, 'F8-MN6 only runs under the mobile-web Playwright project');

    await navigateToDashboard(page);

    await openMobileNav({ page });

    const drawer = await getMobileNavDrawerLocator({ page });
    await expect(drawer).toBeVisible();

    await expect(
      await getMobileLogoutButtonLocator({ page }),
      'logout button should be present in mobile nav drawer',
    ).toBeVisible();
    await expect(
      await getMobileLanguageSelectLocator({ page }),
      'language selector should be present in mobile nav drawer',
    ).toBeVisible();

    await closeMobileNavViaToggle({ page });
  });
}); // end Mobile nav mechanics

// ---------------------------------------------------------------------------
// Deep linking — these tests use page.goto and do not touch nav-layout,
// so they can run in parallel safely outside the serial block.
// ---------------------------------------------------------------------------

test('@functional F8-DL1: deep link to /contacts/:id loads the correct contact detail view', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F8DL1',
    last_name: `DeepLink-${Date.now()}`,
  });

  // Navigate directly to the contact detail page without going through the list.
  await navigateToContact(page, contact.id);

  // The contact name heading is rendered once data loads.
  const nameHeading = await getContactNameLocator({ page });
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
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient, {
    name: `F8DL2 Account ${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F8DL2 Deal ${Date.now()}`,
    account_id: account.id,
  });

  // Navigate directly to the deal detail page.
  await navigateToDeal(page, deal.id);

  // The deal name heading is rendered once data loads.
  const nameHeading = await getDealNameHeadingLocator({ page });
  await expect(nameHeading).toBeVisible();
  await expect(nameHeading).toContainText(deal.name);

  const finalPath = new URL(page.url()).pathname;
  expect(finalPath, 'URL should remain on the deal detail route').toBe(`/deals/${deal.id}`);
});

test('@functional F8-DL3: deep link to a non-existent contact shows a meaningful not-found state', async ({
  page,
}) => {
  // Use an ID that is extremely unlikely to exist.
  await navigateToUrlAndWait('/contacts/00000000-0000-0000-0000-000000000000', { page });

  // ContactDetailPage renders role="alert" with the contacts.notFound message on error.
  // React Query fires its error state after the server 404 response arrives. Waiting
  // directly for the alert element is more reliable than networkidle because it targets
  // exactly the condition the test cares about, without a race on the 500 ms idle window.
  const alert = await getContactNotFoundLocator({ page }, 10_000);
  await expect(alert).toBeVisible({ timeout: 15_000 });
});

// MINCRM-192: F8-DL4 logs in as a rep via the UI — the browser must start
// unauthenticated so the login() behavior can navigate to /login correctly.
test.describe('Rep deep-link redirect', () => {
  // MINCRM-192: Use an empty storageState to prevent the project-level admin session
  // from loading. `undefined` does not override the project config — an explicit empty
  // object is required to start each test with a fresh, unauthenticated browser context.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('@functional F8-DL4: deep link to admin-only route as rep redirects to dashboard', async ({
    page,
    restClient,
  }) => {
    // Create a rep user for this test.
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const repEmail = `f8-rep-${uniqueSuffix}@example.com`;
    const repPassword = 'F8RepP@ss1234!';

    const inviteRes = await inviteUserViaApi(restClient, {
      name: `F8 Rep ${uniqueSuffix}`,
      email: repEmail,
      role: 'rep',
    });
    const rep = inviteRes.user;
    await setUserPassword(restClient, inviteRes.inviteToken, repPassword);

    try {
      await loginViaBrowser(repEmail, repPassword, { page });

      // Directly navigate to an admin-only route.
      await navigateToAdminSettings(page);

      const { pathname: finalPath } = await waitForRedirectToDashboard({ page }, 10_000);
      expect(finalPath, 'rep deep-linking to /admin/settings should be redirected to /').toBe('/');
    } finally {
      await loginAsAdmin(restClient).catch(() => null);
      await deactivateUser(restClient, rep.id).catch(() => null);
    }
  });
});

// ---------------------------------------------------------------------------
// Global UI — browser back / forward
// Uses page.goto for history building so it works regardless of viewport/layout.
// ---------------------------------------------------------------------------

test('@functional F8-GU1: browser back and forward navigate correctly between viewed pages', async ({
  page,
}) => {
  // Build history using page.goto so the test is layout- and viewport-independent.
  await navigateToDashboard(page);
  await navigateToContacts(page);
  await navigateToAccounts(page);

  let { pathname } = await navigateBack({ page });
  expect(pathname, 'browser back should navigate to /contacts').toBe('/contacts');

  ({ pathname } = await navigateBack({ page }));
  expect(pathname, 'browser back again should navigate to /').toBe('/');

  ({ pathname } = await navigateForward({ page }));
  expect(pathname, 'browser forward should navigate back to /contacts').toBe('/contacts');

  ({ pathname } = await navigateForward({ page }));
  expect(pathname, 'browser forward again should navigate to /accounts').toBe('/accounts');
});

test('@functional F8-GU2: browser tab title is set on load', async ({ page }) => {
  // MINCRM-192: storageState loads cookies but does not navigate. Load the app so the
  // HTML shell (with <title>) is present before reading page.title().
  await navigateToDashboard(page);

  // The app uses a static <title>MiniCRM</title> in index.html (no per-page title updates).
  // Verify the title is present, non-empty, and matches the expected brand name exactly.
  const title = await page.title();
  expect(title.length, 'page title should be non-empty').toBeGreaterThan(0);
  expect(title, 'page title should contain MiniCRM').toContain('MiniCRM');
  expect(title.trim(), 'page title should not have leading or trailing whitespace').toBe(title);
});
