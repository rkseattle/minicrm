/**
 * SafePage — a structurally-restricted view of Playwright's Page type.
 *
 * Page Objects and Behaviors must accept `SafePage` instead of the full
 * Playwright `Page`. Only the navigation and browser-state primitives that have
 * no healing equivalent are exposed here. All element-locating and
 * element-action methods are accessed through HealMethods (locate / click /
 * fill / etc.) on PageFacade instead.
 *
 * WHY Pick RATHER THAN Omit:
 * The previous definition used Omit with an explicit blocklist of forbidden
 * methods. The problem with a blocklist is that Playwright introduces new
 * methods with every release — any new element-locating method would be
 * silently accessible on SafePage until someone remembered to add it to the
 * blocklist. A Pick allowlist inverts this: new Playwright methods are inert
 * by default and must be consciously added to remain accessible. This makes
 * the type future-proof and makes the permitted surface area explicit at a
 * glance. (MINCRM-228)
 *
 * Because this is a pure type alias (no runtime code), it carries zero cost.
 * The real Playwright `Page` is structurally compatible with `SafePage`, so
 * the fixture layer can pass the real page through without any casting.
 *
 * MINCRM-204, MINCRM-228
 */

import type { Page } from '@playwright/test';

/**
 * A structurally-restricted Playwright Page that exposes only navigation and
 * browser-state primitives. Page Objects and Behaviors must use this type (via
 * PageFacade) so that bypassing the self-healing framework is a compile error.
 */
export type SafePage = Pick<
  Page,
  | 'goto'
  | 'waitForLoadState'
  | 'waitForURL'
  | 'url'
  | 'title'
  | 'viewportSize'
  | 'setViewportSize'
  | 'evaluate'
  | 'waitForFunction'
  | 'waitForTimeout'
  | 'screenshot'
  | 'reload'
  | 'goBack'
  | 'goForward'
  | 'context'
  | 'keyboard'
  | 'mouse'
  | 'clock'
>;
