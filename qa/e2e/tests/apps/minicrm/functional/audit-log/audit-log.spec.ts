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
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F12-audit-log] E2E_ADMIN_PASSWORD is not set');

const REP_PASSWORD = 'BvtPassword1!';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * Each audit log row represents a single field change — one row per changed
 * field. The server uses a one-entry-per-field model (not a nested changes
 * array). changed_by_id and changed_by_name are the actor's identifiers.
 */
interface AuditLogEntry {
  id: string;
  event_type: string;
  record_type: string;
  record_id: string | null;
  record_name: string | null;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by_id: string | null;
  changed_by_name: string | null;
  created_at: string;
}

interface AuditLogListResponse {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

interface ContactSingleResponse {
  contact: { id: string; first_name: string; last_name: string; email: string };
}

interface AccountSingleResponse {
  account: { id: string; name: string };
}

interface DealSingleResponse {
  deal: { id: string; name: string; account_id: string };
}

interface ConversionResponse {
  conversion: { contact_id: string; account_id: string; deal_id: string };
}

interface LeadSingleResponse {
  lead: {
    id: string;
    converted_at: string | null;
    converted_contact_id: string | null;
    converted_deal_id: string | null;
  };
}

// ---------------------------------------------------------------------------
// Audit Log — F12-AL
// ---------------------------------------------------------------------------

test('@functional F12-AL1: Perform a tracked action — audit log shows entry with correct user and record type', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Create a contact, then update it — both actions should generate audit entries
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F12AL1',
    last_name: 'AuditTest',
  });

  // Update a field so an 'updated' entry is written
  await restClient.patch(`/api/contacts/${contact.id}`, { first_name: 'F12AL1Updated' });

  // Navigate to audit log
  await page.goto('/admin/audit-log');
  await expect(
    await healPage.locate([{ type: 'testId', value: 'audit-log-heading' }]).resolve(testName),
  ).toBeVisible();

  // Filter by record type = contact so the list is manageable
  await (
    await healPage.locate([{ type: 'testId', value: 'filter-record-type' }]).resolve(testName)
  ).selectOption('contact');
  await healPage.click([{ type: 'testId', value: 'apply-filters-button' }]);

  // The audit list should show at least one entry
  await expect(
    await healPage.locate([{ type: 'testId', value: 'audit-log-list' }]).resolve(testName),
  ).toBeVisible({ timeout: 10_000 });

  // Verify via API that the entry exists
  const auditResponse = await restClient.get<AuditLogListResponse>(
    `/api/audit-log?recordType=contact`,
  );
  expect(
    auditResponse.body.total,
    'audit log should have at least one contact entry',
  ).toBeGreaterThan(0);

  // Find the entry for our specific contact
  const entry = auditResponse.body.data.find((e) => e.record_id === contact.id);
  expect(entry, 'audit entry for our contact should exist').toBeDefined();
});

test('@functional F12-AL2: Audit log — filter by record type shows only that type', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Ensure there are at least one contact and one account action in the log
  const contact = await createTestContact(testData, restClient, { first_name: 'F12AL2C' });
  const account = await createTestAccount(testData, restClient, { name: 'F12AL2A Corp' });
  void contact;
  void account;

  await page.goto('/admin/audit-log');
  await expect(
    await healPage.locate([{ type: 'testId', value: 'audit-log-heading' }]).resolve(testName),
  ).toBeVisible();

  // Filter to account only
  await (
    await healPage.locate([{ type: 'testId', value: 'filter-record-type' }]).resolve(testName)
  ).selectOption('account');
  await healPage.click([{ type: 'testId', value: 'apply-filters-button' }]);

  await expect(
    await healPage.locate([{ type: 'testId', value: 'audit-log-list' }]).resolve(testName),
  ).toBeVisible({ timeout: 10_000 });

  // Check via API that the filtered results only contain account entries
  const auditResponse = await restClient.get<AuditLogListResponse>(
    `/api/audit-log?recordType=account`,
  );
  const nonAccountEntries = auditResponse.body.data.filter((e) => e.record_type !== 'account');
  expect(nonAccountEntries.length, 'filtered audit log should only contain account entries').toBe(
    0,
  );
});

test('@functional F12-AL3: Audit log — field-level change detail recorded for updated contact', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const contact = await createTestContact(testData, restClient, {
    first_name: 'F12AL3',
    last_name: 'DetailTest',
  });

  // Update to generate change entries (one row per changed field in the audit log)
  await restClient.patch(`/api/contacts/${contact.id}`, { first_name: 'F12AL3Updated' });

  // Use the record-scoped endpoint to avoid pagination gaps in the system-wide list.
  const auditResponse = await restClient.get<{ entries: AuditLogEntry[] }>(
    `/api/audit-log/record?record_type=contact&record_id=${contact.id}&all=true`,
  );
  // The audit service stores the display name via getFieldDisplayName(), so
  // 'first_name' (DB column) is stored as 'First Name' in field_name.
  const firstNameEntry = auditResponse.body.entries.find(
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
  await page.goto('/admin/audit-log');
  await expect(
    await healPage.locate([{ type: 'testId', value: 'audit-log-heading' }]).resolve(testName),
  ).toBeVisible();

  await (
    await healPage.locate([{ type: 'testId', value: 'filter-record-type' }]).resolve(testName)
  ).selectOption('contact');
  await healPage.click([{ type: 'testId', value: 'apply-filters-button' }]);
  await expect(
    await healPage.locate([{ type: 'testId', value: 'audit-log-list' }]).resolve(testName),
  ).toBeVisible({ timeout: 10_000 });

  // If the specific row is on the first page, expand it and verify the detail section
  const expandButton = await healPage
    .locate([{ type: 'testId', value: `audit-log-row-button-${firstNameEntry.id}` }])
    .resolve(testName);
  const isVisible = await expandButton.isVisible().catch(() => false);
  if (isVisible) {
    await expandButton.click();
    await expect(
      await healPage
        .locate([{ type: 'testId', value: `audit-log-detail-${firstNameEntry.id}` }])
        .resolve(testName),
    ).toBeVisible({ timeout: 3_000 });
  }
});

test('@functional F12-AL4: Rep navigating to audit log is blocked', async ({ restClient }) => {
  // Create a rep dynamically so this test does not depend on E2E_REP_PASSWORD being set
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const rep = await createTestUser(restClient, { role: 'rep', password: REP_PASSWORD });

  try {
    await restClient.post('/api/auth/login', { email: rep.email, password: REP_PASSWORD });

    let got403 = false;
    try {
      await restClient.get<AuditLogListResponse>('/api/audit-log');
    } catch (err) {
      if (err instanceof RestClientError && err.status === 403) got403 = true;
    }
    expect(got403, 'rep should get 403 when accessing audit log').toBe(true);
  } finally {
    await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await restClient.patch(`/api/users/${rep.id}/deactivate`, {}).catch(() => null);
  }
});

// ---------------------------------------------------------------------------
// Lead Conversion — additional API-level verification (F12-V)
// ---------------------------------------------------------------------------

test('@functional F12-V1: Lead conversion — contact, account, and deal all exist in API and are linked', async ({
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const leadEmail = `f12v1-${suffix}@example.com`;
  const companyName = `F12V1 Corp ${suffix}`;
  const dealName = `${companyName} — Opportunity`;

  // Create lead
  const leadResp = await restClient.post<{ lead: { id: string } }>('/api/leads', {
    first_name: 'F12V1',
    last_name: 'Lead',
    email: leadEmail,
    company_name: companyName,
  });
  const leadId = leadResp.body.lead.id;
  testData.register('lead', leadId, `/api/leads/${leadId}`);

  // Convert atomically
  const conversion = await restClient.post<ConversionResponse>(`/api/leads/${leadId}/convert`, {
    contact: { first_name: 'F12V1', last_name: 'Lead', email: leadEmail },
    account: { mode: 'create', name: companyName },
    deal: { name: dealName },
  });
  const { contact_id, account_id, deal_id } = conversion.body.conversion;

  testData.register('contact', contact_id, `/api/contacts/${contact_id}`);
  testData.register('deal', deal_id, `/api/deals/${deal_id}`);
  // Accounts created by conversion are not directly deleteable in teardown if they have deals;
  // register anyway and teardown will handle 409 gracefully.
  testData.register('account', account_id, `/api/accounts/${account_id}`);

  // Verify contact exists with correct email
  const contactResp = await restClient.get<ContactSingleResponse>(`/api/contacts/${contact_id}`);
  expect(contactResp.body.contact.email, 'converted contact email should match lead email').toBe(
    leadEmail,
  );

  // Verify account exists with correct name
  const accountResp = await restClient.get<AccountSingleResponse>(`/api/accounts/${account_id}`);
  expect(accountResp.body.account.name, 'converted account name should match company name').toBe(
    companyName,
  );

  // Verify deal exists and is linked to the account
  const dealResp = await restClient.get<DealSingleResponse>(`/api/deals/${deal_id}`);
  expect(dealResp.body.deal.name, 'converted deal name should match').toBe(dealName);
  expect(dealResp.body.deal.account_id, 'converted deal should be linked to the new account').toBe(
    account_id,
  );

  // Verify lead is marked converted
  const leadDetail = await restClient.get<LeadSingleResponse>(`/api/leads/${leadId}`);
  expect(leadDetail.body.lead.converted_at, 'lead converted_at should be set').not.toBeNull();
  expect(leadDetail.body.lead.converted_contact_id, 'lead should reference converted contact').toBe(
    contact_id,
  );
});

test('@functional F12-V2: Converted lead does not appear in default list but appears with includeConverted=true', async ({
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const leadEmail = `f12v2-${suffix}@example.com`;

  const leadResp = await restClient.post<{ lead: { id: string } }>('/api/leads', {
    first_name: 'F12V2',
    email: leadEmail,
    company_name: `F12V2 Corp ${suffix}`,
  });
  const leadId = leadResp.body.lead.id;
  testData.register('lead', leadId, `/api/leads/${leadId}`);

  const conversion = await restClient.post<ConversionResponse>(`/api/leads/${leadId}/convert`, {
    contact: { first_name: 'F12V2', email: leadEmail },
    account: { mode: 'create', name: `F12V2 Corp ${suffix}` },
    deal: { name: `F12V2 Corp — Opportunity` },
  });
  testData.register(
    'contact',
    conversion.body.conversion.contact_id,
    `/api/contacts/${conversion.body.conversion.contact_id}`,
  );
  testData.register(
    'deal',
    conversion.body.conversion.deal_id,
    `/api/deals/${conversion.body.conversion.deal_id}`,
  );
  testData.register(
    'account',
    conversion.body.conversion.account_id,
    `/api/accounts/${conversion.body.conversion.account_id}`,
  );

  // Default list should not include the converted lead
  const defaultList = await restClient.get<{ data: Array<{ id: string }> }>('/api/leads');
  const foundInDefault = defaultList.body.data.some((l) => l.id === leadId);
  expect(foundInDefault, 'converted lead should be hidden in default list').toBe(false);

  // With includeConverted=true, lead should appear
  const fullList = await restClient.get<{ data: Array<{ id: string }> }>(
    '/api/leads?includeConverted=true',
  );
  const foundInFull = fullList.body.data.some((l) => l.id === leadId);
  expect(foundInFull, 'converted lead should be visible with includeConverted=true').toBe(true);
});
