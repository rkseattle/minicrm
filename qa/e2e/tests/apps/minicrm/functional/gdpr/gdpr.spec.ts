/**
 * GDPR functional tests (MINCRM-409).
 *
 * Covers three distinct aspects of the GDPR Art. 17 implementation:
 *
 *   GDPR-1: Admin triggers erasure through the UI on a contact detail page.
 *           After confirmation, the contact name and email fields show
 *           "[GDPR deleted]" and the audit log contains a gdpr_erasure entry.
 *
 *   GDPR-2: Admin retrieves a subject-access export via API. The response
 *           JSON includes the required top-level keys (contact, activities,
 *           deals, notes, audit_history).
 *
 *   GDPR-3: After erasure, the per-record audit log read-time masking applies:
 *           old_value and new_value on pre-erasure update entries are replaced
 *           with "[GDPR deleted]".
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No @pages/* imports
 *   - All test data managed via helpers / TestDataManager
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { createTestContact, createTestAdmin } from '@apps/minicrm/helpers.js';

test.use({ storageState: { cookies: [], origins: [] } });
import {
  navigateToContactDetail,
  getContactById,
  performGdprErasure,
  expectContactNameContainsText,
  getContactEmailFieldText,
} from '@behaviors/minicrm/contacts.behaviors.js';
import { getRecordAuditLog } from '@behaviors/minicrm/notes.behaviors.js';

// The word the UI requires the user to type to confirm erasure
const CONFIRM_WORD = 'ERASE';

// ---------------------------------------------------------------------------
// GDPR-1 — UI erasure flow
// ---------------------------------------------------------------------------

test(
  'GDPR-1: admin erases a contact via UI; name and email show [GDPR deleted], audit log has gdpr_erasure entry @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await loginAsAdmin(restClient);
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });

    // The GDPR erasure modal contains substantial content (PII field list, warning
    // sections, two inputs) that exceeds the default 720px viewport height. Expand
    // the viewport so Playwright can click the confirm button without it being clipped.
    await page.setViewportSize({ width: 1280, height: 900 });

    const contact = await createTestContact(testData, restClient, {
      first_name: 'Erasure',
      last_name: `UI-${Date.now()}`,
    });

    await navigateToContactDetail(contact.id, { page });

    await performGdprErasure(CONFIRM_WORD, { page });

    await expectContactNameContainsText('[GDPR deleted]', { page });

    const emailText = await getContactEmailFieldText({ page });
    expect(emailText, 'erased email must use the gdpr.invalid sentinel domain').toMatch(
      /gdpr-deleted-.+@gdpr\.invalid/,
    );

    // The audit log for this contact must contain a gdpr_erasure entry
    const { entries } = await getRecordAuditLog(restClient, 'contact', contact.id, true);
    const erasureEntry = entries.find((e) => e.event_type === 'gdpr_erasure');
    expect(erasureEntry, 'audit log must contain a gdpr_erasure entry').toBeDefined();
  },
);

// ---------------------------------------------------------------------------
// GDPR-2 — API subject-access export
// ---------------------------------------------------------------------------

test(
  'GDPR-2: GET /api/v1/contacts/:id/gdpr-export returns required JSON keys @functional',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await loginAsAdmin(restClient);

    const contact = await createTestContact(testData, restClient, {
      first_name: 'Export',
      last_name: `API-${Date.now()}`,
    });

    // The export endpoint sends a JSON attachment; restClient.get returns the parsed body.
    const res = await restClient.get<{
      contact: unknown;
      activities: unknown;
      deals: unknown;
      notes: unknown;
      audit_history: unknown;
    }>(`/api/v1/contacts/${contact.id}/gdpr-export`);

    const data = res.body;
    expect(data, 'export must include contact key').toHaveProperty('contact');
    expect(data, 'export must include activities key').toHaveProperty('activities');
    expect(data, 'export must include deals key').toHaveProperty('deals');
    expect(data, 'export must include notes key').toHaveProperty('notes');
    expect(data, 'export must include audit_history key').toHaveProperty('audit_history');
  },
);

// ---------------------------------------------------------------------------
// GDPR-3 — Read-time audit log masking after erasure
// ---------------------------------------------------------------------------

test(
  'GDPR-3: after erasure, audit log old_value and new_value are masked as [GDPR deleted] @functional',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await loginAsAdmin(restClient);

    const contact = await createTestContact(testData, restClient, {
      first_name: 'Mask',
      last_name: `Audit-${Date.now()}`,
    });

    // Fetch the freshly created contact to get its version for the PATCH
    const fetched = await getContactById(restClient, contact.id);

    // Update the contact to generate an update audit entry with old_value/new_value
    await restClient.patch(`/api/v1/contacts/${contact.id}`, {
      first_name: 'MaskUpdated',
      version: fetched.version,
    });

    // Now erase the contact via API
    await restClient.post(`/api/v1/contacts/${contact.id}/gdpr-erase`, {});

    // Read the per-record audit log — update entries should have masked values
    const res = await restClient.get<{
      entries: Array<{
        event_type: string;
        old_value: string | null;
        new_value: string | null;
      }>;
    }>(`/api/v1/audit-log/record?record_type=contact&record_id=${contact.id}&all=true`);

    const updateEntries = res.body.entries.filter((e) => e.event_type === 'updated');
    expect(updateEntries.length, 'there must be at least one update entry').toBeGreaterThan(0);

    // Every update entry that had a non-null value before erasure is now masked
    for (const entry of updateEntries) {
      if (entry.old_value !== null) {
        expect(entry.old_value).toBe('[GDPR deleted]');
      }
      if (entry.new_value !== null) {
        expect(entry.new_value).toBe('[GDPR deleted]');
      }
    }
  },
);
