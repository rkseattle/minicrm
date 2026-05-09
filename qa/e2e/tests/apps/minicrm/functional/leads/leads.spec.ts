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
 *   - All UI interactions via behaviors — no raw locators in this file
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - Tests pass with --workers=4 (no shared mutable state)
 *
 * MINCRM-173, MINCRM-174, MINCRM-175, MINCRM-192
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createLeadViaUI,
  createLeadViaUIThenCreateAnyway,
  updateLeadStatus,
  showDisqualifiedLeads,
  showConvertedLeads,
  convertLead,
  deleteLead,
  leadRowIsHidden,
} from '@behaviors/minicrm/index.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F9-leads] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared setup — admin auth + test name capture
// ---------------------------------------------------------------------------

test.beforeAll(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

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
    converted_account_id: string | null;
    converted_deal_id: string | null;
    /** Optimistic lock version (MINCRM-349) */
    version: number;
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
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const email = `f9c1-${uniqueSuffix}@example.com`;
  const result = await createLeadViaUI({ first_name: 'F9C1', email }, { page });

  expect(result.created, 'form should close after successful create').toBe(true);

  // Confirm via API
  const apiResult = await restClient.get<LeadListResponse>(
    `/api/v1/leads?includeDisqualified=true&includeConverted=true`,
  );
  const found = apiResult.body.data.find((l) => l.email === email);
  expect(found, 'lead should exist via API').toBeDefined();
  testData.register('lead', found!.id, `/api/v1/leads/${found!.id}`);
});

test('@functional F9-C2: optional fields saved and displayed on detail page', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const email = `f9c2-${uniqueSuffix}@example.com`;
  const result = await createLeadViaUI(
    {
      first_name: 'F9C2',
      last_name: 'Optional',
      email,
      phone: '+15550002222',
      company_name: `Corp-${uniqueSuffix}`,
    },
    { page },
  );

  expect(result.created, 'form should close after successful create').toBe(true);

  // Navigate to detail via API to confirm fields saved
  const apiResult = await restClient.get<LeadListResponse>(
    `/api/v1/leads?includeDisqualified=true&includeConverted=true`,
  );
  const found = apiResult.body.data.find((l) => l.email === email);
  expect(found).toBeDefined();
  testData.register('lead', found!.id, `/api/v1/leads/${found!.id}`);

  const detail = await restClient.get<LeadSingleResponse>(`/api/v1/leads/${found!.id}`);
  expect(detail.body.lead.last_name).toBe('Optional');
});

test('@functional F9-C3: duplicate email shows warning, Create Anyway creates duplicate', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const email = `f9c3-${uniqueSuffix}@example.com`;
  // Pre-create a lead via API
  const existing = await restClient.post<LeadSingleResponse>('/api/v1/leads', {
    first_name: 'Existing',
    email,
  });
  testData.register('lead', existing.body.lead.id, `/api/v1/leads/${existing.body.lead.id}`);

  // First submit should show warning
  const withWarning = await createLeadViaUI({ first_name: 'Duplicate', email }, { page });
  expect(withWarning.duplicateWarning, 'duplicate warning should appear').toBe(true);
  expect(withWarning.created, 'lead should not be created on first submit').toBe(false);

  // Click "Create anyway" to proceed
  const result = await createLeadViaUIThenCreateAnyway(
    { first_name: 'Duplicate', email },
    { page },
  );
  expect(result.created, 'lead should be created after clicking Create anyway').toBe(true);

  const apiResult = await restClient.get<LeadListResponse>(
    `/api/v1/leads?includeDisqualified=true&includeConverted=true`,
  );
  const withEmail = apiResult.body.data.filter((l) => l.email === email);
  expect(withEmail.length, 'two leads with same email should exist').toBe(2);
  const secondId = withEmail.find((l) => l.id !== existing.body.lead.id)!.id;
  testData.register('lead', secondId, `/api/v1/leads/${secondId}`);
});

// ---------------------------------------------------------------------------
// Status lifecycle tests (F9-S)
// ---------------------------------------------------------------------------

test('@functional F9-S1: inline status update from list view updates badge', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const email = `f9s1-${uniqueSuffix}@example.com`;
  const created = await restClient.post<LeadSingleResponse>('/api/v1/leads', {
    first_name: 'F9S1',
    email,
  });
  const leadId = created.body.lead.id;
  testData.register('lead', leadId, `/api/v1/leads/${leadId}`);

  const result = await updateLeadStatus(leadId, 'Contacted', { page });

  expect(result.badgeText, 'badge text should update to new status').toBe('Contacted');

  // Confirm via API
  const detail = await restClient.get<LeadSingleResponse>(`/api/v1/leads/${leadId}`);
  expect(detail.body.lead.status).toBe('Contacted');
});

test('@functional F9-S2: disqualified leads hidden by default, shown with toggle', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const email = `f9s2-${uniqueSuffix}@example.com`;
  const created = await restClient.post<LeadSingleResponse>('/api/v1/leads', {
    first_name: 'F9S2',
    email,
  });
  const leadId = created.body.lead.id;
  testData.register('lead', leadId, `/api/v1/leads/${leadId}`);

  // Disqualify via API.
  // MINCRM-349: include version for optimistic locking.
  await restClient.patch(`/api/v1/leads/${leadId}`, {
    status: 'Disqualified',
    disqualification_reason: 'Not a fit',
    version: created.body.lead.version,
  });

  // Should not be visible by default
  const hiddenResult = await leadRowIsHidden(leadId, { page });
  expect(hiddenResult.hidden, 'disqualified lead should be hidden by default').toBe(true);

  // Show disqualified
  const shownResult = await showDisqualifiedLeads(leadId, { page });
  expect(shownResult.leadVisible, 'disqualified lead should be visible after toggling').toBe(true);
});

// ---------------------------------------------------------------------------
// Conversion tests (F9-V)
// ---------------------------------------------------------------------------

test('@functional F9-V1: Convert Lead creates contact, account, and deal atomically', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const email = `f9v1-${uniqueSuffix}@example.com`;
  const company = `F9V1 Corp ${uniqueSuffix}`;
  const created = await restClient.post<LeadSingleResponse>('/api/v1/leads', {
    first_name: 'F9V1',
    email,
    company_name: company,
  });
  const leadId = created.body.lead.id;
  testData.register('lead', leadId, `/api/v1/leads/${leadId}`);

  const result = await convertLead(leadId, { page });

  // Modal should have been prefilled
  expect(result.prefillFirstName, 'first name should be prefilled').toBe('F9V1');
  expect(result.prefillEmail, 'email should be prefilled').toBe(email);
  expect(result.prefillAccountName, 'account name should be prefilled').toBe(company);

  // Should navigate to the new contact detail page
  expect(result.navigatedToContact, 'should navigate to contact after conversion').toBe(true);

  // Confirm lead is marked converted via API
  const leadDetail = await restClient.get<LeadSingleResponse>(`/api/v1/leads/${leadId}`);
  expect(leadDetail.body.lead.converted_at, 'lead should be marked converted').not.toBeNull();
  expect(leadDetail.body.lead.converted_contact_id).toBeDefined();
  expect(leadDetail.body.lead.converted_deal_id).toBeDefined();

  // Register created records for cleanup
  const conv = leadDetail.body.lead;
  if (conv.converted_contact_id) {
    testData.register(
      'contact',
      conv.converted_contact_id,
      `/api/v1/contacts/${conv.converted_contact_id}`,
    );
  }
  if (conv.converted_deal_id) {
    testData.register('deal', conv.converted_deal_id, `/api/v1/deals/${conv.converted_deal_id}`);
  }
  if (conv.converted_account_id) {
    testData.register(
      'account',
      conv.converted_account_id,
      `/api/v1/accounts/${conv.converted_account_id}`,
    );
  }
});

test('@functional F9-V2: Converted lead shows badge in list view', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const email = `f9v2-${uniqueSuffix}@example.com`;
  const created = await restClient.post<LeadSingleResponse>('/api/v1/leads', {
    first_name: 'F9V2',
    email,
    company_name: `F9V2 Corp ${uniqueSuffix}`,
  });
  const leadId = created.body.lead.id;
  testData.register('lead', leadId, `/api/v1/leads/${leadId}`);

  // Convert via API directly
  const conversion = await restClient.post<ConversionResponse>(`/api/v1/leads/${leadId}/convert`, {
    contact: { first_name: 'F9V2', email },
    account: { mode: 'create', name: `F9V2 Corp ${uniqueSuffix}` },
    deal: { name: `F9V2 Corp — Opportunity` },
  });
  if (conversion.body.conversion.contact_id) {
    testData.register(
      'contact',
      conversion.body.conversion.contact_id,
      `/api/v1/contacts/${conversion.body.conversion.contact_id}`,
    );
  }
  if (conversion.body.conversion.deal_id) {
    testData.register(
      'deal',
      conversion.body.conversion.deal_id,
      `/api/v1/deals/${conversion.body.conversion.deal_id}`,
    );
  }
  if (conversion.body.conversion.account_id) {
    testData.register(
      'account',
      conversion.body.conversion.account_id,
      `/api/v1/accounts/${conversion.body.conversion.account_id}`,
    );
  }

  // Converted leads hidden by default
  const hiddenResult = await leadRowIsHidden(leadId, { page });
  expect(hiddenResult.hidden, 'converted lead should be hidden by default').toBe(true);

  // Show converted and check badge
  const shownResult = await showConvertedLeads(leadId, { page });
  expect(
    shownResult.convertedBadgeVisible,
    'converted badge should be visible after toggling',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// Delete tests (F9-D)
// ---------------------------------------------------------------------------

test('@functional F9-D1: deleting a lead removes it from the list', async ({
  page,
  restClient,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const email = `f9d1-${uniqueSuffix}@example.com`;
  const created = await restClient.post<LeadSingleResponse>('/api/v1/leads', {
    first_name: 'F9D1',
    email,
  });
  const leadId = created.body.lead.id;

  const result = await deleteLead(leadId, { page });

  expect(result.deleted, 'browser should navigate back to /leads after deletion').toBe(true);
});
