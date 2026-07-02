/**
 * F-AI-FE — AI Data Minimization / Field Exclusions (MINCRM-461)
 *
 * Covers admin-configurable AI field exclusion toggles and their effect on the
 * always-excluded (locked) defaults.
 *
 * Test groups:
 *   F-AI-FE-1 — AI settings panel shows the always-excluded fields list
 *   F-AI-FE-2 — Admin can toggle a standard field exclusion on and see it persist
 *   F-AI-FE-3 — GET /admin/ai/field-exclusions returns the effective exclusion list
 *   F-AI-FE-4 — PATCH /admin/ai/field-exclusions rejects an unknown field name
 *   F-AI-FE-5 — PATCH /admin/ai/field-exclusions persists a toggle via the API
 *
 * E2E limitations:
 *   - Verifying that an excluded field is actually stripped from a real AI
 *     tool-call payload requires calling the live Anthropic API, which this
 *     environment stubs out — that behavior is covered directly by
 *     server/src/__tests__/piiFilter.test.ts and aiFieldExclusionService.test.ts.
 *
 * Framework conventions:
 *   - All tests tagged @functional @serial (mutates the shared ai_field_exclusions table)
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behavior functions imported from @behaviors/* only — never @pages/*
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToAdminSettings,
  getAiAlwaysExcludedFields,
  clickAiFieldExclusionToggle,
  getAiFieldExclusionToggle,
  resetAiFieldExclusion,
  setAiEnabled,
} from '@behaviors/minicrm/settings.behaviors.js';
import { createTestAdmin } from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/index.js';

test.use({ storageState: { cookies: [], origins: [] } });

// These tests share the global ai_field_exclusions table — run serially to
// prevent concurrent PATCH calls racing each other.
test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// F-AI-FE-1 and F-AI-FE-2 — UI tests
// ---------------------------------------------------------------------------

test.describe('AI data minimization UI', () => {
  test.afterEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await resetAiFieldExclusion(restClient, 'contact', 'department');
  });

  test(
    'F-AI-FE-1: AI settings panel shows the always-excluded fields list @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ page, testData, restClient }) => {
      await loginAsAdmin(restClient);
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai');

      await expect(await getAiAlwaysExcludedFields({ page })).toBeVisible({ timeout: 8_000 });
    },
  );

  test(
    'F-AI-FE-2: admin can toggle a standard field exclusion on and it persists @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ page, testData, restClient }) => {
      await loginAsAdmin(restClient);
      // The field exclusion toggles live inside the panel region AiSettings
      // disables whenever ai_features is off (everything except the master
      // toggle itself) — depend on ambient DB state otherwise, which other
      // specs can leave disabled.
      await setAiEnabled(restClient, true);
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai');

      const toggle = await getAiFieldExclusionToggle('contact', 'department', { page });
      await expect(toggle).toBeVisible({ timeout: 8_000 });
      await expect(toggle).not.toBeChecked();

      await clickAiFieldExclusionToggle('contact', 'department', { page });

      await expect(toggle).toBeChecked({ timeout: 8_000 });

      const res = await restClient.get<{
        standard_fields: Array<{ entity_type: string; field_name: string; excluded: boolean }>;
      }>('/api/v1/admin/ai/field-exclusions');
      const dept = res.body.standard_fields.find(
        (f) => f.entity_type === 'contact' && f.field_name === 'department',
      );
      expect(dept?.excluded).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// F-AI-FE-3 through F-AI-FE-5 — API tests
// ---------------------------------------------------------------------------

test.describe('AI data minimization API', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
  });

  test.afterEach(async ({ restClient }) => {
    await resetAiFieldExclusion(restClient, 'account', 'website');
  });

  test(
    'F-AI-FE-3: GET /admin/ai/field-exclusions returns the effective exclusion list @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ restClient }) => {
      const res = await restClient.get<{
        always_excluded: string[];
        standard_fields: unknown[];
        custom_fields: unknown[];
      }>('/api/v1/admin/ai/field-exclusions');
      expect(res.status).toBe(200);
      expect(res.body.always_excluded).toContain('password_hash');
      expect(Array.isArray(res.body.standard_fields)).toBe(true);
      expect(Array.isArray(res.body.custom_fields)).toBe(true);
    },
  );

  test(
    'F-AI-FE-4: PATCH /admin/ai/field-exclusions rejects an unknown field name @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ restClient }) => {
      let errorStatus = 0;
      try {
        await restClient.patch('/api/v1/admin/ai/field-exclusions', {
          entity_type: 'contact',
          field_name: 'not_a_real_field',
          excluded: true,
        });
      } catch (err) {
        if (err instanceof RestClientError) {
          errorStatus = err.status;
        } else {
          throw err;
        }
      }
      expect(errorStatus).toBe(400);
    },
  );

  test(
    'F-AI-FE-5: PATCH /admin/ai/field-exclusions persists a toggle @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ restClient }) => {
      const res = await restClient.patch<{
        entity_type: string;
        field_name: string;
        excluded: boolean;
      }>('/api/v1/admin/ai/field-exclusions', {
        entity_type: 'account',
        field_name: 'website',
        excluded: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.excluded).toBe(true);

      const listRes = await restClient.get<{
        standard_fields: Array<{ entity_type: string; field_name: string; excluded: boolean }>;
      }>('/api/v1/admin/ai/field-exclusions');
      const website = listRes.body.standard_fields.find(
        (f) => f.entity_type === 'account' && f.field_name === 'website',
      );
      expect(website?.excluded).toBe(true);
    },
  );
});
