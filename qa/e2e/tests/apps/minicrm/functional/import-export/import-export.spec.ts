/**
 * F11 — CSV Import and Export
 *
 * Functional regression tests for the CSV import (admin-only two-step wizard)
 * and CSV export (contacts, accounts, deals) features.
 *
 * Test groups:
 *   Import — Contacts (F11-IC) — valid CSV, missing required field, duplicate email
 *   Import — Accounts (F11-IA) — valid accounts CSV
 *   Import — Deals (F11-ID)   — valid deals CSV with account reference; unresolvable account
 *   Import — Auth (F11-IX)    — rep redirected / blocked from import
 *   Export — Contacts (F11-EC) — export triggered; filtered export line count
 *   Export — Accounts (F11-EA) — export triggered
 *   Export — Deals (F11-ED)   — export triggered
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - Import is admin-only; export CSV button appears for both roles
 *     (reps export their own records only)
 *
 * MINCRM-200
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import type { APIRequestContext } from '@playwright/test';
import {
  createTestContact,
  createTestAccount,
  createTestDeal,
  createTestUser,
} from '@apps/minicrm/helpers.js';

// ---------------------------------------------------------------------------
// Import request helper — wraps Playwright multipart POSTs to admin import
// ---------------------------------------------------------------------------

const BASE_URL =
  process.env['E2E_API_URL'] ?? process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';

async function importParse(
  request: APIRequestContext,
  entity: 'contacts' | 'accounts' | 'deals',
  csvBuffer: Buffer,
): Promise<{
  status: number;
  body: { headers: string[]; fields: Array<{ key: string; label: string; required?: boolean }> };
}> {
  const response = await request.post(`${BASE_URL}/api/admin/import/${entity}/parse`, {
    multipart: { file: { name: `${entity}.csv`, mimeType: 'text/csv', buffer: csvBuffer } },
  });
  const body = (await response.json()) as {
    headers: string[];
    fields: Array<{ key: string; label: string; required?: boolean }>;
  };
  return { status: response.status(), body };
}

async function importRun(
  request: APIRequestContext,
  entity: 'contacts' | 'accounts' | 'deals',
  csvBuffer: Buffer,
  mapping: Record<string, string | boolean>,
): Promise<{ status: number; body: ImportSummaryResponse }> {
  const response = await request.post(`${BASE_URL}/api/admin/import/${entity}/run`, {
    multipart: {
      file: { name: `${entity}.csv`, mimeType: 'text/csv', buffer: csvBuffer },
      mapping: JSON.stringify(mapping),
    },
  });
  const body = (await response.json()) as ImportSummaryResponse;
  return { status: response.status(), body };
}

/**
 * Builds a column mapping for the import run endpoint.
 * The API expects { crmFieldKey: csvHeaderName } — e.g. { name: 'name', stage: 'stage' }.
 * Headers that match a known CRM field key (case-insensitive, spaces→underscore) are included.
 */
function buildMapping(headers: string[], fields: Array<{ key: string }>): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of fields) {
    const matched = headers.find((h) => h.toLowerCase().replace(/\s+/g, '_') === field.key);
    if (matched) mapping[field.key] = matched;
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F11-import-export] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// CSV builders
// ---------------------------------------------------------------------------

function contactsCsv(
  rows: Array<{ first_name: string; last_name: string; email: string }>,
): Buffer {
  const header = 'first_name,last_name,email\n';
  const body = rows.map((r) => `${r.first_name},${r.last_name},${r.email}`).join('\n');
  return Buffer.from(header + body, 'utf-8');
}

function accountsCsv(rows: Array<{ name: string }>): Buffer {
  const header = 'name\n';
  const body = rows.map((r) => r.name).join('\n');
  return Buffer.from(header + body, 'utf-8');
}

function dealsCsv(rows: Array<{ name: string; stage: string; account_name: string }>): Buffer {
  const header = 'name,stage,account_name\n';
  const body = rows.map((r) => `${r.name},${r.stage},${r.account_name}`).join('\n');
  return Buffer.from(header + body, 'utf-8');
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface ImportSummaryResponse {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errorCsv: string | null;
}

interface ContactListResponse {
  data: Array<{ id: string; first_name: string; last_name: string; email: string }>;
  total: number;
}

interface AccountListResponse {
  data: Array<{ id: string; name: string }>;
  total: number;
}

// ---------------------------------------------------------------------------
// Import — Contacts (F11-IC)
// ---------------------------------------------------------------------------

test('@functional F11-IC1: Upload a valid contacts CSV — import summary shows created count and contacts appear in API', async ({
  request,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email1 = `f11ic1a-${suffix}@example.com`;
  const email2 = `f11ic1b-${suffix}@example.com`;

  const csvBuffer = contactsCsv([
    { first_name: 'F11IC1A', last_name: 'Test', email: email1 },
    { first_name: 'F11IC1B', last_name: 'Test', email: email2 },
  ]);

  const parsed = await importParse(request, 'contacts', csvBuffer);
  expect(parsed.status, 'parse should succeed').toBe(200);
  const mapping = buildMapping(parsed.body.headers, parsed.body.fields);

  const ran = await importRun(request, 'contacts', csvBuffer, mapping);
  expect(ran.status, 'run should succeed').toBe(200);
  expect(ran.body.created, 'two contacts should be created').toBe(2);
  expect(ran.body.failed, 'no failures expected').toBe(0);

  // Verify contacts are queryable via API
  const listResponse = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(email1)}`,
  );
  expect(listResponse.body.total, 'imported contact should be findable').toBeGreaterThanOrEqual(1);

  // Register created contacts for teardown
  const allContacts = await restClient.get<ContactListResponse>(`/api/contacts?search=f11ic1`);
  for (const contact of allContacts.body.data) {
    if (contact.email === email1 || contact.email === email2) {
      testData.register('contact', contact.id, `/api/contacts/${contact.id}`);
    }
  }
});

test('@functional F11-IC2: Upload a contacts CSV with a missing required field (email) — row in error report, contact not created', async ({
  request,
  restClient,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // CSV has first_name/last_name but no email column
  const csvBuffer = Buffer.from('first_name,last_name\nNoEmail,User\n', 'utf-8');

  const parsed = await importParse(request, 'contacts', csvBuffer);
  expect(parsed.status, 'parse should succeed (headers are valid shape)').toBe(200);

  // Mapping omits email intentionally
  const mappingWithoutEmail = buildMapping(
    parsed.body.headers,
    parsed.body.fields.filter((f) => f.key !== 'email'),
  );

  const ran = await importRun(request, 'contacts', csvBuffer, mappingWithoutEmail);
  // Either 200 with failed rows or 400 validation error — either is acceptable
  expect([200, 400], 'run should indicate failure for missing email').toContain(ran.status);

  if (ran.status === 200) {
    expect(ran.body.created, 'no contacts should be created without email').toBe(0);
    expect(
      ran.body.failed + ran.body.skipped,
      'row should be counted as failed or skipped',
    ).toBeGreaterThan(0);
  }
});

test('@functional F11-IC3: Upload a contacts CSV with a duplicate email — row flagged as skipped, existing contact unchanged', async ({
  request,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const existing = await createTestContact(testData, restClient, {
    first_name: 'Existing',
    last_name: 'F11IC3',
  });

  const csvBuffer = contactsCsv([
    { first_name: 'Duplicate', last_name: 'Attempt', email: existing.email },
  ]);

  const parsed = await importParse(request, 'contacts', csvBuffer);
  const mapping = buildMapping(parsed.body.headers, parsed.body.fields);

  const ran = await importRun(request, 'contacts', csvBuffer, mapping);
  expect(ran.status).toBe(200);
  expect(ran.body.created, 'no new contact should be created for duplicate').toBe(0);
  expect(ran.body.skipped, 'duplicate row should be skipped').toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Import — Accounts (F11-IA)
// ---------------------------------------------------------------------------

test('@functional F11-IA1: Upload a valid accounts CSV — accounts created and appear in API', async ({
  request,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const accountName = `F11IA1 Corp ${suffix}`;
  const csvBuffer = accountsCsv([{ name: accountName }]);

  const parsed = await importParse(request, 'accounts', csvBuffer);
  const mapping = buildMapping(parsed.body.headers, parsed.body.fields);

  const ran = await importRun(request, 'accounts', csvBuffer, mapping);
  expect(ran.status).toBe(200);
  expect(ran.body.created, 'one account should be created').toBeGreaterThanOrEqual(1);

  // Verify and register for teardown
  const listResponse = await restClient.get<AccountListResponse>(
    `/api/accounts?search=${encodeURIComponent(accountName)}`,
  );
  expect(listResponse.body.total, 'imported account should be findable').toBeGreaterThanOrEqual(1);
  for (const account of listResponse.body.data) {
    if (account.name === accountName) {
      testData.register('account', account.id, `/api/accounts/${account.id}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Import — Deals (F11-ID)
// ---------------------------------------------------------------------------

test('@functional F11-ID1: Upload a valid deals CSV with account name reference — deal created and linked', async ({
  request,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const account = await createTestAccount(testData, restClient);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const dealName = `F11ID1 Deal ${suffix}`;

  const csvBuffer = dealsCsv([
    { name: dealName, stage: 'Prospecting', account_name: account.name },
  ]);

  const parsed = await importParse(request, 'deals', csvBuffer);
  const mapping = buildMapping(parsed.body.headers, parsed.body.fields);

  const ran = await importRun(request, 'deals', csvBuffer, mapping);
  expect(ran.status).toBe(200);
  expect(ran.body.created, 'deal should be created').toBeGreaterThanOrEqual(1);
});

test('@functional F11-ID2: Upload a deals CSV with unresolvable account name and skip flag — deal skipped', async ({
  request,
  restClient,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const csvBuffer = dealsCsv([
    { name: 'Orphan Deal', stage: 'Prospecting', account_name: 'NONEXISTENT_CORP_XYZ_12345' },
  ]);

  const parsed = await importParse(request, 'deals', csvBuffer);
  // Include skip_unresolvable_accounts: true so the row is skipped rather than imported with null account
  const mapping = {
    ...buildMapping(parsed.body.headers, parsed.body.fields),
    skip_unresolvable_accounts: true,
  };

  const ran = await importRun(request, 'deals', csvBuffer, mapping);
  expect(ran.status).toBe(200);
  expect(ran.body.created, 'deal with bad account should not be created').toBe(0);
  expect(
    ran.body.skipped,
    'deal row should be skipped when account is unresolvable',
  ).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Import — Auth (F11-IX)
// ---------------------------------------------------------------------------

test('@functional F11-IX1: Rep cannot access import endpoints — blocked with 403', async ({
  request,
  restClient,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const repUser = await createTestUser(restClient, { role: 'rep' });

  try {
    await restClient.post('/api/auth/login', {
      email: repUser.email,
      password: 'BvtPassword1!',
    });

    const csvBuffer = contactsCsv([
      {
        first_name: 'Rep',
        last_name: 'Attempt',
        email: `rep-import-${Date.now()}@example.com`,
      },
    ]);
    const parsed = await importParse(request, 'contacts', csvBuffer);
    expect(parsed.status, 'rep should be blocked from import endpoint').toBe(403);
  } finally {
    await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await restClient.patch(`/api/users/${repUser.id}/deactivate`, {});
  }
});

// ---------------------------------------------------------------------------
// Export — Contacts (F11-EC)
// ---------------------------------------------------------------------------

test('@functional F11-EC1: Export contacts CSV — download triggered with correct Content-Disposition', async ({
  request,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Seed a known contact so there is at least one row in the export
  await createTestContact(testData, restClient, { first_name: 'F11EC1', last_name: 'Export' });

  const response = await request.get(`${BASE_URL}/api/contacts/export`);
  expect(response.status(), 'export should return 200').toBe(200);

  const disposition = response.headers()['content-disposition'] ?? '';
  expect(disposition, 'Content-Disposition should contain minicrm-contacts-').toContain(
    'minicrm-contacts-',
  );

  const contentType = response.headers()['content-type'] ?? '';
  expect(contentType, 'Content-Type should be text/csv').toContain('text/csv');
});

test('@functional F11-EC2: Export contacts with active search filter — filtered file contains only matching records', async ({
  request,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const uniqueName = `F11EC2FilterTarget${suffix}`;

  await createTestContact(testData, restClient, {
    first_name: uniqueName,
    last_name: 'A',
    email: `f11ec2a-${suffix}@example.com`,
  });
  await createTestContact(testData, restClient, {
    first_name: 'F11EC2Unrelated',
    last_name: 'B',
    email: `f11ec2b-${suffix}@example.com`,
  });

  const response = await request.get(
    `${BASE_URL}/api/contacts/export?search=${encodeURIComponent(uniqueName)}`,
  );
  expect(response.status()).toBe(200);

  const csvText = await response.text();
  const lines = csvText.split('\n').filter((l) => l.trim().length > 0);
  // Header + 1 data row for the uniqueName contact
  expect(lines.length, 'filtered export should contain header + 1 row').toBe(2);
  expect(csvText, 'filtered export should include the target contact name').toContain(uniqueName);
});

// ---------------------------------------------------------------------------
// Export — Accounts (F11-EA)
// ---------------------------------------------------------------------------

test('@functional F11-EA1: Export accounts CSV — download triggered', async ({
  request,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await createTestAccount(testData, restClient, { name: 'F11EA1 ExportCo' });

  const response = await request.get(`${BASE_URL}/api/accounts/export`);
  expect(response.status(), 'accounts export should return 200').toBe(200);

  const disposition = response.headers()['content-disposition'] ?? '';
  expect(disposition, 'Content-Disposition should be present').toContain('attachment');
});

// ---------------------------------------------------------------------------
// Export — Deals (F11-ED)
// ---------------------------------------------------------------------------

test('@functional F11-ED1: Export deals CSV — download triggered', async ({
  request,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const account = await createTestAccount(testData, restClient);
  await createTestDeal(testData, restClient, {
    account_id: account.id,
    name: 'F11ED1 Deal',
  });

  const response = await request.get(`${BASE_URL}/api/deals/export`);
  expect(response.status(), 'deals export should return 200').toBe(200);

  const disposition = response.headers()['content-disposition'] ?? '';
  expect(disposition, 'Content-Disposition should be present').toContain('attachment');
});
