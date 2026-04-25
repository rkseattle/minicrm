/**
 * MyTasksPage — Page Object for the MiniCRM My Tasks screen.
 *
 * Covers the task list view at `/tasks`. Provides methods for checking task
 * visibility and marking tasks complete.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-110
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by MyTasksPage. */
export interface MyTasksPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM My Tasks screen.
 */
export class MyTasksPage {
  private readonly page: PageFacade;

  static readonly PATH = '/tasks';

  constructor(context: MyTasksPageContext) {
    this.page = context.page;
  }

  /**
   * Navigates directly to the My Tasks URL.
   */
  async navigate(): Promise<void> {
    await this.page.goto(MyTasksPage.PATH);
  }

  /**
   * Returns whether the My Tasks page is loaded (heading visible).
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.page
        .locate([
          { type: 'testId', value: 'my-tasks-heading' },
          { type: 'role', value: 'heading', options: { level: 1 } },
        ])
        .resolve();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns whether a task row is currently visible (i.e. shown as open).
   *
   * Both the mobile card (<li>) and desktop table (<tr>) carry the same
   * data-testid. We filter to the visible copy so this works at any viewport.
   *
   * @param taskId - Activity UUID.
   */
  async taskRowIsVisible(taskId: string): Promise<boolean> {
    try {
      const row = await this.page
        .locate([
          { type: 'testId', value: `task-row-${taskId}` },
          { type: 'css', value: `[data-testid="task-row-${taskId}"]` },
        ])
        // Use a longer fallback so React Query has time to fetch after navigation.
        .resolve();
      // Both mobile card and desktop table carry this testid — waitFor visible
      // works on multi-match locators without strict mode issues. MINCRM-234
      await row.waitFor({ state: 'visible', timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clicks the "Mark complete" button for the given task and waits for the row
   * to leave the open-tasks view.
   *
   * After the PATCH succeeds, React Query invalidates the task list and refetches.
   * We wait for the row to become hidden rather than relying on networkidle, which
   * can fire before the query refetch updates the DOM.
   *
   * Both the mobile card and desktop table carry the same data-testids, so all
   * locators filter to the visible copy to work at any viewport width.
   *
   * @param taskId - Activity UUID.
   */
  async markComplete(taskId: string): Promise<void> {
    // Click the visible "Mark complete" button (mobile card or desktop table).
    const btn = await this.page
      .locate([
        { type: 'testId', value: `mark-complete-${taskId}` },
        { type: 'css', value: `[data-testid="mark-complete-${taskId}"]` },
      ])
      .resolve();
    // btn may match mobile and desktop copies — click() on a multi-match locator
    // works when exactly one is visible. MINCRM-234
    await btn.click();
    // Wait for the visible row to disappear (query refetch removes it from open-tasks view).
    try {
      const row = await this.page
        .locate([
          { type: 'testId', value: `task-row-${taskId}` },
          { type: 'css', value: `[data-testid="task-row-${taskId}"]` },
        ])
        .resolve();
      await row.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => null);
    } catch {
      // Row already gone — nothing to wait for.
    }
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
