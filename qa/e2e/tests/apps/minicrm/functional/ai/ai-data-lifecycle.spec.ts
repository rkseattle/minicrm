/**
 * F-AI-DL — AI Data Lifecycle (MINCRM-446, MINCRM-447)
 *
 * Covers the AI session retention policy and GDPR right-to-erasure cascade.
 *
 * Test groups:
 *   F-AI-DL-1  — AI settings panel shows the session retention section
 *   F-AI-DL-2  — Admin can update the retention window and see a success state
 *   F-AI-DL-3  — Entering a value below 30 shows a validation error
 *   F-AI-DL-4  — Entering a value above 3650 shows a validation error
 *   F-AI-DL-5  — PATCH /admin/ai/session-retention API rejects value < 30
 *   F-AI-DL-6  — PATCH /admin/ai/session-retention API accepts value in range
 *   F-AI-DL-7  — GET /contacts/:id/ai-cascade returns empty log before erasure
 *   F-AI-DL-8  — POST /contacts/:id/ai-cascade returns 409 before GDPR erasure
 *   F-AI-DL-9  — After GDPR erasure, POST /contacts/:id/ai-cascade returns 202
 *   F-AI-DL-10 — After manual cascade, GET /contacts/:id/ai-cascade returns log entry
 *
 * E2E limitations:
 *   - The nightly purge (retentionService) is NOT triggered here; purge logic
 *     is covered by server/src/__tests__/retentionService.test.ts.
 *   - Real AI message content redaction is NOT exercised here because the E2E
 *     server runs in stub mode; the cascade function is covered by
 *     server/src/__tests__/gdprService.test.ts.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behavior functions imported from @behaviors/* only — never @pages/*
 *   - Feature flag interception via withFlags() only
 *   - test.describe.configure({ mode: 'serial' }) — tests share the admin account
 *     and the singleton ai_configuration row; parallel runs would race each other.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToAdminSettings,
  resetAiSettings,
  getAiSessionRetentionDaysInput,
  fillAiSessionRetentionDays,
  clickAiSessionRetentionSave,
  getAiSessionRetentionValidationError,
  getAiSessionRetentionSaveSuccess,
} from '@behaviors/minicrm/settings.behaviors.js';
import { createTestAdmin, createTestContact } from '@apps/minicrm/helpers.js';
import type { RestClient } from '@framework/clients/index.js';
import { RestClientError } from '@framework/clients/index.js';

test.use({ storageState: { cookies: [], origins: [] } });

// These tests share the singleton ai_configuration row — run serially to
// prevent concurrent PATCH /session-retention calls racing each other.
test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getRetentionDays(restClient: RestClient): Promise<number> {
  const res = await restClient.get<{ ai_session_retention_days: number }>(
    '/api/v1/admin/ai/config',
  );
  return res.body.ai_session_retention_days;
}

async function resetRetentionDays(restClient: RestClient): Promise<void> {
  await restClient
    .patch('/api/v1/admin/ai/session-retention', { ai_session_retention_days: 90 })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// F-AI-DL-1 through F-AI-DL-4 — UI tests
// ---------------------------------------------------------------------------

test.describe('AI session retention UI', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await resetRetentionDays(restClient);
  });

  test.afterEach(async ({ restClient }) => {
    await resetRetentionDays(restClient);
    await resetAiSettings(restClient);
  });

  test(
    'F-AI-DL-1: AI settings panel shows the session retention section @functional',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai');

      await expect(await getAiSessionRetentionDaysInput({ page })).toBeVisible();
    },
  );

  test(
    'F-AI-DL-2: admin can update the retention window and see a success message @functional',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai');

      await expect(await getAiSessionRetentionDaysInput({ page })).toBeVisible();
      await fillAiSessionRetentionDays('180', { page });
      await clickAiSessionRetentionSave({ page });

      // Wait for the save-success indicator (i18n key: aiSettings.sessionRetention.saveSuccess)
      await expect(await getAiSessionRetentionSaveSuccess({ page })).toBeVisible({
        timeout: 8_000,
      });

      const updatedDays = await getRetentionDays(restClient);
      expect(updatedDays).toBe(180);
    },
  );

  test(
    'F-AI-DL-3: entering a value below 30 shows a validation error @functional',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai');

      await expect(await getAiSessionRetentionDaysInput({ page })).toBeVisible();
      await fillAiSessionRetentionDays('10', { page });
      await clickAiSessionRetentionSave({ page });

      // Validation error fires client-side before any API call
      await expect(await getAiSessionRetentionValidationError({ page })).toBeVisible({
        timeout: 5_000,
      });

      // Confirm the API was NOT called (value unchanged)
      const days = await getRetentionDays(restClient);
      expect(days).toBe(90);
    },
  );

  test(
    'F-AI-DL-4: entering a value above 3650 shows a validation error @functional',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai');

      await expect(await getAiSessionRetentionDaysInput({ page })).toBeVisible();
      await fillAiSessionRetentionDays('9999', { page });
      await clickAiSessionRetentionSave({ page });

      await expect(await getAiSessionRetentionValidationError({ page })).toBeVisible({
        timeout: 5_000,
      });

      const days = await getRetentionDays(restClient);
      expect(days).toBe(90);
    },
  );
});

// ---------------------------------------------------------------------------
// F-AI-DL-5 and F-AI-DL-6 — API validation tests
// ---------------------------------------------------------------------------

test.describe('AI session retention API', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
  });

  test.afterEach(async ({ restClient }) => {
    await resetRetentionDays(restClient);
  });

  test(
    'F-AI-DL-5: PATCH /admin/ai/session-retention rejects retention_days < 30 with 400 @functional',
    { tag: ['@functional'] },
    async ({ restClient }) => {
      let errorStatus = 0;
      try {
        await restClient.patch('/api/v1/admin/ai/session-retention', {
          ai_session_retention_days: 5,
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
    'F-AI-DL-6: PATCH /admin/ai/session-retention accepts valid value and persists it @functional',
    { tag: ['@functional'] },
    async ({ restClient }) => {
      const res = await restClient.patch('/api/v1/admin/ai/session-retention', {
        ai_session_retention_days: 365,
      });
      expect(res.status).toBe(200);

      const updated = await getRetentionDays(restClient);
      expect(updated).toBe(365);
    },
  );
});

// ---------------------------------------------------------------------------
// F-AI-DL-7 through F-AI-DL-10 — GDPR AI cascade API tests
// ---------------------------------------------------------------------------

test.describe('GDPR AI cascade', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
  });

  test(
    'F-AI-DL-7: GET /contacts/:id/ai-cascade returns empty array before any erasure @functional',
    { tag: ['@functional'] },
    async ({ testData, restClient }) => {
      const contact = await createTestContact(testData, restClient, {
        first_name: 'Cascade',
        last_name: `DL7-${Date.now()}`,
      });

      const res = await restClient.get<{ data: unknown[] }>(
        `/api/v1/gdpr/contacts/${contact.id}/ai-cascade`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    },
  );

  test(
    'F-AI-DL-8: POST /contacts/:id/ai-cascade returns 409 if contact has not been GDPR-erased @functional',
    { tag: ['@functional'] },
    async ({ testData, restClient }) => {
      const contact = await createTestContact(testData, restClient, {
        first_name: 'Cascade',
        last_name: `DL8-${Date.now()}`,
      });

      let errorStatus = 0;
      try {
        await restClient.post(`/api/v1/gdpr/contacts/${contact.id}/ai-cascade`, {});
      } catch (err) {
        if (err instanceof RestClientError) {
          errorStatus = err.status;
        } else {
          throw err;
        }
      }
      expect(errorStatus).toBe(409);
    },
  );

  test(
    'F-AI-DL-9: POST /contacts/:id/ai-cascade returns 202 after GDPR erasure @functional',
    { tag: ['@functional'] },
    async ({ testData, restClient }) => {
      const contact = await createTestContact(testData, restClient, {
        first_name: 'Cascade',
        last_name: `DL9-${Date.now()}`,
      });

      await restClient.post(`/api/v1/contacts/${contact.id}/gdpr-erase`, {});

      const res = await restClient.post<{ message: string }>(
        `/api/v1/gdpr/contacts/${contact.id}/ai-cascade`,
        {},
      );
      expect(res.status).toBe(202);
    },
  );

  test(
    'F-AI-DL-10: after manual cascade trigger, GET /contacts/:id/ai-cascade returns a log entry @functional',
    { tag: ['@functional'] },
    async ({ testData, restClient }) => {
      const contact = await createTestContact(testData, restClient, {
        first_name: 'Cascade',
        last_name: `DL10-${Date.now()}`,
      });

      await restClient.post(`/api/v1/contacts/${contact.id}/gdpr-erase`, {});
      await restClient.post(`/api/v1/gdpr/contacts/${contact.id}/ai-cascade`, {});

      // The cascade function runs asynchronously — poll until the log entry appears.
      let entries: Array<{ status: string; contact_id: string }> = [];
      for (let attempt = 0; attempt < 10; attempt++) {
        const res = await restClient.get<{
          data: Array<{ status: string; contact_id: string }>;
        }>(`/api/v1/gdpr/contacts/${contact.id}/ai-cascade`);
        entries = res.body.data;
        if (entries.length > 0) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }

      expect(entries.length, 'at least one cascade log entry must appear').toBeGreaterThan(0);
      expect(entries[0].status).toMatch(/^(completed|failed)$/);
      expect(entries[0].contact_id).toBe(contact.id);
    },
  );
});
