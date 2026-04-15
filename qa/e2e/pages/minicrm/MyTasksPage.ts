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

import type { SafePage } from '@framework/fixtures/index.js';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';

/** Subset of Playwright fixtures required by MyTasksPage. */
export interface MyTasksPageContext {
  page: SafePage;
  healPage: HealPage;
  testName: string;
}

/**
 * Page Object for the MiniCRM My Tasks screen.
 */
export class MyTasksPage {
  private readonly page: SafePage;
  private readonly healPage: HealPage;
  private readonly testName: string;

  static readonly PATH = '/tasks';

  constructor(context: MyTasksPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
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
      await this.healPage
        .locate([
          { type: 'testId', value: 'my-tasks-heading' },
          { type: 'role', value: 'heading', options: { level: 1 } },
        ])
        .resolve(this.testName);
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
    await this.page.waitForLoadState('networkidle');
    try {
      const row = await this.healPage
        .locate([
          { type: 'testId', value: `task-row-${taskId}` },
          { type: 'css', value: `[data-testid="task-row-${taskId}"]` },
        ])
        .resolve(this.testName);
      return row.isVisible().catch(() => false);
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
    await this.healPage.click([
      { type: 'testId', value: `mark-complete-${taskId}` },
      { type: 'css', value: `[data-testid="mark-complete-${taskId}"]` },
    ]);
    // Wait for the row to disappear (query refetch removes it from open-tasks view).
    try {
      const row = await this.healPage
        .locate([
          { type: 'testId', value: `task-row-${taskId}` },
          { type: 'css', value: `[data-testid="task-row-${taskId}"]` },
        ])
        .resolve(this.testName);
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
