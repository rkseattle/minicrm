/**
 * SafeLocator — a structurally-restricted view of Playwright's Locator type.
 *
 * BoundHealingLocator.resolve() and HealingLocator.resolve() return this type
 * instead of the raw Playwright Locator. This blocks callers from escaping the
 * self-healing framework by calling child-locator factory methods on a resolved
 * locator.
 *
 * WHY EACH METHOD GROUP IS FORBIDDEN:
 *
 * Child-locator factories — locator(), getByTestId(), getByRole(), getByLabel(),
 * getByText(), getByPlaceholder(), getByAltText(), getByTitle():
 *   These return a new, raw Playwright Locator that is completely outside the
 *   healing framework. Any descendant element lookup built this way has no
 *   strategy fallback, no AI tier, and no HealingRegistry audit record. A
 *   single renamed data-testid or ARIA role silently breaks the test with no
 *   healing attempt — the exact failure mode the framework exists to prevent.
 *
 * filter():
 *   Derives a filtered Locator from an existing one, returning a new raw
 *   Locator. Same problem as the child-locator factories — the filtered result
 *   is unhealed. Scoped lookups should instead be expressed via the `within`
 *   field on LocatorStrategy so the framework can track and heal the full chain.
 *
 * first(), last(), nth():
 *   Return new Locator instances that point to a specific index in a matched
 *   set. While lower-risk than the factory methods (they do not introduce new
 *   selectors), they still produce raw, unhealed Locators. List-position
 *   assumptions are inherently fragile — if item order changes the index is
 *   wrong. These should be accessed through dedicated healing strategies rather
 *   than post-resolution index selection.
 *
 * WHAT REMAINS AVAILABLE:
 *   All interaction and inspection methods — click(), fill(), textContent(),
 *   waitFor(), count(), getAttribute(), isVisible(), isHidden(), isEnabled(),
 *   isDisabled(), isChecked(), inputValue(), screenshot(), selectOption(),
 *   check(), uncheck(), hover(), focus(), tap(), dispatchEvent(), press(),
 *   pressSequentially(), scrollIntoViewIfNeeded(), evaluate(),
 *   evaluateHandle(), innerHTML(), innerText(), allTextContents(),
 *   allInnerTexts(), blur() — remain accessible.
 *
 * WHY INTERFACE EXTENDING LOCATOR RATHER THAN Omit<Locator, ...>:
 *   Playwright's expect() overloads check `T extends Locator` to unlock
 *   locator-specific matchers like toBeVisible() and toContainText(). An
 *   Omit-based type alias strips the structural compatibility and loses those
 *   matchers. By extending Locator and overriding the forbidden properties with
 *   `never`, SafeLocator IS a Locator (so expect() matchers work) but calling
 *   any forbidden method is still a compile error.
 *
 * Because this is a pure type declaration (no runtime code), it carries zero
 * cost. The real Playwright Locator is structurally compatible with SafeLocator,
 * so the healing layer can return the real locator without any casting.
 */

import type { Locator } from '@playwright/test';

/**
 * A structurally-restricted Playwright Locator that exposes only interaction
 * and inspection methods. Child-locator factory methods are shadowed with
 * `never` so that escaping the self-healing framework via chained locator
 * construction is a TypeScript compile error.
 *
 * SafeLocator extends Locator to preserve compatibility with Playwright's
 * expect() locator-assertion overloads (toBeVisible, toContainText, etc.).
 */
export interface SafeLocator extends Locator {
  // Child-locator factories — shadowed with never to prevent healing escapes.
  locator: never;
  getByTestId: never;
  getByRole: never;
  getByLabel: never;
  getByText: never;
  getByPlaceholder: never;
  getByAltText: never;
  getByTitle: never;
  // Filter — derives a filtered Locator, also raw and unhealed.
  filter: never;
  // Index methods — return new Locator instances that bypass healing.
  first: never;
  last: never;
  nth: never;
}
