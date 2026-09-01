/**
 * F8-PNL — Personal navigation layout preference
 *
 * Covers a user choosing a navigation layout for themselves, differing from the
 * workspace default, and keeping it across a reload.
 *
 * Framework conventions:
 *   - Tagged @functional only. These tests write the caller's own users row via
 *     PATCH /api/v1/users/me/nav-layout, never the shared system_settings row, so
 *     they need no @serial tag, no RESOURCE_REGISTRY entry, and deliberately no
 *     ensureSystemDefaults() call — which would itself write settings.nav_layout
 *     and force the tag.
 *   - The workspace row is read once, only to pick a personal value that differs from
 *     whatever it holds. No assertion depends on that row's value: ensureSystemDefaults
 *     resets it to 'top' from eleven concurrent specs, and clearing a personal value
 *     re-reads it, so asserting on it would be a race.
 *   - Each test owns an ephemeral user via the fixtures, which register teardown.
 *
 * AC notes:
 *   - A user sets a layout differing from the workspace default and sees it after reload.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  navigateToProfile,
  saveProfileNavLayout,
  readProfileNavLayout,
  setUserNavLayout,
  loginAsAdmin,
  getWorkspaceNavLayout,
} from '@behaviors/minicrm/index.js';
import { loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  reloadCurrentPage,
  expectNavLinkVisible,
  isNavLinkHidden,
} from '@behaviors/minicrm/nav.behaviors.js';
import type { NavBehaviorContext } from '@behaviors/minicrm/nav.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * The two layouts render distinguishable navs — 'left' shows the sidebar links and
 * hides the top ones — so the assertions can tell which one is actually on screen.
 */
function layoutDifferentFrom(workspaceLayout: string): 'top' | 'left' {
  return workspaceLayout === 'left' ? 'top' : 'left';
}

/**
 * Asserts the navigation actually rendered for `layout`, not merely what a form shows.
 * No-ops below the desktop breakpoint: mobile always renders the top bar regardless of
 * the stored layout, so a 'left' assertion could never hold there.
 */
async function expectNavRendered(
  layout: 'top' | 'left',
  context: NavBehaviorContext,
): Promise<void> {
  const [visible, hidden] =
    layout === 'left'
      ? (['left', 'nav-top-contacts'] as const)
      : (['top', 'nav-left-contacts'] as const);

  await expectNavLinkVisible(visible, 'contacts', context);
  expect(
    await isNavLinkHidden(hidden, context),
    `${hidden} should not be visible in the ${layout} layout`,
  ).toBe(true);
}

test.describe('Personal navigation layout', () => {
  // Mobile always renders the top bar whatever the stored layout, so the rendering
  // assertion has nothing to distinguish. Skipped rather than degraded to the form
  // control alone, which would pass even if resolution were never wired up.
  test.skip(
    ({ viewport }) => (viewport?.width ?? 1024) < 1024,
    'desktop-only: mobile ignores the nav layout setting',
  );

  test('@functional F8-PNL1: a chosen layout survives a reload', async ({
    page,
    restClient,
    ephemeralRep,
  }) => {
    await loginAsAdmin(restClient);
    const workspaceLayout = await getWorkspaceNavLayout(restClient);
    const personalLayout = layoutDifferentFrom(workspaceLayout);

    await loginViaBrowser(ephemeralRep.email, ephemeralRep.password, { page });
    await navigateToProfile({ page });

    const status = await saveProfileNavLayout(personalLayout, { page });
    expect(status, 'saving a personal nav layout should succeed').toBe(200);

    await reloadCurrentPage({ page });

    // The rendered nav is what the user sees; the form control reads its own query
    // and would still show the saved value even if resolution were never wired up.
    await expectNavRendered(personalLayout, { page });

    await navigateToProfile({ page });
    expect(
      await readProfileNavLayout({ page }),
      'the personal layout should still be selected after a reload',
    ).toBe(personalLayout);
  });

  test('@functional F8-PNL2: clearing the preference returns to the workspace default', async ({
    page,
    restClient,
    ephemeralRep,
  }) => {
    await loginAsAdmin(restClient);
    const workspaceLayout = await getWorkspaceNavLayout(restClient);
    const personalLayout = layoutDifferentFrom(workspaceLayout);

    // Seed through the API as the rep, so the UI starts from a stored preference.
    await restClient.post('/api/v1/auth/login', {
      email: ephemeralRep.email,
      password: ephemeralRep.password,
    });
    await setUserNavLayout(restClient, personalLayout);
    await loginAsAdmin(restClient);

    await loginViaBrowser(ephemeralRep.email, ephemeralRep.password, { page });
    await navigateToProfile({ page });
    expect(await readProfileNavLayout({ page })).toBe(personalLayout);

    const status = await saveProfileNavLayout('', { page });
    expect(status, 'clearing the preference should succeed').toBe(200);

    await reloadCurrentPage({ page });
    await navigateToProfile({ page });
    expect(
      await readProfileNavLayout({ page }),
      'the selector should show the workspace-default option once cleared',
    ).toBe('');
  });
});
