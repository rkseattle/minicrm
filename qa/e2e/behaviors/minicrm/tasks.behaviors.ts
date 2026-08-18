/**
 * Tasks behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 *
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { MyTasksPage } from '@pages/minicrm/MyTasksPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by task behaviors. */
export interface TasksBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// navigateToMyTasks()
// ---------------------------------------------------------------------------

/** Result returned by navigateToMyTasks. */
export interface NavigateToMyTasksResult {
  /** True when the My Tasks page loaded successfully. */
  loaded: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to the My Tasks page and waits for it to be ready.
 *
 * @param context - Playwright fixture context.
 * @returns NavigateToMyTasksResult describing the outcome.
 */
export async function navigateToMyTasks(
  context: TasksBehaviorContext,
): Promise<NavigateToMyTasksResult> {
  const tasksPage = new MyTasksPage(context);
  await tasksPage.navigate();
  const loaded = await tasksPage.isLoaded();
  const finalUrl = tasksPage.url();
  return { loaded, finalUrl };
}

// ---------------------------------------------------------------------------
// taskIsVisible()
// ---------------------------------------------------------------------------

/** Result returned by taskIsVisible. */
export interface TaskIsVisibleResult {
  /** True when the task row is present and visible on the page. */
  visible: boolean;
}

/**
 * Navigates to the My Tasks page (if not already there) and checks whether
 * the given task row is visible (i.e. the task is open and listed).
 *
 * @param taskId - Activity UUID.
 * @param context - Playwright fixture context.
 * @returns TaskIsVisibleResult.
 *
 * @example
 * ```ts
 * const result = await taskIsVisible(activity.id, { page });
 * expect(result.visible).toBe(true);
 * ```
 */
export async function taskIsVisible(
  taskId: string,
  context: TasksBehaviorContext,
): Promise<TaskIsVisibleResult> {
  const tasksPage = new MyTasksPage(context);

  if (!context.page.url().includes(MyTasksPage.PATH)) {
    await tasksPage.navigate();
    await tasksPage.isLoaded();
  }

  const visible = await tasksPage.taskRowIsVisible(taskId);
  return { visible };
}

// ---------------------------------------------------------------------------
// completeTask()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// showCompletedTasks()
// ---------------------------------------------------------------------------

/**
 * Clicks the "Show completed" toggle on the My Tasks page so completed task
 * rows become visible. Assumes the caller is already on the My Tasks page.
 *
 * @param context - Playwright fixture context.
 */
export async function showCompletedTasks(context: TasksBehaviorContext): Promise<void> {
  const tasksPage = new MyTasksPage(context);
  await tasksPage.clickToggleCompleted();
}

// ---------------------------------------------------------------------------
// completeTask()
// ---------------------------------------------------------------------------

/** Result returned by completeTask. */
export interface CompleteTaskResult {
  /**
   * True when the task row is no longer visible after marking complete.
   * (Open tasks are hidden from the default view once complete.)
   */
  rowHidden: boolean;
}

/**
 * Marks a task as complete via the My Tasks page "Mark complete" button and
 * confirms the row disappears from the open-tasks view.
 *
 * @param taskId - Activity UUID.
 * @param context - Playwright fixture context.
 * @returns CompleteTaskResult.
 *
 * @example
 * ```ts
 * const result = await completeTask(activity.id, { page });
 * expect(result.rowHidden).toBe(true);
 * ```
 */
export async function completeTask(
  taskId: string,
  context: TasksBehaviorContext,
): Promise<CompleteTaskResult> {
  const tasksPage = new MyTasksPage(context);

  if (!context.page.url().includes(MyTasksPage.PATH)) {
    await tasksPage.navigate();
    await tasksPage.isLoaded();
  }

  await tasksPage.markComplete(taskId);

  // After marking complete, the row should no longer be visible in the open list.
  const stillVisible = await tasksPage.taskRowIsVisible(taskId);
  return { rowHidden: !stillVisible };
}
