/**
 * SafePage — a structurally-restricted view of Playwright's Page type.
 *
 * Page Objects and Behaviors must accept `SafePage` instead of the full
 * Playwright `Page`. Only the navigation and browser-state primitives that have
 * no healing equivalent are exposed here. All element-locating and
 * element-action methods are accessed through HealMethods (locate / click /
 * fill / etc.) on PageFacade instead.
 *
 * WHY Pick RATHER THAN Omit (MINCRM-228, MINCRM-236):
 * A blocklist (Omit) is structurally unsound: Playwright introduces new methods
 * with every release and any new element-locating or element-action method
 * would be silently accessible on SafePage until someone remembered to add it
 * to the blocklist. The framework's self-healing boundary would degrade without
 * any warning. A Pick allowlist inverts this: new Playwright methods are
 * automatically inert on SafePage and must be consciously added to
 * AllowedPageMethods before they become accessible. New methods are blocked by
 * default; the framework stays safe without manual intervention.
 *
 * context() is excluded from the Pick and re-declared as a method returning
 * SafeContext (not BrowserContext). SafeContext omits newPage() and
 * newCDPSession() to prevent unhealed Page creation and raw CDP access.
 * Use PageFacade.newTab() to open a healed second tab. The actual return-type
 * narrowing is enforced at the PageFacade proxy layer. (MINCRM-235)
 *
 * Because this is a pure type alias (no runtime code), it carries zero cost.
 * The real Playwright `Page` is structurally compatible with `SafePage`, so
 * the fixture layer can pass the real page through without any casting.
 *
 * MINCRM-204, MINCRM-228, MINCRM-235, MINCRM-236
 */

import type { Page } from '@playwright/test';
import type { SafeContext } from './safe-context.js';

/**
 * The explicit allowlist of Page methods accessible on SafePage.
 *
 * To add a new method: confirm it has no healing equivalent (i.e. it is a
 * navigation or browser-state primitive) and add its name here. The Pick
 * will fail to compile if the name does not exist on Playwright's Page type,
 * so typos and removals are caught at build time.
 *
 * `context` is intentionally absent — it is re-declared below as returning
 * SafeContext rather than the raw BrowserContext. (MINCRM-235)
 */
type AllowedPageMethods =
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
  | 'keyboard'
  | 'mouse'
  | 'clock';

/**
 * A structurally-restricted Playwright Page that exposes only navigation and
 * browser-state primitives. Page Objects and Behaviors must use this type (via
 * PageFacade) so that bypassing the self-healing framework is a compile error.
 *
 * Uses a positive Pick (AllowedPageMethods) rather than a negative Omit so
 * that future Playwright methods are blocked by default. (MINCRM-236)
 */
export type SafePage = Pick<Page, AllowedPageMethods> & {
  /**
   * Returns the browser context for this page, restricted to SafeContext.
   * SafeContext omits newPage() and newCDPSession() to prevent unhealed Page
   * creation and raw CDP access. Use PageFacade.newTab() to open a healed
   * second tab. (MINCRM-235)
   */
  context(): SafeContext;
};
