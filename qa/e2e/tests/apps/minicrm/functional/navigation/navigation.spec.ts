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
 *   - AC2: Hamburger Menu tests only run under mobile-web
 *   - AC3: Layout persistence verified by full page reload assertion
 *   - AC4: All nav links use data-testid following nav-{layout}-{destination} convention
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
// Top Nav layout — destination reachability and active state
// ---------------------------------------------------------------------------

test('@functional F8-TN1: top nav — all destinations reachable and correct page loads', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await setNavLayoutViaAPI('top', restClient);

  try {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

    for (const [destination, expectedPath] of Object.entries(ALL_ADMIN_DESTINATIONS)) {
      const result = await navigateViaNavLink('top', destination, { page, healPage, testName });

      expect(
        result.linkClicked,
        `top nav link "nav-top-${destination}" should be found and clickable`,
      ).toBe(true);

      const actualPath = new URL(result.finalUrl).pathname;
      expect(actualPath, `clicking nav-top-${destination} should navigate to ${expectedPath}`).toBe(
        expectedPath,
      );
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
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await setNavLayoutViaAPI('top', restClient);

  try {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

    // Navigate to Contacts and verify the Contacts link carries the active class.
    await navigateViaNavLink('top', 'contacts', { page, healPage, testName });

    const contactsLink = page.getByTestId('nav-top-contacts');
    const classAttr = await contactsLink.getAttribute('class');

    // The active class is 'bg-indigo-50 text-indigo-700' per NavTop.tsx navLinkClass.
    expect(classAttr, 'active nav-top-contacts should carry indigo active class').toContain(
      'text-indigo-700',
    );

    // A non-active link should not carry the active class.
    const dealsLink = page.getByTestId('nav-top-deals');
    const dealsClass = await dealsLink.getAttribute('class');
    expect(
      dealsClass,
      'inactive nav-top-deals should not carry the active indigo class',
    ).not.toContain('text-indigo-700');
  } finally {
    await resetNavLayout(restClient, 'F8-TN2');
  }
});

// ---------------------------------------------------------------------------
// Left Sidebar layout — destination reachability and active state
// ---------------------------------------------------------------------------

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
      const result = await navigateViaNavLink('left', destination, { page, healPage, testName });

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
    const classAttr = await accountsLink.getAttribute('class');

    // The active class is 'bg-indigo-50 text-indigo-700' per NavLeft.tsx sidebarLinkClass.
    expect(classAttr, 'active nav-left-accounts should carry indigo active class').toContain(
      'text-indigo-700',
    );

    // A non-active link should not carry the active class.
    const tasksLink = page.getByTestId('nav-left-tasks');
    const tasksClass = await tasksLink.getAttribute('class');
    expect(
      tasksClass,
      'inactive nav-left-tasks should not carry the active indigo class',
    ).not.toContain('text-indigo-700');
  } finally {
    await resetNavLayout(restClient, 'F8-LN2');
  }
});

// ---------------------------------------------------------------------------
// Hamburger layout — destination reachability and active state
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Layout switching — takes effect immediately, persists after refresh
// ---------------------------------------------------------------------------

test('@functional F8-LS1: switching layout in Settings renders the new nav immediately without full page reload', async ({
  page,
  healPage,
  restClient,
}) => {
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

    // Switch back to hamburger layout.
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

// ---------------------------------------------------------------------------
// Deep linking
// ---------------------------------------------------------------------------

test('@functional F8-DL1: deep link to /contacts/:id loads the correct contact detail view', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await setNavLayoutViaAPI('top', restClient);

  try {
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
  } finally {
    await resetNavLayout(restClient, 'F8-DL1');
  }
});

test('@functional F8-DL2: deep link to /deals/:id loads the correct deal detail view', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await setNavLayoutViaAPI('top', restClient);

  try {
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
  } finally {
    await resetNavLayout(restClient, 'F8-DL2');
  }
});

test('@functional F8-DL3: deep link to a non-existent contact shows a meaningful not-found state', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await setNavLayoutViaAPI('top', restClient);

  try {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

    // Use an ID that is extremely unlikely to exist.
    await page.goto('/contacts/00000000-0000-0000-0000-000000000000', { waitUntil: 'networkidle' });

    // ContactDetailPage renders role="alert" on error (contacts.notFound key).
    // The page must not be blank or show an unhandled 500.
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();

    // Must not be a blank page — the nav bar should still render.
    // (asserting the back-to-contacts link as a proxy for partial page render)
    const backLink = page.getByTestId('back-to-contacts');
    await expect(backLink).toBeVisible();
  } finally {
    await resetNavLayout(restClient, 'F8-DL3');
  }
});

test('@functional F8-DL4: deep link to admin-only route as rep redirects to dashboard', async ({
  page,
  healPage,
  restClient,
  playwright,
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

  const repRequestContext = await playwright.request.newContext();

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
    await repRequestContext.dispose().catch(() => null);
    await restClient
      .post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
    await restClient.patch(`/api/users/${rep.id}/deactivate`).catch(() => null);
    await resetNavLayout(restClient, 'F8-DL4');
  }
});

// ---------------------------------------------------------------------------
// Hamburger Menu mechanics (mobile-web project only via test.skip)
// ---------------------------------------------------------------------------

test('@functional F8-HM1: hamburger menu opens on toggle tap', async ({
  page,
  healPage,
  restClient,
}) => {
  // This scenario is specifically for the hamburger layout at mobile widths.
  // Skip on desktop where the hamburger layout may render differently.
  const isMobile = page.viewportSize()?.width !== undefined && page.viewportSize()!.width < 768;
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

    expect(result.drawerVisible, 'hamburger drawer should be visible after toggle tap').toBe(true);
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
  const isMobile = page.viewportSize()?.width !== undefined && page.viewportSize()!.width < 768;
  test.skip(!isMobile, 'F8-HM2 only runs under the mobile-web Playwright project');

  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await setNavLayoutViaAPI('hamburger', restClient);

  try {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

    // Open the menu.
    await openHamburgerMenu({ page, healPage, testName });

    const drawer = page.getByTestId('nav-hamburger-drawer');
    await expect(drawer).toBeVisible();

    // Close by tapping outside.
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
  const isMobile = page.viewportSize()?.width !== undefined && page.viewportSize()!.width < 768;
  test.skip(!isMobile, 'F8-HM3 only runs under the mobile-web Playwright project');

  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await setNavLayoutViaAPI('hamburger', restClient);

  try {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

    // Open menu.
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
  const isMobile = page.viewportSize()?.width !== undefined && page.viewportSize()!.width < 768;
  test.skip(!isMobile, 'F8-HM4 only runs under the mobile-web Playwright project');

  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await setNavLayoutViaAPI('hamburger', restClient);

  try {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

    // Open the hamburger menu once and verify all admin destinations are visible.
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
  const isMobile = page.viewportSize()?.width !== undefined && page.viewportSize()!.width < 768;
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
    // Tab to the first link within the drawer and press Enter to navigate.
    // The close button is the first focusable element; tab once to reach first nav link.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    // After pressing Enter on a nav link the menu closes and navigation occurs.
    await page.waitForLoadState('networkidle').catch(() => null);
    await expect(drawer).not.toBeVisible();
  } finally {
    await resetNavLayout(restClient, 'F8-HM5');
  }
});

// ---------------------------------------------------------------------------
// Global UI — browser back / forward
// ---------------------------------------------------------------------------

test('@functional F8-GU1: browser back and forward navigate correctly between viewed pages', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await setNavLayoutViaAPI('top', restClient);

  try {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

    // Build up a history: dashboard → contacts → accounts.
    await navigateViaNavLink('top', 'dashboard', { page, healPage, testName });
    await navigateViaNavLink('top', 'contacts', { page, healPage, testName });
    await navigateViaNavLink('top', 'accounts', { page, healPage, testName });

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
  } finally {
    await resetNavLayout(restClient, 'F8-GU1');
  }
});

test('@functional F8-GU2: browser tab title is set on load', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await setNavLayoutViaAPI('top', restClient);

  try {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

    // The app uses a static <title>MiniCRM</title> in index.html (no per-page title updates).
    // Verify the title is present and non-empty on the dashboard.
    const title = await page.title();
    expect(title.length, 'page title should be non-empty').toBeGreaterThan(0);
    expect(title, 'page title should contain MiniCRM').toContain('MiniCRM');
  } finally {
    await resetNavLayout(restClient, 'F8-GU2');
  }
});
