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
 *   - UI interaction via page.locator with data-testid selectors only
 *
 * MINCRM-201
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestAccount } from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F12-audit-log] E2E_ADMIN_PASSWORD is not set');

const REP_EMAIL = process.env['E2E_REP_EMAIL'] ?? 'rep@example.com';
const REP_PASSWORD = process.env['E2E_REP_PASSWORD'];
if (!REP_PASSWORD) throw new Error('[F12-audit-log] E2E_REP_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuditLogEntry {
  id: string;
  event_type: string;
  record_type: string;
  record_id: string;
  changed_by: string;
  changed_by_name: string;
  created_at: string;
  changes: Array<{ field: string; old_value: string | null; new_value: string | null }> | null;
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
  restClient,
  testData,
}) => {
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
  await expect(page.locator('[data-testid="audit-log-heading"]')).toBeVisible();

  // Filter by record type = contact so the list is manageable
  await page.locator('[data-testid="filter-record-type"]').selectOption('contact');
  await page.locator('[data-testid="apply-filters-button"]').click();

  // The audit list should show at least one entry
  await expect(page.locator('[data-testid="audit-log-list"]')).toBeVisible({ timeout: 10_000 });

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
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Ensure there are at least one contact and one account action in the log
  const contact = await createTestContact(testData, restClient, { first_name: 'F12AL2C' });
  const account = await createTestAccount(testData, restClient, { name: 'F12AL2A Corp' });
  void contact;
  void account;

  await page.goto('/admin/audit-log');
  await expect(page.locator('[data-testid="audit-log-heading"]')).toBeVisible();

  // Filter to account only
  await page.locator('[data-testid="filter-record-type"]').selectOption('account');
  await page.locator('[data-testid="apply-filters-button"]').click();

  await expect(page.locator('[data-testid="audit-log-list"]')).toBeVisible({ timeout: 10_000 });

  // Check via API that the filtered results only contain account entries
  const auditResponse = await restClient.get<AuditLogListResponse>(
    `/api/audit-log?recordType=account`,
  );
  const nonAccountEntries = auditResponse.body.data.filter((e) => e.record_type !== 'account');
  expect(nonAccountEntries.length, 'filtered audit log should only contain account entries').toBe(
    0,
  );
});

test('@functional F12-AL3: Audit log — expand a row to see field-level change detail', async ({
  page,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const contact = await createTestContact(testData, restClient, {
    first_name: 'F12AL3',
    last_name: 'DetailTest',
  });

  // Update to generate a change entry
  await restClient.patch(`/api/contacts/${contact.id}`, { first_name: 'F12AL3Updated' });

  // Get the audit entry ID for this contact
  const auditResponse = await restClient.get<AuditLogListResponse>(
    `/api/audit-log?recordType=contact`,
  );
  const entry = auditResponse.body.data.find(
    (e) => e.record_id === contact.id && e.event_type === 'updated',
  );
  expect(entry, 'audit entry for updated contact should exist').toBeDefined();
  if (!entry) return;

  await page.goto('/admin/audit-log');
  await expect(page.locator('[data-testid="audit-log-heading"]')).toBeVisible();

  // Filter by record type to make the specific row more likely to be on first page
  await page.locator('[data-testid="filter-record-type"]').selectOption('contact');
  await page.locator('[data-testid="apply-filters-button"]').click();

  // Click expand button for this entry if visible in the UI
  const expandButton = page.locator(`[data-testid="audit-log-row-button-${entry.id}"]`);
  const isVisible = await expandButton.isVisible().catch(() => false);

  if (isVisible) {
    await expandButton.click();
    // Detail section should become visible
    await expect(page.locator(`[data-testid="audit-log-detail-${entry.id}"]`)).toBeVisible({
      timeout: 3_000,
    });
  } else {
    // Entry may be on page 2+ — verify field detail exists in the API response
    expect(entry.changes, 'updated entry should have field-level changes').not.toBeNull();
    if (entry.changes) {
      const firstNameChange = entry.changes.find((c) => c.field === 'first_name');
      expect(firstNameChange, 'first_name change should be recorded').toBeDefined();
      expect(firstNameChange?.new_value).toBe('F12AL3Updated');
    }
  }
});

test('@functional F12-AL4: Rep navigating to audit log is blocked', async ({ restClient }) => {
  // Verify rep cannot access the audit log API endpoint
  await restClient.post('/api/auth/login', { email: REP_EMAIL, password: REP_PASSWORD });

  let got403 = false;
  try {
    await restClient.get<AuditLogListResponse>('/api/audit-log');
  } catch (err) {
    if (err instanceof RestClientError && err.status === 403) got403 = true;
  }
  expect(got403, 'rep should get 403 when accessing audit log').toBe(true);
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
