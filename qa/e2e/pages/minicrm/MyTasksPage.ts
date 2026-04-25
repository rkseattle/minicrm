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
   * Desktop and mobile each have a unique testid suffix (-desktop / -mobile)
   * so each strategy matches exactly one element regardless of viewport. MINCRM-234
   *
   * @param taskId - Activity UUID.
   */
  async taskRowIsVisible(taskId: string): Promise<boolean> {
    try {
      const row = await this.page
        .locate([
          // CSS selector list matches whichever viewport copy is visible.
          // Each testid is unique per viewport (MINCRM-234) so this resolves
          // to exactly one element without strict mode violations.
          {
            type: 'css',
            value: `[data-testid="task-row-desktop-${taskId}"]:visible, [data-testid="task-row-mobile-${taskId}"]:visible`,
          },
        ])
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
   * Both the mobile card and desktop table carry the same data-testids, so all
   * locators filter to the visible copy to work at any viewport width.
   *
   * @param taskId - Activity UUID.
   */
  async markComplete(taskId: string): Promise<void> {
    const btn = await this.page
      .locate([
        {
          type: 'css',
          value: `[data-testid="mark-complete-desktop-${taskId}"]:visible, [data-testid="mark-complete-mobile-${taskId}"]:visible`,
        },
      ])
      .resolve();
    await btn.click();
    try {
      const row = await this.page
        .locate([
          {
            type: 'css',
            value: `[data-testid="task-row-desktop-${taskId}"]:visible, [data-testid="task-row-mobile-${taskId}"]:visible`,
          },
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
