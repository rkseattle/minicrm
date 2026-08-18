/**
 * F-LS — Lead scoring and AI narrative explanation
 *
 * Functional regression tests for the rule-based lead score badge and the
 * "Why this score?" AI narrative action on the Lead detail page.
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so generateLeadScoreNarrative bypasses
 *   the Anthropic SDK and returns a deterministic stub narrative.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestLead, createTestRep, navigateToLead } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  getLeadScoreBadgeText,
  requestLeadScoreNarrative,
  getLeadScoreNarrativeText,
} from '@behaviors/minicrm/leads.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

test(
  'F-LS1: the lead detail page shows a computed score badge',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const lead = await createTestLead(testData, restClient, {
      first_name: 'LS1',
      last_name: `Lead ${Date.now()}`,
    });

    await navigateToLead(page, lead.id);

    await expect(async () => {
      const badgeText = await getLeadScoreBadgeText({ page });
      expect(badgeText.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });
  },
);

test(
  'F-LS2: clicking "Why this score?" shows an inline AI narrative',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const lead = await createTestLead(testData, restClient, {
      first_name: 'LS2',
      last_name: `Lead ${Date.now()}`,
    });

    await navigateToLead(page, lead.id);

    await expect(async () => {
      const badgeText = await getLeadScoreBadgeText({ page });
      expect(badgeText.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });

    const result = await requestLeadScoreNarrative({ page });
    expect(result.status).toBe(200);

    await expect(async () => {
      const narrativeText = await getLeadScoreNarrativeText({ page });
      expect(narrativeText.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });
  },
);
