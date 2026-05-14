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
        .locate(
          [
            { type: 'testId', value: 'my-tasks-heading' },
            { type: 'role', value: 'heading', options: { level: 1 } },
          ],
          { intent: 'my tasks page heading indicating page is loaded' },
        )
        .resolve();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns whether a task row is currently visible (i.e. shown as open).
   *
   * @param taskId - Activity UUID.
   */
  async taskRowIsVisible(taskId: string): Promise<boolean> {
    try {
      const row = await this.page
        .locate(
          [
            { type: 'testId', value: `task-row-${taskId}` },
            { type: 'css', value: `[data-testid="task-row-${taskId}"]` },
          ],
          { intent: 'task row in the open tasks list' },
        )
        .resolve();
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
   * @param taskId - Activity UUID.
   */
  async markComplete(taskId: string): Promise<void> {
    const btn = await this.page
      .locate(
        [
          { type: 'testId', value: `mark-complete-${taskId}` },
          { type: 'css', value: `[data-testid="mark-complete-${taskId}"]` },
        ],
        { intent: 'mark complete button for task row' },
      )
      .resolve();
    await btn.click();
    try {
      const row = await this.page
        .locate(
          [
            { type: 'testId', value: `task-row-${taskId}` },
            { type: 'css', value: `[data-testid="task-row-${taskId}"]` },
          ],
          { intent: 'task row to wait for removal after completion' },
        )
        .resolve();
      await row.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => null);
    } catch {
      // Row already gone — nothing to wait for.
    }
  }

  /**
   * Returns a resolved locator for the task row for the given task ID.
   * Returns null if the row is not in the DOM.
   *
   * @param taskId - Activity UUID.
   */
  async taskRowLocator(taskId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `task-row-${taskId}` },
          { type: 'css', value: `[data-testid="task-row-${taskId}"]` },
        ],
        { intent: 'task row in the open tasks list' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the overdue badge on a task row.
   * Throws if not found — the task must have a past due date.
   *
   * @param taskId - Activity UUID.
   */
  async overdueTaskBadgeLocator(taskId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `task-overdue-badge-${taskId}` },
          { type: 'css', value: `[data-testid="task-overdue-badge-${taskId}"]` },
        ],
        { intent: 'overdue badge on a task row' },
      )
      .resolve();
  }

  /**
   * Clicks the toggle to show completed tasks in the list.
   */
  async clickToggleCompleted(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'toggle-completed-button' },
        { type: 'role', value: 'button', options: { name: /completed/i } },
      ],
      { intent: 'toggle button to show completed tasks in the list' },
    );
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
