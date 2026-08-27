/**
 * Connected mailbox behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { ProfilePage } from '@pages/minicrm/ProfilePage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by connected-account behaviors. */
export interface ConnectedAccountsBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

/**
 * Opens the profile page and waits for it to render.
 */
export async function openProfilePage(ctx: ConnectedAccountsBehaviorContext): Promise<void> {
  const profilePage = new ProfilePage(ctx);
  await profilePage.navigate();
  // isLoaded() resolves the heading through the healing locator rather than a raw
  // selector, so a testId rename is caught by the page object instead of here.
  await profilePage.isLoaded();
}

/**
 * Reports whether the connected mailboxes panel is on the page.
 */
export async function connectedAccountsPanelIsVisible(
  ctx: ConnectedAccountsBehaviorContext,
): Promise<boolean> {
  const profilePage = new ProfilePage(ctx);
  return profilePage.connectedAccountsSectionIsVisible();
}

/**
 * Reads the href each provider button points at.
 */
export async function readOAuthConnectHref(
  ctx: ConnectedAccountsBehaviorContext,
  provider: 'google' | 'microsoft',
): Promise<string | null> {
  const profilePage = new ProfilePage(ctx);
  return profilePage.oauthConnectHref(provider);
}
