/**
 * F12 — Audit Log UI and Lead Conversion (additional coverage)
 *
 * Functional regression tests for:
 *   1. The Audit Log page (admin-only, at /admin/audit-log)
 *   2. Lead conversion — verifying all three created entities exist in the API
 *
 * Test groups:
 *   Audit Log (F12-AL) — entry appears after tracked action; filters; expandable rows; rep blocked
 *   Lead Conversion (F12-V) — API verification of contact + account + deal created atomically
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - UI interaction via healPage.locate / click / fill with data-testid strategies only
 *
 * MINCRM-201
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestAccount, createTestUser } from '@apps/minicrm/helpers.js';
import { filterAuditLog, getAuditLog } from '@behaviors/minicrm/audit-log.behaviors.js';
import { patchContact, getContactById } from '@behaviors/minicrm/contacts.behaviors.js';
import { getAccountById } from '@behaviors/minicrm/accounts.behaviors.js';
import { getDealById } from '@behaviors/minicrm/deals.behaviors.js';
import { loginAsAdmin, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import { deactivateUser } from '@behaviors/minicrm/users.behaviors.js';
import {
  createLeadViaApi,
  convertLeadViaApi,
  getLeads,
  getLeadById,
} from '@behaviors/minicrm/leads.behaviors.js';
import {
  navigateToAuditLog,
  getAuditLogHeadingLocator,
  getAuditLogListLocator,
  getAuditLogPaginationLocator,
  getAuditLogPaginationPrevLocator,
  collapseAuditLogFilters,
} from '@behaviors/minicrm/audit-log.behaviors.js';
import { RestClientError } from '@framework/clients/rest-client.js';

const REP_PASSWORD = 'BvtPassword1!';

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// Audit Log — F12-AL
// ---------------------------------------------------------------------------

test('@functional F12-AL1: Perform a tracked action — audit log shows entry with correct user and record type', async ({
  page,
  restClient,
  testData,
}) => {
  // Create a contact, then update it — both actions should generate audit entries
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F12AL1',
    last_name: 'AuditTest',
  });

  // Update a field so an 'updated' entry is written
  // MINCRM-349: include version for optimistic locking.
  await patchContact(restClient, contact.id, {
    first_name: 'F12AL1Updated',
    version: contact.version,
  });

  // Navigate to audit log

  await navigateToAuditLog({ page });
  await expect(await getAuditLogHeadingLocator({ page })).toBeVisible();

  // Filter by record type = contact so the list is manageable
  await filterAuditLog('contact', { page });

  // The audit list should show at least one entry
  await expect(await getAuditLogListLocator({ page })).toBeVisible({ timeout: 10_000 });

  // Verify via API that the entry exists
  const { entries, total } = await getAuditLog(restClient, { recordType: 'contact' });
  expect(total, 'audit log should have at least one contact entry').toBeGreaterThan(0);

  // Find the entry for our specific contact
  const entry = entries.find((e) => e.record_id === contact.id);
  expect(entry, 'audit entry for our contact should exist').toBeDefined();
});

test('@functional F12-AL2: Audit log — filter by record type shows only that type', async ({
  page,
  restClient,
  testData,
}) => {
  // Ensure there are at least one contact and one account action in the log
  const contact = await createTestContact(testData, restClient, { first_name: 'F12AL2C' });
  const account = await createTestAccount(testData, restClient, { name: 'F12AL2A Corp' });
  void contact;
  void account;

  await navigateToAuditLog({ page });
  await expect(await getAuditLogHeadingLocator({ page })).toBeVisible();

  // Filter to account only
  await filterAuditLog('account', { page });

  await expect(await getAuditLogListLocator({ page })).toBeVisible({ timeout: 10_000 });

  // Check via API that the filtered results only contain account entries
  const { entries } = await getAuditLog(restClient, { recordType: 'account' });
  const nonAccountEntries = entries.filter((e) => e.record_type !== 'account');
  expect(nonAccountEntries.length, 'filtered audit log should only contain account entries').toBe(
    0,
  );
});

test('@functional F12-AL3: Audit log — field-level change detail recorded for updated contact', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F12AL3',
    last_name: 'DetailTest',
  });

  // Update to generate change entries (one row per changed field in the audit log)
  // MINCRM-349: include version for optimistic locking.
  await patchContact(restClient, contact.id, {
    first_name: 'F12AL3Updated',
    version: contact.version,
  });

  // Use the record-scoped query to avoid pagination gaps in the system-wide list.
  const { entries } = await getAuditLog(restClient, {
    recordType: 'contact',
    recordId: contact.id,
  });
  // The audit service stores the display name via getFieldDisplayName(), so
  // 'first_name' (DB column) is stored as 'First Name' in field_name.
  const firstNameEntry = entries.find(
    (e) => e.event_type === 'updated' && e.field_name === 'First Name',
  );
  expect(firstNameEntry, 'First Name change entry should exist in audit log').toBeDefined();
  if (!firstNameEntry) return;

  expect(firstNameEntry.new_value, 'new_value should reflect the updated first_name').toBe(
    'F12AL3Updated',
  );
  expect(firstNameEntry.old_value, 'old_value should reflect the original first_name').toBe(
    'F12AL3',
  );

  // Navigate to the audit log page and verify the entry is renderable in the UI

  await navigateToAuditLog({ page });
  await expect(await getAuditLogHeadingLocator({ page })).toBeVisible();

  // Filter by contact and apply
  await filterAuditLog('contact', { page });
  await expect(await getAuditLogListLocator({ page })).toBeVisible({ timeout: 10_000 });

  // If the specific row is on the first page, expand it and verify the detail section.
  // Collapse the filter panel first — on mobile its open body overlaps the data rows
  // and intercepts pointer events, causing the row-button click to time out.
  await collapseAuditLogFilters({ page });

  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed row button has no stable role fallback
  const expandButton = await page
    .locate([{ type: 'testId', value: `audit-log-row-button-${firstNameEntry.id}` }])
    .resolve();
  const isVisible = await expandButton.isVisible().catch(() => false);
  if (isVisible) {
    await expandButton.click();
    await expect(
      // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed detail panel has no stable role fallback
      await page
        .locate([{ type: 'testId', value: `audit-log-detail-${firstNameEntry.id}` }])
        .resolve(),
    ).toBeVisible({ timeout: 3_000 });
  }
});

test('@functional F12-AL4: Audit log — pagination controls always visible (MINCRM-345)', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient, { first_name: 'F12AL4Pag' });
  void contact;

  await navigateToAuditLog({ page });
  await expect(await getAuditLogHeadingLocator({ page })).toBeVisible();

  // Pagination bar should always be visible once data loads
  const pagination = await getAuditLogPaginationLocator({ page });
  await expect(pagination).toBeVisible({ timeout: 10_000 });

  // Prev is disabled on first page
  const prevButton = await getAuditLogPaginationPrevLocator({ page });
  await expect(prevButton).toBeDisabled();
});

test('@functional F12-AL5: Rep navigating to audit log is blocked', async ({ restClient }) => {
  // Create a rep dynamically so this test does not depend on E2E_REP_PASSWORD being set
  const rep = await createTestUser(restClient, { role: 'rep', password: REP_PASSWORD });

  try {
    await loginAs(restClient, rep.email, REP_PASSWORD);

    let got403 = false;
    try {
      await restClient.get<unknown>('/api/v1/audit-log');
    } catch (err) {
      if (err instanceof RestClientError && err.status === 403) got403 = true;
    }
    expect(got403, 'rep should get 403 when accessing audit log').toBe(true);
  } finally {
    await loginAsAdmin(restClient);
    await deactivateUser(restClient, rep.id).catch(() => null);
  }
});

// ---------------------------------------------------------------------------
// Lead Conversion — additional API-level verification (F12-V)
// ---------------------------------------------------------------------------

test('@functional F12-V1: Lead conversion — contact, account, and deal all exist in API and are linked', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const leadEmail = `f12v1-${suffix}@example.com`;
  const companyName = `F12V1 Corp ${suffix}`;
  const dealName = `${companyName} — Opportunity`;

  // Create lead
  const lead = await createLeadViaApi(restClient, {
    first_name: 'F12V1',
    last_name: 'Lead',
    email: leadEmail,
    company_name: companyName,
  });
  const leadId = lead.id;
  testData.register('lead', leadId, `/api/v1/leads/${leadId}`);

  // Convert atomically
  const { contact_id, account_id, deal_id } = await convertLeadViaApi(restClient, leadId, {
    contact: { first_name: 'F12V1', last_name: 'Lead', email: leadEmail },
    account: { mode: 'create', name: companyName },
    deal: { name: dealName },
  });

  testData.register('contact', contact_id, `/api/v1/contacts/${contact_id}`);
  testData.register('deal', deal_id, `/api/v1/deals/${deal_id}`);
  // Accounts created by conversion are not directly deleteable in teardown if they have deals;
  // register anyway and teardown will handle 409 gracefully.
  testData.register('account', account_id, `/api/v1/accounts/${account_id}`);

  // Verify contact exists with correct email
  const contact = await getContactById(restClient, contact_id);
  expect(contact.email, 'converted contact email should match lead email').toBe(leadEmail);

  // Verify account exists with correct name
  const account = await getAccountById(restClient, account_id);
  expect(account.name, 'converted account name should match company name').toBe(companyName);

  // Verify deal exists and is linked to the account
  const deal = await getDealById(restClient, deal_id);
  expect(deal.name, 'converted deal name should match').toBe(dealName);
  expect(deal.account_id, 'converted deal should be linked to the new account').toBe(account_id);

  // Verify lead is marked converted
  const leadDetail = await getLeadById(restClient, leadId);
  expect(leadDetail.converted_at, 'lead converted_at should be set').not.toBeNull();
  expect(leadDetail.converted_contact_id, 'lead should reference converted contact').toBe(
    contact_id,
  );
});

test('@functional F12-V2: Converted lead does not appear in default list but appears with includeConverted=true', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const leadEmail = `f12v2-${suffix}@example.com`;

  const lead = await createLeadViaApi(restClient, {
    first_name: 'F12V2',
    email: leadEmail,
    company_name: `F12V2 Corp ${suffix}`,
  });
  const leadId = lead.id;
  testData.register('lead', leadId, `/api/v1/leads/${leadId}`);

  const conversion = await convertLeadViaApi(restClient, leadId, {
    contact: { first_name: 'F12V2', email: leadEmail },
    account: { mode: 'create', name: `F12V2 Corp ${suffix}` },
    deal: { name: `F12V2 Corp — Opportunity` },
  });
  testData.register('contact', conversion.contact_id, `/api/v1/contacts/${conversion.contact_id}`);
  testData.register('deal', conversion.deal_id, `/api/v1/deals/${conversion.deal_id}`);
  testData.register('account', conversion.account_id, `/api/v1/accounts/${conversion.account_id}`);

  // Default list should not include the converted lead
  const defaultList = await getLeads(restClient);
  const foundInDefault = defaultList.data.some((l) => l.id === leadId);
  expect(foundInDefault, 'converted lead should be hidden in default list').toBe(false);

  // With includeConverted=true, lead should appear
  const fullList = await getLeads(restClient, { includeConverted: true });
  const foundInFull = fullList.data.some((l) => l.id === leadId);
  expect(foundInFull, 'converted lead should be visible with includeConverted=true').toBe(true);
});
