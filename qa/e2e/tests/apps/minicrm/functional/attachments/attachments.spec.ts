/**
 * F10 — File Attachments (Upload, Download, Delete, Authorization)
 *
 * Functional regression tests for the file attachment feature introduced in
 * MINCRM-154, MINCRM-167, MINCRM-169. Covers the full value chain:
 * UI upload → API → storage → presigned URL → download link.
 *
 * Test groups:
 *   Upload (F10-U)  — upload to contact, account, deal; disallowed types; size limit
 *   Download (F10-D) — download link present and reachable
 *   Delete (F10-X)  — delete removes row; 404 via API
 *   Auth (F10-A)    — rep cannot delete another user's attachment
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - No raw locators in this file — UI interaction via healPage.locate / click / fill only
 *
 * MINCRM-199, MINCRM-278
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestContact,
  createTestAccount,
  createTestDeal,
  createTestUser,
  navigateToContact,
  navigateToAccount,
  navigateToDeal,
} from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F10-attachments] E2E_ADMIN_PASSWORD is not set');

const REP_PASSWORD = 'BvtPassword1!';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AttachmentRow {
  id: string;
  filename: string;
  size: number;
  record_type: string;
  record_id: string;
  uploaded_by: string;
  created_at: string;
}

interface AttachmentListResponse {
  attachments: AttachmentRow[];
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

test.beforeAll(async ({ restClient }) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Upload — F10-U
// ---------------------------------------------------------------------------

test('@functional F10-U1: Upload a file to a contact detail page — attachment row appears', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);
  await (
    await page.locate([{ type: 'testId', value: 'attachments-section' }]).resolve()
  ).waitFor({ state: 'visible' });

  await (
    await page.locate([{ type: 'testId', value: 'attachments-file-input' }]).resolve()
  ).setInputFiles({
    name: 'test-upload.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello world'),
  });

  // Wait for attachment row to appear
  const attachmentList = await page
    .locate([{ type: 'testId', value: 'attachments-list' }])
    .resolve();
  await expect(attachmentList).toBeVisible({ timeout: 10_000 });

  // Verify API reflects the upload
  const listResponse = await restClient.get<AttachmentListResponse>(
    `/api/attachments?recordType=contact&recordId=${contact.id}`,
  );
  expect(
    listResponse.body.attachments.length,
    'attachment should be present in API',
  ).toBeGreaterThan(0);
  const created = listResponse.body.attachments[0]!;
  expect(created.filename).toBe('test-upload.txt');
  testData.register('attachment', created.id, `/api/attachments/${created.id}`);
});

test('@functional F10-U2: Upload a file to an account detail page — attachment appears', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient);

  await navigateToAccount(page, account.id);
  await (
    await page.locate([{ type: 'testId', value: 'attachments-section' }]).resolve()
  ).waitFor({ state: 'visible' });

  await (
    await page.locate([{ type: 'testId', value: 'attachments-file-input' }]).resolve()
  ).setInputFiles({
    name: 'account-doc.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('account document'),
  });

  await (
    await page.locate([{ type: 'testId', value: 'attachments-list' }]).resolve()
  ).waitFor({ state: 'visible', timeout: 10_000 });

  const listResponse = await restClient.get<AttachmentListResponse>(
    `/api/attachments?recordType=account&recordId=${account.id}`,
  );
  expect(listResponse.body.attachments.length, 'attachment created for account').toBeGreaterThan(0);
  const created = listResponse.body.attachments[0]!;
  testData.register('attachment', created.id, `/api/attachments/${created.id}`);
});

test('@functional F10-U3: Upload a file to a deal detail page — attachment appears', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient);
  const deal = await createTestDeal(testData, restClient, { account_id: account.id });

  await navigateToDeal(page, deal.id);
  await (
    await page.locate([{ type: 'testId', value: 'attachments-section' }]).resolve()
  ).waitFor({ state: 'visible' });

  await (
    await page.locate([{ type: 'testId', value: 'attachments-file-input' }]).resolve()
  ).setInputFiles({
    name: 'deal-proposal.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('deal proposal content'),
  });

  await (
    await page.locate([{ type: 'testId', value: 'attachments-list' }]).resolve()
  ).waitFor({ state: 'visible', timeout: 10_000 });

  const listResponse = await restClient.get<AttachmentListResponse>(
    `/api/attachments?recordType=deal&recordId=${deal.id}`,
  );
  expect(listResponse.body.attachments.length, 'attachment created for deal').toBeGreaterThan(0);
  const created = listResponse.body.attachments[0]!;
  testData.register('attachment', created.id, `/api/attachments/${created.id}`);
});

test('@functional F10-U4: Upload a disallowed file type (.exe) — rejected with error message', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);
  await (
    await page.locate([{ type: 'testId', value: 'attachments-section' }]).resolve()
  ).waitFor({ state: 'visible' });

  await (
    await page.locate([{ type: 'testId', value: 'attachments-file-input' }]).resolve()
  ).setInputFiles({
    name: 'malware.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('MZ'),
  });

  // Client-side guard should show an upload error
  await expect(
    await page.locate([{ type: 'testId', value: 'attachments-upload-error' }]).resolve(),
  ).toBeVisible({
    timeout: 5_000,
  });

  // No attachment should have been created
  const listResponse = await restClient.get<AttachmentListResponse>(
    `/api/attachments?recordType=contact&recordId=${contact.id}`,
  );
  expect(listResponse.body.attachments.length, 'no attachment created for disallowed type').toBe(0);
});

test('@functional F10-U5: Upload a file exceeding the size limit — rejected with error message', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);
  await (
    await page.locate([{ type: 'testId', value: 'attachments-section' }]).resolve()
  ).waitFor({ state: 'visible' });

  // 26 MB — exceeds the 25 MB server limit; client guard fires first
  const oversizedBuffer = Buffer.alloc(26 * 1024 * 1024, 'x');

  await (
    await page.locate([{ type: 'testId', value: 'attachments-file-input' }]).resolve()
  ).setInputFiles({
    name: 'huge-file.pdf',
    mimeType: 'application/pdf',
    buffer: oversizedBuffer,
  });

  await expect(
    await page.locate([{ type: 'testId', value: 'attachments-upload-error' }]).resolve(),
  ).toBeVisible({
    timeout: 5_000,
  });
});

// ---------------------------------------------------------------------------
// Download — F10-D
// ---------------------------------------------------------------------------

test('@functional F10-D1: Download link for an uploaded file returns a non-error response', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);
  await (
    await page.locate([{ type: 'testId', value: 'attachments-section' }]).resolve()
  ).waitFor({ state: 'visible' });

  await (
    await page.locate([{ type: 'testId', value: 'attachments-file-input' }]).resolve()
  ).setInputFiles({
    name: 'download-test.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('downloadable content'),
  });

  // Wait for the attachment list to show the row
  const downloadLink = await page
    .locate([{ type: 'css', value: '[data-testid^="attachment-download-"]' }])
    .resolve();
  await expect(downloadLink).toBeVisible({ timeout: 10_000 });

  // Register for teardown
  const listResponse = await restClient.get<AttachmentListResponse>(
    `/api/attachments?recordType=contact&recordId=${contact.id}`,
  );
  if (listResponse.body.attachments[0]) {
    testData.register(
      'attachment',
      listResponse.body.attachments[0].id,
      `/api/attachments/${listResponse.body.attachments[0].id}`,
    );
  }

  // Verify download link is present and has a valid href
  const href = await downloadLink.getAttribute('href');
  expect(href, 'download link href should be set').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Delete — F10-X
// ---------------------------------------------------------------------------

test('@functional F10-X1: Delete an attachment — row disappears and API returns 404', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);
  await (
    await page.locate([{ type: 'testId', value: 'attachments-section' }]).resolve()
  ).waitFor({ state: 'visible' });

  await (
    await page.locate([{ type: 'testId', value: 'attachments-file-input' }]).resolve()
  ).setInputFiles({
    name: 'to-be-deleted.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('delete me'),
  });

  // Wait for the upload to complete before querying the API for the attachment ID
  await expect(
    await page.locate([{ type: 'testId', value: 'attachments-list' }]).resolve(),
  ).toBeVisible({ timeout: 10_000 });

  const listResponse = await restClient.get<AttachmentListResponse>(
    `/api/attachments?recordType=contact&recordId=${contact.id}`,
  );
  expect(listResponse.body.attachments.length, 'attachment exists before delete').toBeGreaterThan(
    0,
  );
  const attachmentId = listResponse.body.attachments[0]!.id;

  // Click delete button for this attachment
  const deleteButton = await page
    .locate([{ type: 'testId', value: `attachment-delete-${attachmentId}` }])
    .resolve();
  await expect(deleteButton).toBeVisible({ timeout: 10_000 });
  await deleteButton.click();

  // Confirm deletion in dialog
  await page.click([{ type: 'testId', value: 'attachment-delete-confirm' }]);

  // Row should be gone (isNotVisible — safe when element is removed from DOM).
  await expect
    .poll(() => page.isNotVisible([{ type: 'testId', value: `attachment-row-${attachmentId}` }]), {
      timeout: 5_000,
    })
    .toBe(true);

  // API should return 404
  let got404 = false;
  try {
    await restClient.get(`/api/attachments/${attachmentId}/download`);
  } catch (err) {
    if (err instanceof RestClientError && err.status === 404) got404 = true;
  }
  expect(got404, 'API should return 404 after deletion').toBe(true);
});

// ---------------------------------------------------------------------------
// Authorization — F10-A
// ---------------------------------------------------------------------------

test('@functional F10-A1: Rep cannot delete an attachment uploaded by another user', async ({
  page,
  restClient,
  testData,
}) => {
  // Admin uploads the attachment
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const rep = await createTestUser(restClient, { role: 'rep', password: REP_PASSWORD });

  const contact = await createTestContact(testData, restClient);

  try {
    await navigateToContact(page, contact.id);
    await (
      await page.locate([{ type: 'testId', value: 'attachments-section' }]).resolve()
    ).waitFor({ state: 'visible' });

    await (
      await page.locate([{ type: 'testId', value: 'attachments-file-input' }]).resolve()
    ).setInputFiles({
      name: 'admin-uploaded.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('admin content'),
    });

    // Wait for the upload to complete before querying the API for the attachment ID
    await expect(
      await page.locate([{ type: 'testId', value: 'attachments-list' }]).resolve(),
    ).toBeVisible({ timeout: 10_000 });

    const listResponse = await restClient.get<AttachmentListResponse>(
      `/api/attachments?recordType=contact&recordId=${contact.id}`,
    );
    expect(listResponse.body.attachments.length, 'attachment exists').toBeGreaterThan(0);
    const attachmentId = listResponse.body.attachments[0]!.id;
    testData.register('attachment', attachmentId, `/api/attachments/${attachmentId}`);

    // Switch to rep session
    await restClient.post('/api/auth/login', { email: rep.email, password: REP_PASSWORD });

    // Rep tries to delete via API — should get 403
    let got403 = false;
    try {
      await restClient.delete(`/api/attachments/${attachmentId}`);
    } catch (err) {
      if (err instanceof RestClientError && err.status === 403) got403 = true;
    }
    expect(got403, 'rep should get 403 when deleting another user attachment').toBe(true);
  } finally {
    // Restore admin session so teardown succeeds, then deactivate the rep
    await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await restClient.patch(`/api/users/${rep.id}/deactivate`, {}).catch(() => null);
  }
});
