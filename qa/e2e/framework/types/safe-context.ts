/**
 * SafeContext — a structurally-restricted view of Playwright's BrowserContext type.
 *
 * SafePage.context() returns this type instead of the raw BrowserContext.
 * This blocks callers from creating unhealed Pages or opening raw CDP sessions
 * via the context object.
 *
 * THREAT MODEL:
 *
 * newPage():
 *   Creates a brand-new Playwright Page that is NOT wrapped in a PageFacade.
 *   Any test author writing a multi-tab scenario who calls context().newPage()
 *   directly receives a raw Page — bypassing HealingLocator, HealingRegistry,
 *   and SafePage enforcement entirely for the new tab. The self-healing
 *   guarantee only holds for the initial `page` fixture; every additional tab
 *   created via context().newPage() is completely unprotected.
 *   The safe alternative is PageFacade.newTab(), which calls newPage() internally
 *   and wraps the result in createPageFacade(), ensuring the new tab participates
 *   in the same healing, audit, and type-safety guarantees.
 *
 * newCDPSession():
 *   Opens a raw Chrome DevTools Protocol channel on a page or worker. CDP
 *   grants unrestricted access to browser internals — network interception,
 *   JS evaluation, DOM mutation, and more — all outside the framework's
 *   audit layer. There is no healing or HealingRegistry equivalent for CDP
 *   commands. This is an extremely powerful escape hatch that offers no
 *   guardrails and should never be called from test code.
 *
 * Because this is a pure type alias (no runtime code), it carries zero cost.
 * The real Playwright BrowserContext is structurally compatible with
 * SafeContext, so the proxy layer can pass it through without any casting.
 */

import type { BrowserContext } from '@playwright/test';

/**
 * A structurally-restricted Playwright BrowserContext that blocks methods
 * which would bypass the self-healing framework. Use PageFacade.newTab()
 * to open additional tabs in multi-tab tests.
 */
export type SafeContext = Omit<BrowserContext, 'newPage' | 'newCDPSession'>;
