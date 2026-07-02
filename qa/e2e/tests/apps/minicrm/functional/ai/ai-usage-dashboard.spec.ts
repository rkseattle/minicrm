/**
 * F-AI-UD — AI Usage & Cost Dashboard (MINCRM-459)
 *
 * Covers the admin usage/cost dashboard page and the cost-rate admin setting.
 *
 * Test groups:
 *   F-AI-UD-1 — Dashboard page renders summary and per-user table (read-only)
 *   F-AI-UD-2 — Admin can switch date range presets (read-only)
 *   F-AI-UD-3 — GET /admin/ai/usage/summary returns the expected shape
 *   F-AI-UD-4 — GET /admin/ai/usage/daily returns the expected shape
 *   F-AI-UD-5 — GET /admin/ai/usage/export returns a CSV with correct headers
 *   F-AI-UD-6 — PATCH /admin/ai/cost-rates persists both rates (mutates shared state)
 *
 * E2E limitations:
 *   - No real AI usage is generated in this environment (Anthropic calls are
 *     stubbed), so the dashboard is exercised against zero/empty usage data —
 *     aggregation correctness with real rows is covered by
 *     server/src/__tests__/aiUsageDashboardService.test.ts.
 *
 * Framework conventions:
 *   - Read-only viewing tests (F-AI-UD-1, F-AI-UD-2, F-AI-UD-3, F-AI-UD-4, F-AI-UD-5)
 *     are untagged @serial — they do not mutate shared state.
 *   - F-AI-UD-6 mutates the shared ai_configuration singleton row — tagged @serial.
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behavior functions imported from @behaviors/* only — never @pages/*
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToAiUsageDashboard,
  getAiUsageTotalTokensCard,
  getAiUsagePerUserTable,
  selectAiUsageRangePreset,
} from '@behaviors/minicrm/ai-usage-dashboard.behaviors.js';
import { resetAiCostRates } from '@behaviors/minicrm/settings.behaviors.js';
import { createTestAdmin } from '@apps/minicrm/helpers.js';

const BASE_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3001';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// F-AI-UD-1 and F-AI-UD-2 — UI tests (read-only)
// ---------------------------------------------------------------------------

test.describe('AI usage dashboard UI', () => {
  test(
    'F-AI-UD-1: dashboard renders summary card and per-user table @functional',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      await loginAsAdmin(restClient);
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAiUsageDashboard({ page });

      await expect(await getAiUsageTotalTokensCard({ page })).toBeVisible({ timeout: 8_000 });
      await expect(await getAiUsagePerUserTable({ page })).toBeVisible({ timeout: 8_000 });
    },
  );

  test(
    'F-AI-UD-2: admin can switch date range presets @functional',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      await loginAsAdmin(restClient);
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAiUsageDashboard({ page });
      await expect(await getAiUsageTotalTokensCard({ page })).toBeVisible({ timeout: 8_000 });

      await selectAiUsageRangePreset('last_month', { page });
      await selectAiUsageRangePreset('last_3_months', { page });

      // Still renders after switching presets — no crash, summary card remains visible.
      await expect(await getAiUsageTotalTokensCard({ page })).toBeVisible({ timeout: 8_000 });
    },
  );
});

// ---------------------------------------------------------------------------
// F-AI-UD-3 through F-AI-UD-5 — API tests (read-only)
// ---------------------------------------------------------------------------

test.describe('AI usage dashboard API', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
  });

  test(
    'F-AI-UD-3: GET /admin/ai/usage/summary returns the expected shape @functional',
    { tag: ['@functional'] },
    async ({ restClient }) => {
      const res = await restClient.get<{
        input_tokens: number;
        output_tokens: number;
        estimated_cost_cents: number;
        per_user: unknown[];
        per_feature: unknown[];
      }>('/api/v1/admin/ai/usage/summary?preset=current_month');
      expect(res.status).toBe(200);
      expect(typeof res.body.input_tokens).toBe('number');
      expect(typeof res.body.output_tokens).toBe('number');
      expect(Array.isArray(res.body.per_user)).toBe(true);
      expect(Array.isArray(res.body.per_feature)).toBe(true);
    },
  );

  test(
    'F-AI-UD-4: GET /admin/ai/usage/daily returns the expected shape @functional',
    { tag: ['@functional'] },
    async ({ restClient }) => {
      const res = await restClient.get<{ points: unknown[] }>(
        '/api/v1/admin/ai/usage/daily?preset=current_month',
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.points)).toBe(true);
    },
  );

  test(
    'F-AI-UD-5: GET /admin/ai/usage/export returns a CSV with correct Content-Type @functional',
    { tag: ['@functional'] },
    async ({ request }) => {
      const response = await request.get(
        `${BASE_URL}/api/v1/admin/ai/usage/export?preset=current_month`,
      );
      expect(response.status(), 'export should return 200').toBe(200);

      const contentType = response.headers()['content-type'] ?? '';
      expect(contentType, 'Content-Type should be text/csv').toContain('text/csv');

      const disposition = response.headers()['content-disposition'] ?? '';
      expect(disposition, 'Content-Disposition should contain minicrm-ai-usage-').toContain(
        'minicrm-ai-usage-',
      );
    },
  );
});

// ---------------------------------------------------------------------------
// F-AI-UD-6 — Cost rate config API test (mutates shared state)
// ---------------------------------------------------------------------------

test.describe('AI cost rate configuration', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
  });

  test.afterEach(async ({ restClient }) => {
    await resetAiCostRates(restClient);
  });

  test(
    'F-AI-UD-6: PATCH /admin/ai/cost-rates persists both rates @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ restClient }) => {
      const res = await restClient.patch<{
        ai_input_cost_per_million_cents: number;
        ai_output_cost_per_million_cents: number;
      }>('/api/v1/admin/ai/cost-rates', {
        ai_input_cost_per_million_cents: 250,
        ai_output_cost_per_million_cents: 1250,
      });
      expect(res.status).toBe(200);
      expect(res.body.ai_input_cost_per_million_cents).toBe(250);
      expect(res.body.ai_output_cost_per_million_cents).toBe(1250);
    },
  );
});
