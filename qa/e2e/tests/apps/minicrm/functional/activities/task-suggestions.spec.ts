/**
 * F-TS — AI follow-up task suggestions after activity logging
 *
 * Functional regression tests for the task-suggestion panel shown once,
 * immediately after saving a Call/Meeting/Email activity.
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so generateTaskSuggestions bypasses the
 *   Anthropic SDK and returns a deterministic stub suggestion.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestRep, navigateToContact } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  isTaskSuggestionPanelVisible,
  acceptTaskSuggestion,
  logActivity,
  getActivities,
} from '@behaviors/minicrm/activities.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

test(
  'F-TS1: saving a Call activity shows the suggestion panel, and accepting creates a linked Task',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'TS1',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);

    await logActivity({ type: 'Call', direction: 'Outbound', subject: 'Discovery call' }, { page });

    await expect(async () => {
      expect(await isTaskSuggestionPanelVisible({ page })).toBe(true);
    }).toPass({ timeout: 10_000 });

    await acceptTaskSuggestion(0, { page });

    await expect(async () => {
      const activities = await getActivities(restClient, { contact: contact.id });
      expect(activities.some((a) => a.type === 'Task')).toBe(true);
    }).toPass({ timeout: 10_000 });
  },
);
