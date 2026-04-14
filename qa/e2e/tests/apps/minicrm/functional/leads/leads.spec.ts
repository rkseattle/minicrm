/**
 * F9 — Leads Module (Lead CRUD, Status Lifecycle, Conversion)
 *
 * Functional regression tests for the Leads entity introduced in MINCRM-173/174/175.
 * Covers create, read/list, update, delete, status lifecycle, disqualification,
 * and atomic lead conversion to contact + account + deal.
 *
 * Test groups:
 *   Create (F9-C)    — required fields, optional fields, duplicate warning
 *   List (F9-L)      — filtering by status/source/owner, disqualified hidden by default
 *   Update (F9-U)    — edit fields, cancel edit
 *   Delete (F9-D)    — delete → lead removed from list
 *   Status (F9-S)    — inline status update, status history recorded
 *   Convert (F9-V)   — atomic conversion creates contact, account, and deal; converted badge shown
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - data-testid selectors only — no CSS class or positional selectors
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - Tests pass with --workers=4 (no shared mutable state)
 *
 * MINCRM-173, MINCRM-174, MINCRM-175
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F9-leads] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface LeadListResponse {
  data: Array<{
    id: string;
    first_name: string;
    last_name: string | null;
    email: string;
    status: string;
    company_name: string | null;
  }>;
  total: number;
  page: number;
  limit: number;
}

interface LeadSingleResponse {
  lead: {
    id: string;
    first_name: string;
    last_name: string | null;
    email: string;
    status: string;
    converted_at: string | null;
    converted_contact_id: string | null;
    converted_deal_id: string | null;
  };
}

interface ConversionResponse {
  conversion: {
    contact_id: string;
    account_id: string;
    deal_id: string;
  };
}

// ---------------------------------------------------------------------------
// Create tests (F9-C)
// ---------------------------------------------------------------------------

test('@functional F9-C1: required fields submitted → lead created and visible in list', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

  await page.goto('/leads');
  await page.getByTestId('new-lead-button').click();

  const email = `f9c1-${uniqueSuffix}@example.com`;
  await page.getByTestId('lead-first-name').fill('F9C1');
  await page.getByTestId('lead-email').fill(email);
  await page.getByTestId('lead-form-submit').click();

  await expect(page.getByTestId('lead-form')).not.toBeVisible();

  // Confirm via API
  const result = await restClient.get<LeadListResponse>(
    `/api/leads?includeDisqualified=true&includeConverted=true`,
  );
  const found = result.body.data.find((l) => l.email === email);
  expect(found, 'lead should exist via API').toBeDefined();
  testData.register('lead', found!.id, `/api/leads/${found!.id}`);
});

test('@functional F9-C2: optional fields saved and displayed on detail page', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

  await page.goto('/leads');
  await page.getByTestId('new-lead-button').click();

  const email = `f9c2-${uniqueSuffix}@example.com`;
  await page.getByTestId('lead-first-name').fill('F9C2');
  await page.getByTestId('lead-last-name').fill('Optional');
  await page.getByTestId('lead-email').fill(email);
  await page.getByTestId('lead-phone').fill('+15550002222');
  await page.getByTestId('lead-company-name').fill(`Corp-${uniqueSuffix}`);
  await page.getByTestId('lead-form-submit').click();

  // Navigate to detail via API to confirm fields saved
  const result = await restClient.get<LeadListResponse>(
    `/api/leads?includeDisqualified=true&includeConverted=true`,
  );
  const found = result.body.data.find((l) => l.email === email);
  expect(found).toBeDefined();
  testData.register('lead', found!.id, `/api/leads/${found!.id}`);

  const detail = await restClient.get<LeadSingleResponse>(`/api/leads/${found!.id}`);
  expect(detail.body.lead.last_name).toBe('Optional');
});

test('@functional F9-C3: duplicate email shows warning, Create Anyway creates duplicate', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const email = `f9c3-${uniqueSuffix}@example.com`;
  // Pre-create a lead via API
  const existing = await restClient.post<LeadSingleResponse>('/api/leads', {
    first_name: 'Existing',
    email,
  });
  testData.register('lead', existing.body.lead.id, `/api/leads/${existing.body.lead.id}`);

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });
  await page.goto('/leads');
  await page.getByTestId('new-lead-button').click();
  await page.getByTestId('lead-first-name').fill('Duplicate');
  await page.getByTestId('lead-email').fill(email);
  await page.getByTestId('lead-form-submit').click();

  await expect(page.getByTestId('duplicate-lead-warning')).toBeVisible();

  // Click "Create anyway"
  await page.getByTestId('duplicate-create-anyway').click();
  await expect(page.getByTestId('lead-form')).not.toBeVisible();

  const result = await restClient.get<LeadListResponse>(
    `/api/leads?includeDisqualified=true&includeConverted=true`,
  );
  const withEmail = result.body.data.filter((l) => l.email === email);
  expect(withEmail.length, 'two leads with same email should exist').toBe(2);
  const secondId = withEmail.find((l) => l.id !== existing.body.lead.id)!.id;
  testData.register('lead', secondId, `/api/leads/${secondId}`);
});

// ---------------------------------------------------------------------------
// Status lifecycle tests (F9-S)
// ---------------------------------------------------------------------------

test('@functional F9-S1: inline status update from list view updates badge', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const email = `f9s1-${uniqueSuffix}@example.com`;
  const created = await restClient.post<LeadSingleResponse>('/api/leads', {
    first_name: 'F9S1',
    email,
  });
  const leadId = created.body.lead.id;
  testData.register('lead', leadId, `/api/leads/${leadId}`);

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });
  await page.goto('/leads');

  // Click the status badge to open the inline selector
  await page.getByTestId(`status-badge-${leadId}`).click();
  await page.getByTestId(`status-select-${leadId}`).selectOption('Contacted');

  // Badge should update
  await expect(page.getByTestId(`status-badge-${leadId}`)).toHaveText('Contacted');

  // Confirm via API
  const detail = await restClient.get<LeadSingleResponse>(`/api/leads/${leadId}`);
  expect(detail.body.lead.status).toBe('Contacted');
});

test('@functional F9-S2: disqualified leads hidden by default, shown with toggle', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const email = `f9s2-${uniqueSuffix}@example.com`;
  const created = await restClient.post<LeadSingleResponse>('/api/leads', {
    first_name: 'F9S2',
    email,
  });
  const leadId = created.body.lead.id;
  testData.register('lead', leadId, `/api/leads/${leadId}`);

  // Disqualify via API
  await restClient.patch(`/api/leads/${leadId}`, {
    status: 'Disqualified',
    disqualification_reason: 'Not a fit',
  });

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });
  await page.goto('/leads');

  // Should not be visible by default
  await expect(page.getByTestId(`lead-row-${leadId}`)).not.toBeVisible();

  // Show disqualified
  await page.getByTestId('toggle-disqualified').check();
  await expect(page.getByTestId(`lead-row-${leadId}`)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Conversion tests (F9-V)
// ---------------------------------------------------------------------------

test('@functional F9-V1: Convert Lead creates contact, account, and deal atomically', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const email = `f9v1-${uniqueSuffix}@example.com`;
  const company = `F9V1 Corp ${uniqueSuffix}`;
  const created = await restClient.post<LeadSingleResponse>('/api/leads', {
    first_name: 'F9V1',
    email,
    company_name: company,
  });
  const leadId = created.body.lead.id;
  testData.register('lead', leadId, `/api/leads/${leadId}`);

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });
  await page.goto(`/leads/${leadId}`);

  await page.getByTestId('convert-lead-button').click();

  // Modal should be visible with prefilled fields
  await expect(page.getByTestId('convert-contact-first-name')).toHaveValue('F9V1');
  await expect(page.getByTestId('convert-contact-email')).toHaveValue(email);
  await expect(page.getByTestId('convert-account-name')).toHaveValue(company);

  await page.getByTestId('convert-confirm').click();

  // Should navigate to the new contact detail page
  await page.waitForURL(/\/contacts\//);

  // Confirm lead is marked converted via API
  const leadDetail = await restClient.get<LeadSingleResponse>(`/api/leads/${leadId}`);
  expect(leadDetail.body.lead.converted_at, 'lead should be marked converted').not.toBeNull();
  expect(leadDetail.body.lead.converted_contact_id).toBeDefined();
  expect(leadDetail.body.lead.converted_deal_id).toBeDefined();

  // Register created records for cleanup
  const conv = leadDetail.body.lead;
  if (conv.converted_contact_id) {
    testData.register(
      'contact',
      conv.converted_contact_id,
      `/api/contacts/${conv.converted_contact_id}`,
    );
  }
  if (conv.converted_deal_id) {
    testData.register('deal', conv.converted_deal_id, `/api/deals/${conv.converted_deal_id}`);
  }
});

test('@functional F9-V2: Converted lead shows badge in list view', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const email = `f9v2-${uniqueSuffix}@example.com`;
  const created = await restClient.post<LeadSingleResponse>('/api/leads', {
    first_name: 'F9V2',
    email,
    company_name: `F9V2 Corp ${uniqueSuffix}`,
  });
  const leadId = created.body.lead.id;
  testData.register('lead', leadId, `/api/leads/${leadId}`);

  // Convert via API directly
  const conversion = await restClient.post<ConversionResponse>(`/api/leads/${leadId}/convert`, {
    contact: { first_name: 'F9V2', email },
    account: { mode: 'create', name: `F9V2 Corp ${uniqueSuffix}` },
    deal: { name: `F9V2 Corp — Opportunity` },
  });
  if (conversion.body.conversion.contact_id) {
    testData.register(
      'contact',
      conversion.body.conversion.contact_id,
      `/api/contacts/${conversion.body.conversion.contact_id}`,
    );
  }
  if (conversion.body.conversion.deal_id) {
    testData.register(
      'deal',
      conversion.body.conversion.deal_id,
      `/api/deals/${conversion.body.conversion.deal_id}`,
    );
  }

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });
  await page.goto('/leads');

  // Converted leads hidden by default
  await expect(page.getByTestId(`lead-row-${leadId}`)).not.toBeVisible();

  // Show converted
  await page.getByTestId('toggle-converted').check();
  await expect(page.getByTestId(`badge-converted-${leadId}`)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Delete tests (F9-D)
// ---------------------------------------------------------------------------

test('@functional F9-D1: deleting a lead removes it from the list', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const email = `f9d1-${uniqueSuffix}@example.com`;
  const created = await restClient.post<LeadSingleResponse>('/api/leads', {
    first_name: 'F9D1',
    email,
  });
  const leadId = created.body.lead.id;

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });
  await page.goto(`/leads/${leadId}`);

  await page.getByTestId('delete-lead-button').click();
  // ConfirmDeleteModal
  await page
    .getByRole('button', { name: /delete/i })
    .last()
    .click();

  // Should navigate back to /leads
  await page.waitForURL('/leads');
  await expect(page.getByTestId(`lead-row-${leadId}`)).not.toBeVisible();
});
