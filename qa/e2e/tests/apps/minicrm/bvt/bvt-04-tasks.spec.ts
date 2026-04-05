/**
 * BVT-04 — Task Flow
 *
 * Smoke-tests the task lifecycle:
 *   1. Create contact + task via API
 *   2. Navigate to My Tasks → task row is visible
 *   3. Mark task complete → row disappears from open-tasks view
 *   4. Teardown via TestDataManager (surgical — pre-existing count unchanged)
 *
 * Tagged @bvt so the suite can be run in isolation:
 *   npx playwright test --grep @bvt
 *
 * MINCRM-110
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToMyTasks,
  taskIsVisible,
  completeTask,
} from '@behaviors/minicrm/tasks.behaviors.js';
import { createTestContact, createTestActivity } from '@apps/minicrm/helpers.js';

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[BVT-04] E2E_ADMIN_PASSWORD is not set');

interface ActivityListResponse {
  data: unknown[];
  total: number;
}

test('@bvt BVT-04: task flow — create, list, complete, teardown', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;

  // ── Setup: authenticate REST client ──────────────────────────────────────
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const before = await restClient.get<ActivityListResponse>('/api/activities');
  const countBefore = before.body.total;

  // Create a contact to link the task to (activities require a linked record).
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const contact = await createTestContact(testData, restClient, {
    first_name: 'BVT4',
    last_name: `TaskContact-${uniqueSuffix}`,
  });

  // Create the task linked to that contact.
  const activity = await createTestActivity(testData, restClient, {
    type: 'Task',
    subject: `BVT4 Task ${uniqueSuffix}`,
    contact_id: contact.id,
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

  // ── 1. Navigate to My Tasks → task row visible ────────────────────────────
  const navResult = await navigateToMyTasks({ page, healPage, testName });
  expect(navResult.loaded, 'My Tasks page should load').toBe(true);

  const visibleResult = await taskIsVisible(activity.id, { page, healPage, testName });
  expect(visibleResult.visible, 'created task should appear in open tasks').toBe(true);

  // ── 2. Mark task complete → row disappears ────────────────────────────────
  const completeResult = await completeTask(activity.id, { page, healPage, testName });
  expect(completeResult.rowHidden, 'completed task should leave the open-tasks view').toBe(true);

  // ── Teardown + count assertion (AC6) ─────────────────────────────────────
  const teardownResults = await testData.teardown(restClient);
  expect(teardownResults.filter((r) => !r.success)).toHaveLength(0);

  const after = await restClient.get<ActivityListResponse>('/api/activities');
  expect(after.body.total, 'activity count should return to baseline').toBe(countBefore);
});
