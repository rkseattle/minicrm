/**
 * SafePage — a structurally-restricted view of Playwright's Page type.
 *
 * Page Objects and Behaviors must accept `SafePage` instead of the full
 * Playwright `Page`. The omitted methods are exactly the ones that locate
 * elements or perform element-level actions without going through the
 * self-healing framework (healPage.locate / healPage.click / healPage.fill).
 *
 * The remaining methods are navigation and browser-state primitives that have
 * no healing equivalent and are legitimately used in Page Objects:
 *   goto, url, waitForURL, waitForLoadState, waitForTimeout, reload,
 *   goBack, goForward, keyboard, mouse, title, context, viewportSize, evaluate
 *
 * Because this is a pure type alias (no runtime code), it carries zero cost.
 * The real Playwright `Page` is structurally compatible with `SafePage`, so
 * the fixture layer can pass the real page through without any casting.
 *
 * MINCRM-204
 */

import type { Page } from '@playwright/test';

/** Forbidden methods — element locators and element-level actions. */
type ForbiddenPageMethods =
  | 'getByTestId'
  | 'getByRole'
  | 'getByLabel'
  | 'getByText'
  | 'getByPlaceholder'
  | 'getByAltText'
  | 'getByTitle'
  | 'locator'
  | 'waitForSelector'
  | 'click'
  | 'fill'
  | 'type'
  | 'check'
  | 'uncheck'
  | 'selectOption'
  | 'hover'
  | 'focus'
  | 'tap'
  | 'dispatchEvent'
  | 'innerHTML'
  | 'innerText'
  | 'inputValue'
  | 'textContent'
  | 'getAttribute'
  | 'isVisible'
  | 'isEnabled'
  | 'isChecked'
  | 'isDisabled'
  | 'isEditable'
  | 'isHidden';

/**
 * A structurally-restricted Playwright Page that omits all element-locating
 * and element-action methods. Page Objects and Behaviors must use this type
 * so that bypassing the self-healing framework is a compile error.
 */
export type SafePage = Omit<Page, ForbiddenPageMethods>;
