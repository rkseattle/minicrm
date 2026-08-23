/**
 * F-AI-DL — AI Data Lifecycle
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
 *   F-AI-DL-9  — After GDPR erasure, POST /contacts/:id/ai-cascade returns 409
 *   F-AI-DL-10 — After erasure, GET /contacts/:id/ai-cascade returns log entry
 *   F-AI-DL-11 — AI settings panel shows session/message retention stats
 *   F-AI-DL-12 — Admin can manually trigger a purge and see an accepted state
 *   F-AI-DL-13 — POST /admin/ai/retention/purge returns 202 and writes an audit entry
 *   F-AI-DL-14 — GET /admin/ai/retention-stats returns session/message counts
 *   F-AI-DL-15 — GET /leads/:id/ai-cascade returns empty log before erasure
 *   F-AI-DL-16 — POST /leads/:id/ai-cascade returns 409 before GDPR erasure
 *   F-AI-DL-17 — Erasing a lead writes its own cascade log entry
 *
 * E2E limitations:
 *   - The nightly purge (retentionService) is NOT triggered here; purge logic
 *     is covered by server/src/__tests__/retentionService.test.ts.
 *   - Real AI message content redaction is NOT exercised here because the E2E
 *     server runs in stub mode; the cascade function is covered by
 *     server/src/__tests__/gdprService.test.ts.
 *
 * Framework conventions:
 *   - All tests tagged @functional @serial (mutates singleton ai_configuration row)
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
  setAiEnabled,
  getAiConfig,
  getAiSessionRetentionDaysInput,
  fillAiSessionRetentionDays,
  clickAiSessionRetentionSave,
  getAiSessionRetentionValidationError,
  getAiSessionRetentionSaveSuccess,
  getAiRetentionStats,
  clickAiPurgeNow,
  clickAiPurgeConfirm,
  getAiPurgeAccepted,
} from '@behaviors/minicrm/settings.behaviors.js';
import { createTestAdmin, createTestContact, createTestLead } from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/index.js';

test.use({ storageState: { cookies: [], origins: [] } });

// These tests share the singleton ai_configuration row — run serially to
// prevent concurrent PATCH /session-retention calls racing each other.
test.describe.configure({ mode: 'serial' });

// Serial mode orders tests within a project, not across them. The desktop and
// mobile-web projects run this file concurrently against the same singleton
// ai_configuration row, so one project's reset lands on top of the value the
// other just saved. These assertions are about the API and the shared row, not
// about the viewport, so one project running them is enough.
test.beforeEach(({ page }) => {
  const isMobile = (page.viewportSize()?.width ?? 1280) < 768;
  test.skip(isMobile, 'mutates the singleton ai_configuration row — desktop only');
});

// ---------------------------------------------------------------------------
// F-AI-DL-1 through F-AI-DL-4 — UI tests
// ---------------------------------------------------------------------------

test.describe('AI session retention UI', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await resetAiSettings(restClient);
    // resetAiSettings disables AI (ai_configuration.enabled: false), which now
    // also disables ai_features (see aiConfigService.setAiEnabled's sync) — the
    // AI Settings panel wraps its whole form in <fieldset disabled> whenever
    // ai_features is off, so this describe block's tests need it re-enabled to
    // interact with the session retention input at all.
    await setAiEnabled(restClient, true);
  });

  test.afterEach(async ({ restClient }) => {
    await resetAiSettings(restClient);
  });

  test(
    'F-AI-DL-1: AI settings panel shows the session retention section @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai', 'data-retention');

      await expect(await getAiSessionRetentionDaysInput({ page })).toBeVisible();
    },
  );

  test(
    'F-AI-DL-2: admin can update the retention window and see a success message @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai', 'data-retention');

      await expect(await getAiSessionRetentionDaysInput({ page })).toBeVisible();
      await fillAiSessionRetentionDays('180', { page });
      await clickAiSessionRetentionSave({ page });

      // Wait for the save-success indicator (i18n key: aiSettings.sessionRetention.saveSuccess)
      await expect(await getAiSessionRetentionSaveSuccess({ page })).toBeVisible({
        timeout: 8_000,
      });

      const updatedDays = (await getAiConfig(restClient)).ai_session_retention_days;
      expect(updatedDays).toBe(180);
    },
  );

  test(
    'F-AI-DL-3: entering a value below 30 shows a validation error @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai', 'data-retention');

      await expect(await getAiSessionRetentionDaysInput({ page })).toBeVisible();
      await fillAiSessionRetentionDays('10', { page });
      await clickAiSessionRetentionSave({ page });

      // Validation error fires client-side before any API call
      await expect(await getAiSessionRetentionValidationError({ page })).toBeVisible({
        timeout: 5_000,
      });

      // Confirm the API was NOT called (value unchanged)
      const days = (await getAiConfig(restClient)).ai_session_retention_days;
      expect(days).toBe(90);
    },
  );

  test(
    'F-AI-DL-4: entering a value above 3650 shows a validation error @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai', 'data-retention');

      await expect(await getAiSessionRetentionDaysInput({ page })).toBeVisible();
      await fillAiSessionRetentionDays('9999', { page });
      await clickAiSessionRetentionSave({ page });

      await expect(await getAiSessionRetentionValidationError({ page })).toBeVisible({
        timeout: 5_000,
      });

      const days = (await getAiConfig(restClient)).ai_session_retention_days;
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
    await resetAiSettings(restClient);
  });

  test(
    'F-AI-DL-5: PATCH /admin/ai/session-retention rejects retention_days < 30 with 400 @functional @serial',
    { tag: ['@functional', '@serial'] },
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
    'F-AI-DL-6: PATCH /admin/ai/session-retention accepts valid value and persists it @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ restClient }) => {
      const res = await restClient.patch('/api/v1/admin/ai/session-retention', {
        ai_session_retention_days: 365,
      });
      expect(res.status).toBe(200);

      const updated = (await getAiConfig(restClient)).ai_session_retention_days;
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
    'F-AI-DL-7: GET /contacts/:id/ai-cascade returns empty array before any erasure @functional @serial',
    { tag: ['@functional', '@serial'] },
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
    'F-AI-DL-8: POST /contacts/:id/ai-cascade returns 409 if contact has not been GDPR-erased @functional @serial',
    { tag: ['@functional', '@serial'] },
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
    'F-AI-DL-9: POST /contacts/:id/ai-cascade returns 409 when no identifiers survive @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ testData, restClient }) => {
      const contact = await createTestContact(testData, restClient, {
        first_name: 'Cascade',
        last_name: `DL9-${Date.now()}`,
      });

      await restClient.post(`/api/v1/contacts/${contact.id}/gdpr-erase`, {});

      // The automatic cascade succeeds and clears the identifiers it stored for
      // a retry, so a re-run has nothing left to search for. Refusing is the
      // point: searching the synthetic placeholder would match nothing and still
      // record a completed cascade.
      let errorStatus = 0;
      let errorCode = '';
      try {
        await restClient.post(`/api/v1/gdpr/contacts/${contact.id}/ai-cascade`, {});
      } catch (err) {
        if (err instanceof RestClientError) {
          errorStatus = err.status;
          errorCode = (err.body as { error?: { code?: string } })?.error?.code ?? '';
        } else {
          throw err;
        }
      }
      expect(errorStatus).toBe(409);
      expect(errorCode).toBe('GDPR_CASCADE_PII_UNAVAILABLE');
    },
  );

  test(
    'F-AI-DL-10: after erasure, GET /contacts/:id/ai-cascade returns a log entry @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ testData, restClient }) => {
      const contact = await createTestContact(testData, restClient, {
        first_name: 'Cascade',
        last_name: `DL10-${Date.now()}`,
      });

      await restClient.post(`/api/v1/contacts/${contact.id}/gdpr-erase`, {});

      // The erasure fires the cascade itself; no manual trigger is needed. It
      // runs asynchronously — poll until the log entry appears.
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

  test(
    'F-AI-DL-15: GET /leads/:id/ai-cascade returns empty before erasure @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ testData, restClient }) => {
      const lead = await createTestLead(testData, restClient, {
        last_name: `DL15-${Date.now()}`,
      });

      const res = await restClient.get<{ data: unknown[] }>(
        `/api/v1/gdpr/leads/${lead.id}/ai-cascade`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    },
  );

  test(
    'F-AI-DL-16: POST /leads/:id/ai-cascade returns 409 before GDPR erasure @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ testData, restClient }) => {
      const lead = await createTestLead(testData, restClient, {
        last_name: `DL16-${Date.now()}`,
      });

      let errorStatus = 0;
      try {
        await restClient.post(`/api/v1/gdpr/leads/${lead.id}/ai-cascade`, {});
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
    'F-AI-DL-17: erasing a lead writes its own cascade log entry @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ testData, restClient }) => {
      const lead = await createTestLead(testData, restClient, {
        last_name: `DL17-${Date.now()}`,
      });

      await restClient.post(`/api/v1/leads/${lead.id}/gdpr-erase`, {});

      // Erasing a lead cascades to AI data the same way a contact does; the row
      // is typed 'lead' and carries no contact_id.
      let entries: Array<{ status: string; contact_id: string | null }> = [];
      for (let attempt = 0; attempt < 10; attempt++) {
        const res = await restClient.get<{
          data: Array<{ status: string; contact_id: string | null }>;
        }>(`/api/v1/gdpr/leads/${lead.id}/ai-cascade`);
        entries = res.body.data;
        if (entries.length > 0) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }

      expect(entries.length, 'a lead erasure must write a cascade log entry').toBeGreaterThan(0);
      expect(entries[0].status).toMatch(/^(completed|failed)$/);
      expect(entries[0].contact_id).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// F-AI-DL-11 and F-AI-DL-12 — Manual purge + retention stats UI
// ---------------------------------------------------------------------------

test.describe('AI session retention stats and manual purge UI', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await resetAiSettings(restClient);
    // See the identical comment in the 'AI session retention UI' describe block
    // above — the purge button lives inside the same ai_features-gated fieldset.
    await setAiEnabled(restClient, true);
  });

  test.afterEach(async ({ restClient }) => {
    await resetAiSettings(restClient);
  });

  test(
    'F-AI-DL-11: AI settings panel shows session/message retention stats @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai', 'data-retention');

      await expect(await getAiRetentionStats({ page })).toBeVisible({ timeout: 8_000 });
    },
  );

  test(
    'F-AI-DL-12: admin can manually trigger a purge and see an accepted state @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });

      await navigateToAdminSettings({ page }, 'ai', 'data-retention');

      await expect(await getAiRetentionStats({ page })).toBeVisible({ timeout: 8_000 });
      await clickAiPurgeNow({ page });
      await clickAiPurgeConfirm({ page });

      await expect(await getAiPurgeAccepted({ page })).toBeVisible({ timeout: 8_000 });
    },
  );
});

// ---------------------------------------------------------------------------
// F-AI-DL-13 and F-AI-DL-14 — Manual purge + retention stats API
// ---------------------------------------------------------------------------

test.describe('AI session retention stats and manual purge API', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
  });

  test(
    'F-AI-DL-13: POST /admin/ai/retention/purge returns 202 accepted immediately @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ restClient }) => {
      // The manual-trigger audit entry has no record_id (it's a global settings action),
      // so it is not queryable via the record-scoped /audit-log/record REST endpoint —
      // covered instead by server/src/__tests__/aiRetentionController.test.ts.
      const res = await restClient.post<{ accepted: boolean; message: string }>(
        '/api/v1/admin/ai/retention/purge',
        {},
      );
      expect(res.status).toBe(202);
      expect(res.body.accepted).toBe(true);
    },
  );

  test(
    'F-AI-DL-14: GET /admin/ai/retention-stats returns session/message counts @functional @serial',
    { tag: ['@functional', '@serial'] },
    async ({ restClient }) => {
      const res = await restClient.get<{ session_count: number; message_count: number }>(
        '/api/v1/admin/ai/retention-stats',
      );
      expect(res.status).toBe(200);
      expect(typeof res.body.session_count).toBe('number');
      expect(typeof res.body.message_count).toBe('number');
    },
  );
});
